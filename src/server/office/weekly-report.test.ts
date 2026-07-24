import assert from "node:assert/strict";
import test from "node:test";

import {
  attachWeeklyReportDocument,
  createGitLabWeeklyReportRequest,
  readGitLabWeeklyReportRequest,
  readWeeklyReportDocument,
} from "./weekly-report.ts";

void test("weekly report request round-trips through task input payload", () => {
  const request = createGitLabWeeklyReportRequest({
    gitlabUrl: "https://code.example.com/",
    periodPreset: "previous_week",
    now: new Date("2026-07-24T08:00:00.000Z"),
  });

  assert.deepEqual(
    readGitLabWeeklyReportRequest({ workflow: request }),
    request,
  );
});

void test("weekly report document reader rejects incomplete output", () => {
  assert.equal(readWeeklyReportDocument({ weeklyReport: {} }), null);
  assert.deepEqual(
    readWeeklyReportDocument({
      weeklyReport: {
        document: {
          documentId: "docx-token",
          title: "团队工作周报",
          url: "https://feishu.cn/docx/docx-token",
          warnings: ["一位通知人授权失败"],
        },
      },
    }),
    {
      documentId: "docx-token",
      title: "团队工作周报",
      url: "https://feishu.cn/docx/docx-token",
      warnings: ["一位通知人授权失败"],
    },
  );
});

void test("weekly report document attachment preserves existing output", () => {
  const request = createGitLabWeeklyReportRequest({
    gitlabUrl: "https://code.example.com",
    periodPreset: "previous_week",
    now: new Date("2026-07-24T08:00:00.000Z"),
  });
  const output = attachWeeklyReportDocument({ retained: true }, request, {
    documentId: "docx-token",
    title: "团队工作周报",
    url: "https://feishu.cn/docx/docx-token",
    warnings: [],
  });

  assert.equal(output.retained, true);
  assert.equal(readWeeklyReportDocument(output)?.documentId, "docx-token");
});
