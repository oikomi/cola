import assert from "node:assert/strict";
import test from "node:test";

import { buildKasmVncClientUrl } from "./kasmvnc-url.ts";

void test("buildKasmVncClientUrl opens the KasmVNC client with text clipboard enabled", () => {
  const url = new URL(buildKasmVncClientUrl("http://172.16.60.198:31480/"));

  assert.equal(url.origin, "http://172.16.60.198:31480");
  assert.equal(url.pathname, "/vnc.html");
  assert.equal(url.searchParams.get("autoconnect"), "1");
  assert.equal(url.searchParams.get("path"), "websockify");
  assert.equal(url.searchParams.get("resize"), "remote");
  assert.equal(url.searchParams.get("clipboard_up"), "true");
  assert.equal(url.searchParams.get("clipboard_down"), "true");
  assert.equal(url.searchParams.get("clipboard_seamless"), "true");
  assert.equal(url.searchParams.get("show_control_bar"), "true");
});

void test("buildKasmVncClientUrl preserves https ingress origins", () => {
  const url = new URL(buildKasmVncClientUrl("https://workspace.example.test/"));

  assert.equal(url.origin, "https://workspace.example.test");
  assert.equal(url.pathname, "/vnc.html");
  assert.equal(url.searchParams.get("clipboard_up"), "true");
  assert.equal(url.searchParams.get("clipboard_down"), "true");
});
