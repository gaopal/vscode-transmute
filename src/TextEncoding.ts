import { createHash, createHmac } from "crypto";
import { TextDecoder } from "util";

export interface TextOperation {
  id: string;
  label: string;
  secret?: "password" | "key";
  newDocument?: boolean;
}

export function getTextOperations(): TextOperation[] {
  const pairs = {
    base64: "Base64 (UTF-8)",
    base64url: "Base64URL (UTF-8)",
    hex: "Hex (UTF-8)",
    uri: "URL",
    component: "URL Component",
    form: "Form URL Encoding",
    html: "HTML Entities",
    xml: "XML Entities",
    unicode: "Unicode Escapes",
    json: "JSON String",
    bytes: "JSON Byte Array (UTF-8)",
    crockford: "Crockford Base32 Integer",
  };
  const operations: TextOperation[] = [];
  for (const id of Object.keys(pairs)) {
    operations.push({ id: id + ":encode", label: "Encode: " + pairs[id] });
    operations.push({ id: id + ":decode", label: "Decode: " + pairs[id] });
  }
  operations.push(
    { id: "html:decimal", label: "Encode: HTML Decimal Entities" },
    { id: "base64:bytes", label: "Convert: Base64 to JSON Byte Array" },
    { id: "bytes:base64", label: "Convert: JSON Byte Array to Base64" },
    { id: "bytes:hex", label: "Convert: JSON Byte Array to Hex" },
    { id: "hex:bytes", label: "Convert: Hex to JSON Byte Array" }
  );
  for (const algorithm of ["md5", "sha1", "sha256", "sha512"]) {
    for (const encoding of ["hex", "base64"]) {
      operations.push({
        id: "hash:" + algorithm + ":" + encoding,
        label: "Hash: " + algorithm.toUpperCase() + " (" + encoding + ")",
      });
    }
  }
  for (const algorithm of ["sha256", "sha512"]) {
    for (const encoding of ["hex", "base64"]) {
      operations.push({
        id: "hmac:" + algorithm + ":" + encoding,
        label: "HMAC: " + algorithm.toUpperCase() + " (" + encoding + ")",
        secret: "key",
      });
    }
  }
  operations.push(
    { id: "aes:encrypt", label: "Encrypt: AES-256-GCM", secret: "password", newDocument: true },
    { id: "aes:decrypt", label: "Decrypt: AES-256-GCM", secret: "password", newDocument: true }
  );
  return operations;
}

export function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function encodeUtf8(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  if (decodeUtf8(bytes) !== text) throw new Error("Text contains an unpaired Unicode surrogate");
  return bytes;
}

export function decodeBase64(text: string, urlSafe = false): Buffer {
  const value = text.replace(/\s/g, "");
  const alphabet = urlSafe ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(value) || value.length % 4 === 1 || (value.includes("=") && value.length % 4 !== 0)) {
    throw new Error("Invalid Base64 input");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
    throw new Error("Invalid Base64 padding or trailing bits");
  }
  return bytes;
}

function decodeHex(text: string): Buffer {
  const value = text.replace(/\s/g, "");
  if (!/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error("Hex requires pairs of hexadecimal digits");
  return Buffer.from(value, "hex");
}

function byteArray(text: string): Buffer {
  const values = JSON.parse(text);
  if (!Array.isArray(values) || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("Expected a JSON array of integer bytes from 0 to 255");
  }
  return Buffer.from(values);
}

function crockford(text: string, encode: boolean): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  if (encode) {
    const number = Number(text.trim());
    if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(number))
      throw new Error("Expected a nonnegative safe integer");
    let remaining = number,
      result = "";
    do {
      result = alphabet[remaining % 32] + result;
      remaining = Math.floor(remaining / 32);
    } while (remaining);
    return result;
  }
  const value = text.trim().toUpperCase().replace(/-/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!value.length) throw new Error("Expected a Crockford Base32 integer");
  let number = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid Crockford Base32 digit");
    number = number * 32 + digit;
    if (!Number.isSafeInteger(number)) throw new Error("Integer exceeds the safe numeric range");
  }
  return String(number);
}

export async function transformText(text: string, id: string, secret?: string): Promise<string> {
  const operation = getTextOperations().find((operation) => operation.id === id);
  if (!operation) throw new Error("Unknown text operation");
  if (operation.secret && !secret) throw new Error("A nonempty " + operation.secret + " is required");
  const [kind, action, outputEncoding] = id.split(":");
  if (kind === "aes") {
    const crypto: typeof import("./CryptoTools") = require("./CryptoTools");
    return action === "encrypt" ? crypto.encryptText(text, secret) : crypto.decryptText(text, secret);
  }
  if (kind === "hash")
    return createHash(action)
      .update(encodeUtf8(text))
      .digest(outputEncoding as "hex" | "base64");
  if (kind === "hmac")
    return createHmac(action, encodeUtf8(secret))
      .update(encodeUtf8(text))
      .digest(outputEncoding as "hex" | "base64");
  switch (id) {
    case "base64:encode":
      return encodeUtf8(text).toString("base64");
    case "base64:decode":
      return decodeUtf8(decodeBase64(text));
    case "base64url:encode":
      return encodeUtf8(text).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    case "base64url:decode":
      return decodeUtf8(decodeBase64(text, true));
    case "hex:encode":
      return encodeUtf8(text).toString("hex");
    case "hex:decode":
      return decodeUtf8(decodeHex(text));
    case "uri:encode":
      return encodeURI(text);
    case "uri:decode":
      return decodeURI(text);
    case "component:encode":
      return encodeURIComponent(text);
    case "component:decode":
      return decodeURIComponent(text);
    case "form:encode":
      return encodeURIComponent(text).replace(/%20/g, "+");
    case "form:decode":
      return decodeURIComponent(text.replace(/\+/g, " "));
    case "json:encode":
      return JSON.stringify(text);
    case "json:decode": {
      const value = JSON.parse(text);
      if (typeof value !== "string") throw new Error("Expected a JSON string");
      return value;
    }
    case "bytes:encode":
      return JSON.stringify(Array.from(encodeUtf8(text)));
    case "bytes:decode":
      return decodeUtf8(byteArray(text));
    case "base64:bytes":
      return JSON.stringify(Array.from(decodeBase64(text)));
    case "bytes:base64":
      return byteArray(text).toString("base64");
    case "bytes:hex":
      return byteArray(text).toString("hex");
    case "hex:bytes":
      return JSON.stringify(Array.from(decodeHex(text)));
    case "crockford:encode":
      return crockford(text, true);
    case "crockford:decode":
      return crockford(text, false);
    case "unicode:encode":
      return text
        .split("")
        .map((character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"))
        .join("");
    case "unicode:decode": {
      const escapes = /\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})/g;
      if (/\\u/.test(text.replace(escapes, ""))) throw new Error("Invalid Unicode escape");
      return text.replace(escapes, (value) => String.fromCodePoint(parseInt(value.slice(2).replace(/[{}]/g, ""), 16)));
    }
    default: {
      const entities = require("html-entities");
      if (id === "html:decode" || id === "xml:decode")
        return entities.decode(text, { level: kind === "xml" ? "xml" : "html5" });
      return entities.encode(text, {
        level: kind === "xml" ? "xml" : "html5",
        mode: action === "decimal" ? "nonAsciiPrintable" : "specialChars",
        numeric: "decimal",
      });
    }
  }
}
