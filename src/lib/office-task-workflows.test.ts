import assert from "node:assert/strict";
import test from "node:test";

import {
  isFeishuDocumentUrl,
  resolveWeeklyReportPeriod,
} from "./office-task-workflows.ts";

void test("team progress accepts supported Feishu document URLs", () => {
  assert.equal(
    isFeishuDocumentUrl("https://example.feishu.cn/wiki/wiki-token"),
    true,
  );
  assert.equal(
    isFeishuDocumentUrl("https://example.larksuite.com/docx/docx-token"),
    true,
  );
  assert.equal(
    isFeishuDocumentUrl("https://example.larkoffice.com/docs/doc-token"),
    true,
  );
});

void test("team progress rejects non-document or non-Feishu URLs", () => {
  assert.equal(isFeishuDocumentUrl("https://code.xdreamdev.com/team"), false);
  assert.equal(isFeishuDocumentUrl("https://example.feishu.cn/wiki"), false);
  assert.equal(
    isFeishuDocumentUrl("ftp://example.feishu.cn/wiki/wiki-token"),
    false,
  );
  assert.equal(isFeishuDocumentUrl("not-a-url"), false);
  assert.equal(isFeishuDocumentUrl(""), false);
});

void test("previous weekly report period uses a complete Shanghai work week", () => {
  const period = resolveWeeklyReportPeriod(
    "previous_week",
    new Date("2026-07-24T08:00:00.000Z"),
  );

  assert.deepEqual(period, {
    preset: "previous_week",
    startAt: "2026-07-12T16:00:00.000Z",
    endAt: "2026-07-19T16:00:00.000Z",
    timezone: "Asia/Shanghai",
    label: "2026-07-13 至 2026-07-19",
  });
});

void test("current weekly report period ends at the supplied current time", () => {
  const period = resolveWeeklyReportPeriod(
    "current_week",
    new Date("2026-07-24T08:00:00.000Z"),
  );

  assert.deepEqual(period, {
    preset: "current_week",
    startAt: "2026-07-19T16:00:00.000Z",
    endAt: "2026-07-24T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    label: "2026-07-20 至 2026-07-24",
  });
});

void test("rolling report periods cover 7, 14, and 30 complete days", () => {
  const now = new Date("2026-07-24T08:00:00.000Z");

  assert.deepEqual(resolveWeeklyReportPeriod("last_7_days", now), {
    preset: "last_7_days",
    startAt: "2026-07-17T08:00:00.000Z",
    endAt: "2026-07-24T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    label: "2026-07-17 至 2026-07-24",
  });
  assert.equal(
    resolveWeeklyReportPeriod("last_14_days", now).startAt,
    "2026-07-10T08:00:00.000Z",
  );
  assert.equal(
    resolveWeeklyReportPeriod("last_30_days", now).startAt,
    "2026-06-24T08:00:00.000Z",
  );
});
