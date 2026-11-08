import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactText, redactValue } from "../src/redact";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("all completion SDK imports and direct calls stay in the logged client", () => {
  const clientPath = "packages/serv/src/client.ts";
  let foundClient = false;
  const glob = new Bun.Glob("{apps,packages}/**/src/**/*.{ts,tsx}");
  for (const path of glob.scanSync({ cwd: root, onlyFiles: true })) {
    if (path.includes("/node_modules/")) continue;
    const source = readFileSync(join(root, path), "utf8");
    const imports = new Bun.Transpiler({
      loader: path.endsWith(".tsx") ? "tsx" : "ts",
    }).scanImports(source);
    const sdkImports = imports.filter(
      (item) => item.path === "openai" || item.path.startsWith("openai/"),
    );
    if (path === clientPath) {
      foundClient = true;
      expect(sdkImports).toHaveLength(1);
    } else {
      expect(sdkImports).toHaveLength(0);
      expect(source).not.toContain(".chat.completions.create(");
    }
  }
  expect(foundClient).toBe(true);
});

test("redaction covers nested credentials, headers, token strings and the active key", () => {
  const credential = ["local", "sensitive", "value"].join("-");
  const data = redactValue(
    {
      nested: { Authorization: "Basic hidden", api_key: "hidden" },
      text: `Bearer abc.def ${credential}`,
    },
    [credential],
  );
  expect(data).toEqual({
    nested: { Authorization: "[REDACTED]", api_key: "[REDACTED]" },
    text: "Bearer [REDACTED] [REDACTED]",
  });
  expect(
    redactText('{"Authorization":"Basic hidden","api_key":"hidden"}'),
  ).not.toContain("hidden");
  expect(redactText("Authorization: Basic hidden\nnext line")).not.toContain(
    "hidden",
  );
});
