const yaml = require("yaml");
const xml = require("fast-xml-parser");
const toml = require("@iarna/toml");
const ini = require("ini");
const properties = require("dot-properties");

export type FormatId = "json" | "yaml" | "xml" | "properties" | "toml" | "ini";
type DataValue = string | number | boolean | null | DataValue[] | { [key: string]: DataValue };

export function getDataFormats(): { id: FormatId; label: string; languageId: string }[] {
  return [
    { id: "json", label: "JSON", languageId: "json" },
    { id: "yaml", label: "YAML", languageId: "yaml" },
    { id: "xml", label: "XML", languageId: "xml" },
    { id: "properties", label: "Properties", languageId: "properties" },
    { id: "toml", label: "TOML", languageId: "toml" },
    { id: "ini", label: "INI", languageId: "ini" },
  ];
}

function checkKey(key: string) {
  if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsupported object key: " + key);
}

function normalize(value: any, path = "$", ancestors = new Set<any>()): DataValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error("Unsupported numeric range at " + path);
    }
    return value;
  }
  if (!value || typeof value !== "object" || value instanceof Date) throw new Error("Unsupported data type at " + path);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && !(value instanceof Map) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("Unsupported data type at " + path);
  }
  if (ancestors.has(value)) throw new Error("Cyclic data cannot be represented at " + path);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => normalize(item, path + "[" + index + "]", ancestors));
    const result = Object.create(null);
    const entries = value instanceof Map ? Array.from(value.entries()) : Object.entries(value);
    for (const [key, item] of entries) {
      if (typeof key !== "string") throw new Error("Only string keys can be represented at " + path);
      checkKey(key);
      result[key] = normalize(item, path + "." + key, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function objectPath(root: any, parts: string[]): any {
  let current = root;
  for (const part of parts) {
    checkKey(part);
    if (!part) throw new Error("Empty key path segment is unsupported");
    if (!Object.prototype.hasOwnProperty.call(current, part)) current[part] = Object.create(null);
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) {
      throw new Error("Conflicting key path: " + parts.join("."));
    }
    current = current[part];
  }
  return current;
}

function assignPath(root: any, parts: string[], value: string, array = false) {
  const key = parts[parts.length - 1];
  checkKey(key);
  if (!key) throw new Error("Empty keys are unsupported");
  const parent = objectPath(root, parts.slice(0, -1));
  const exists = Object.prototype.hasOwnProperty.call(parent, key);
  if (array) {
    if (!exists) parent[key] = [];
    if (!Array.isArray(parent[key])) throw new Error("Conflicting array key: " + parts.join("."));
    parent[key].push(value);
  } else {
    if (exists) throw new Error("Duplicate or conflicting key path: " + parts.join("."));
    parent[key] = value;
  }
}

function parseProperties(text: string): object {
  const result = Object.create(null);
  for (const line of properties.parseLines(text)) {
    if (Array.isArray(line)) assignPath(result, line[0].split("."), line[1]);
  }
  return result;
}

function sectionPath(section: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (let index = 0; index < section.length; index++) {
    const character = section[index];
    if (character === "\\" && (section[index + 1] === "." || section[index + 1] === "\\")) {
      part += section[++index];
    } else if (character === ".") {
      parts.push(part);
      part = "";
    } else {
      part += character;
    }
  }
  return parts.concat(part);
}

function parseIni(text: string): object {
  const result = Object.create(null);
  let section: string[] = [];
  for (const original of text.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || /^[;#]/.test(line)) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = sectionPath(header[1]);
      objectPath(result, section);
      continue;
    }
    const assignment = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^"'=][^=]*)\s*=(.*)$/.exec(line);
    if (!assignment) throw new Error("Invalid INI entry: expected key=value or [section]");
    let key = ini.unsafe(assignment[1]);
    if (typeof key !== "string") throw new Error("Unsupported INI key");
    const array = key.endsWith("[]");
    if (array) key = key.slice(0, -2);
    const value = ini.unsafe(assignment[2]);
    if (typeof value === "object" && value !== null) throw new Error("Unsupported INI value");
    assignPath(result, section.concat(key), String(value), array);
  }
  return result;
}

const xmlOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
};
const invalidXmlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

function cleanXml(value: any): any {
  if (typeof value === "string" && invalidXmlCharacters.test(value)) throw new Error("Invalid XML character");
  if (Array.isArray(value)) return value.map(cleanXml);
  if (!value || typeof value !== "object") return value;
  const children = Object.keys(value).filter((key) => key !== "#text" && !key.startsWith("@_"));
  if (children.length && Object.prototype.hasOwnProperty.call(value, "#text")) {
    if (String(value["#text"]).trim())
      throw new Error("XML mixed content cannot preserve element ordering in this data model");
    delete value["#text"];
  }
  for (const key of Object.keys(value)) value[key] = cleanXml(value[key]);
  return value;
}

