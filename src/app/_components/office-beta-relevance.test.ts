import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./office-beta-shell.tsx", import.meta.url),
  "utf8",
);

void test("team progress dialog exposes the weekly-report/code relevance contract", () => {
  assert.match(source, /周报-代码关联性核验/);
  assert.match(source, /data-testid="weekly-report-relevance-check"/);
  assert.match(source, /只有能与具体周报事项建立证据链的提交/);
  for (const status of [
    "双源印证",
    "部分印证",
    "仅周报",
    "仅代码",
    "证据冲突",
    "无法判断",
  ]) {
    assert.match(source, new RegExp(status));
  }
});

void test("team progress copy states that commits are checked against report claims", () => {
  assert.match(source, /先匹配周报成员的 GitLab 账号/);
  assert.match(source, /判断代码是否印证目标、交付和问题/);
  assert.match(source, /无法匹配 GitLab\s+账号的周报成员会跳过/);
});
