import assert from "node:assert/strict";
import test from "node:test";

import {
  constantTimeEqual,
  createOpaqueToken,
  hashOpaqueToken,
} from "./token.ts";

void test("createOpaqueToken returns strong opaque tokens", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();

  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.ok(second.length >= 40);
});

void test("hashSessionToken is stable and does not expose the token", () => {
  const token = "session-token-example";
  const hash = hashOpaqueToken(token, "test-secret");

  assert.equal(hash, hashOpaqueToken(token, "test-secret"));
  assert.notEqual(hash, token);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

void test("constantTimeEqual rejects different values and lengths", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});