function checkXmlOrder(nodes: any[]) {
  const seen = new Set<string>();
  let previous: string;
  for (const node of nodes) {
    const name = Object.keys(node).find((key) => key !== ":@" && key !== "#text" && !key.startsWith("?"));
    if (!name) continue;
    if (name !== previous && seen.has(name))
      throw new Error("Interleaved XML elements cannot preserve ordering in this data model");
    seen.add(name);
    previous = name;
    if (Array.isArray(node[name])) checkXmlOrder(node[name]);
  }
}

function parseXml(text: string): object {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error("XML DTD and entity declarations are unsupported");
  if (invalidXmlCharacters.test(text)) throw new Error("Invalid XML character");
  const validation = xml.XMLValidator.validate(text);
  if (validation !== true) throw new Error("Invalid XML: " + validation.err.msg);
  const entityText = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, "");
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(entityText))
    throw new Error("Invalid or undeclared XML entity");
  checkXmlOrder(new xml.XMLParser({ ...xmlOptions, preserveOrder: true }).parse(text));
  const result = cleanXml(
    new xml.XMLParser({
      ...xmlOptions,
      transformTagName: (name) => {
        checkKey(name);
        return name;
      },
      transformAttributeName: (name) => {
        checkKey(name.replace(/^@_/, ""));
        return name;
      },
    }).parse(text),
  );
  const roots = Object.keys(result);
  if (roots.length !== 1 || Array.isArray(result[roots[0]])) throw new Error("XML requires a single root element");
  return result;
}

export function parseData(text: string, format: FormatId): DataValue {
  let value: any;
  switch (format) {
    case "json":
      value = JSON.parse(text);
      break;
    case "yaml": {
      const document = yaml.parseDocument(text, { uniqueKeys: true });
      if (document.errors.length || document.warnings.length)
        throw new Error(String(document.errors[0] || document.warnings[0]));
      value = document.toJS({ mapAsMap: true, maxAliasCount: 100 });
      break;
    }
    case "xml":
      value = parseXml(text);
      break;
    case "properties":
      value = parseProperties(text);
      break;
    case "toml":
      value = toml.parse(text);
      break;
    case "ini":
      value = parseIni(text);
      break;
    default:
      throw new Error("Unknown source format");
  }
  return normalize(value);
}

function difference(expected: DataValue, actual: DataValue, path = "$"): string | undefined {
  if (expected === actual) return;
  if (expected === null || actual === null || typeof expected !== typeof actual || typeof expected !== "object")
    return path;
  if (Array.isArray(expected) !== Array.isArray(actual)) return path;
  const expectedKeys = Object.keys(expected).sort(),
    actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return path;
  for (const key of expectedKeys) {
    const changed = difference(expected[key], actual[key], path + "." + key);
    if (changed) return changed;
  }
}

function serializeProperties(value: DataValue): string {
  const lines: string[][] = [];
  function visit(node: DataValue, path: string[]) {
    if (typeof node === "string" && path.length) {
      lines.push([path.join("."), node]);
    } else if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const key of Object.keys(node)) {
        if (!key || key.includes(".")) throw new Error("Properties key paths cannot preserve empty or dotted keys");
        visit(node[key], path.concat(key));
      }
    } else {
      throw new Error("Properties can only represent nested objects with string values");
    }
  }
  visit(value, []);
  return properties.stringify(lines, { latin1: false, lineWidth: null });
}

export function convertData(text: string, source: FormatId, target: FormatId): string {
  const value = parseData(text, source);
  let output: string,
    expected = value;
  switch (target) {
    case "json":
      output = JSON.stringify(value, null, 2);
      break;
    case "yaml":
      output = yaml.stringify(value);
      break;
    case "properties":
      output = serializeProperties(value);
      break;
    case "toml":
    case "ini": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(target + " requires an object at the root");
      output = target === "toml" ? toml.stringify(value) : ini.stringify(value);
      break;
    }
    case "xml": {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        !Array.isArray(value[Object.keys(value)[0]])
      ) {
        expected = value;
      } else {
        expected = { root: Array.isArray(value) ? { item: value } : value };
      }
      output = new xml.XMLBuilder({ ...xmlOptions, format: false }).build(expected);
      break;
    }
    default:
      throw new Error("Unknown target format");
  }
  const changed = difference(expected, parseData(output, target));
  if (changed) throw new Error(target + " cannot preserve the data structure or types at " + changed);
  return output;
}
