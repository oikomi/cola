import assert from "node:assert/strict";
import test from "node:test";

import { buildRunnerTaskPrompt } from "./task-prompt.ts";

void test("Hermes task prompt does not force unrelated shared storage directory", () => {
  const prompt = buildRunnerTaskPrompt({
    engine: "hermes-agent",
    title: "Read Feishu wiki",
    summary: "Open the provided wiki link and summarize it.",
    taskType: "coordination",
    priority: "medium",
    riskLevel: "low",
  });

  assert.doesNotMatch(prompt, /\/shared-dist-storage/);
  assert.match(
    prompt,
    /Use the workspace and files made available by the runner environment\./,
  );
});

void test("Hermes GitLab task prompt keeps repository context", () => {
  const prompt = buildRunnerTaskPrompt({
    engine: "hermes-agent",
    title: "Inspect repository",
    taskType: "feature",
    priority: "high",
    riskLevel: "medium",
    gitlabRepository: {
      input: "xdream/cola",
      projectPath: "xdream/cola",
      repositoryUrl: "https://code.example.com/xdream/cola.git",
      ref: "main",
    },
  });

  assert.match(prompt, /GitLab repository context:/);
  assert.match(
    prompt,
    /Repository URL: https:\/\/code\.example\.com\/xdream\/cola\.git/,
  );
  assert.match(prompt, /Ref: main/);
});

void test("Hermes task prompt includes fetched Feishu document context", () => {
  const prompt = buildRunnerTaskPrompt({
    engine: "hermes-agent",
    title: "Summarize weekly report",
    taskType: "coordination",
    priority: "medium",
    riskLevel: "low",
    feishuDocuments: [
      {
        content: "本周完成 V20518 上半身控制联调，剩余视觉回归测试。",
        documentToken: "doc-token",
        sourceUrl: "https://example.feishu.cn/wiki/wiki-token",
        title: "V20518 周报",
        type: "docx",
      },
    ],
  });

  assert.match(prompt, /Feishu document context:/);
  assert.match(prompt, /Do not open the Feishu web URL again/);
  assert.match(prompt, /V20518 周报/);
  assert.match(prompt, /本周完成 V20518 上半身控制联调/);
});

void test("Hermes weekly report prompt requires evidence-based Chinese Markdown", () => {
  const prompt = buildRunnerTaskPrompt({
    engine: "hermes-agent",
    title: "团队工作周报",
    summary: "重点关注跨项目协作和交付风险。",
    taskType: "coordination",
    priority: "medium",
    riskLevel: "low",
    gitlabWeeklyActivity: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      sourceUrl: "https://code.example.com",
      period: {
        preset: "previous_week",
        startAt: "2026-07-12T16:00:00.000Z",
        endAt: "2026-07-19T16:00:00.000Z",
        timezone: "Asia/Shanghai",
        label: "2026-07-13 至 2026-07-19",
      },
      roster: [],
      projects: [],
      contributors: [],
      coverage: {
        projectsScanned: 3,
        projectsWithActivity: 0,
        projectsTruncated: false,
        rosterCount: 0,
        commitCount: 0,
        sampledCommitCount: 0,
        commitsTruncated: false,
        contributorCount: 0,
        detailedCommitCount: 0,
      },
      warnings: ["一个项目读取失败"],
    },
  });

  assert.match(
    prompt,
    /company GitLab team weekly report in Simplified Chinese/,
  );
  assert.match(prompt, /Do not rank people by volume/);
  assert.match(prompt, /Omit projects with zero commits/);
  assert.match(prompt, /Include every project in that array/);
  assert.match(prompt, /complete member-level counts and project paths/);
  assert.match(prompt, /数据范围与口径、总体进展、成员工作情况/);
  assert.match(prompt, /一个项目读取失败/);
  assert.match(prompt, /Return only the final report Markdown/);
});
