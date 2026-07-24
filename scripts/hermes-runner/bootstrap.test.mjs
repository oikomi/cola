import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./bootstrap.mjs", import.meta.url),
  "utf8",
);

void test("Hermes bootstrap injects dashboard hash-token auto login", () => {
  assert.match(source, /COLA_HERMES_HASH_AUTO_LOGIN/);
  assert.match(source, /HERMES_DASHBOARD_LOGIN_PAGE_PATH/);
  assert.match(source, /location\.hash/);
  assert.match(source, /\/auth\/password-login/);
  assert.match(source, /HERMES_DASHBOARD_BASIC_AUTH_USERNAME/);
  assert.match(source, /patchHermesDashboardAutoLogin\(\)/);
});

void test("Hermes bootstrap disables basic-provider auto SSO redirect", () => {
  assert.match(source, /HERMES_DASHBOARD_AUTH_MIDDLEWARE_PATH/);
  assert.match(source, /COLA_HERMES_BASIC_AUTO_SSO_PATCH/);
  assert.match(source, /supports_password/);
  assert.match(source, /patchHermesDashboardBasicAutoSso\(\)/);
});

void test("Hermes task output preserves Markdown line breaks for report documents", () => {
  assert.match(
    source,
    /function compactOutputText\(value, maxLength = 36000\)/,
  );
  assert.ok(source.includes('value.replace(/\\r\\n?/g, "\\n").trim()'));
  assert.ok(!source.includes('value.replace(/\\s+/g, " ").trim()'));
});

void test("Hermes bootstrap routes large prompts through the local API Server", () => {
  assert.match(source, /shouldUseHermesTaskApi\(prompt, maxCliPromptBytes\)/);
  assert.match(source, /runHermesTaskViaApi\(\{/);
  assert.match(source, /promptByteLength\(prompt\)/);
  assert.ok(!source.includes("COLA_TASK_PROMPT: prompt"));
});
