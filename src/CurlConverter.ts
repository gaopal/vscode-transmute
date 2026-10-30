const importer = require("curl-to-postmanv2");
const codegen = require("postman-code-generators");
const { Request } = require("postman-collection");

export interface CodeTarget {
  label: string;
  language: string;
  variant: string;
  languageId: string;
}

export function getCodeTargets(): CodeTarget[] {
  const languageIds = { go: "go", c: "c", http: "plaintext", shell: "shellscript", "objective-c": "objective-c" };
  const targets: CodeTarget[] = [];
  for (const language of codegen.getLanguageList()) {
    if (language.key === "curl") continue;
    for (const variant of language.variants) {
      targets.push({
        label: language.label + " - " + variant.key,
        language: language.key,
        variant: variant.key,
        languageId: languageIds[language.key] || language.syntax_mode,
      });
    }
  }
  return targets;
}

export async function parseCurl(command: string): Promise<object> {
  const normalized = command.trim().replace(/^curl(?:\.exe)?\s+/i, "curl ");
  if (!normalized.startsWith("curl ")) {
    throw new Error("Select a curl command beginning with curl and a URL");
  }
  return new Promise((resolve, reject) => {
    importer.convert({ type: "string", data: normalized }, (error, result) => {
      if (error) return reject(new Error(error.message || String(error)));
      if (!result.result) return reject(new Error(result.reason || "Unable to parse curl command"));
      const output = result.output;
      if (!output || output.length !== 1 || output[0].type !== "request" || !output[0].data.url) {
        return reject(new Error("Select one curl command with a request URL"));
      }
      try {
        resolve(new Request(output[0].data));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function generateCode(request: object, target: CodeTarget): Promise<string> {
  return new Promise((resolve, reject) => {
    codegen.convert(target.language, target.variant, request, {}, (error, snippet) => {
      if (error) return reject(new Error(error.message || String(error)));
      if (typeof snippet !== "string" || !snippet.trim()) {
        return reject(new Error("The selected code generator returned no code"));
      }
      resolve(snippet);
    });
  });
}
