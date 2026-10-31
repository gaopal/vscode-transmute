import { randomBytes, scrypt, createCipheriv, createDecipheriv } from "crypto";
import { encodeUtf8, decodeUtf8, decodeBase64 } from "./TextEncoding";

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  if (!password) return Promise.reject(new Error("A nonempty password is required"));
  return new Promise((resolve, reject) => {
    scrypt(encodeUtf8(password), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

const authenticatedMetadata = Buffer.from("transformer:aes256gcm:v1", "utf8");

export async function encryptText(text: string, password: string): Promise<string> {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(authenticatedMetadata);
    const ciphertext = Buffer.concat([cipher.update(encodeUtf8(text)), cipher.final()]);
    return JSON.stringify(
      {
        version: 1,
        algorithm: "AES-256-GCM",
        kdf: "scrypt",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      },
      null,
      2
    );
  } finally {
    key.fill(0);
  }
}

export async function decryptText(text: string, password: string): Promise<string> {
  const envelope = JSON.parse(text);
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM" || envelope.kdf !== "scrypt") {
    throw new Error("Unsupported encrypted text format or version");
  }
  for (const field of ["salt", "iv", "tag", "ciphertext"]) {
    if (typeof envelope[field] !== "string") throw new Error("Missing encrypted text field: " + field);
  }
  const salt = decodeBase64(envelope.salt),
    iv = decodeBase64(envelope.iv),
    tag = decodeBase64(envelope.tag);
  const ciphertext = decodeBase64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid salt, IV or authentication tag length");
  const key = await deriveKey(password, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(authenticatedMetadata);
    decipher.setAuthTag(tag);
    return decodeUtf8(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch (error) {
    throw new Error("Unable to decrypt: incorrect password or modified ciphertext");
  } finally {
    key.fill(0);
  }
}
