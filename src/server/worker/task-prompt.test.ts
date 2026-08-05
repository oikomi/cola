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
    title: "团队进展",
    summary: "重点关注跨项目协作和交付风险。",
    taskType: "coordination",
    priority: "medium",
    riskLevel: "low",
    feishuDocuments: [
      {
        content: "乐天行：完成控制链路联调，当前阻塞是视觉回归。",
        documentToken: "weekly-doc-token",
        sourceUrl: "https://example.feishu.cn/wiki/weekly-wiki-token",
        title: "研发团队周报",
        type: "docx",
      },
    ],
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

  assert.match(prompt, /company team progress analysis in Simplified Chinese/);
  assert.match(
    prompt,
    /Use both the fetched Feishu weekly report and the GitLab activity dataset/,
  );
  assert.match(prompt, /Reconcile the two sources member by member/);
  assert.match(prompt, /report-only statements, GitLab-only changes/);
  assert.match(
    prompt,
    /GitLab-account eligibility gate before any member-level analysis/,
  );
  assert.match(
    prompt,
    /Skip weekly-report members with no confirmed GitLab account entirely/,
  );
  assert.match(
    prompt,
    /A confirmed GitLab account with zero commits remains eligible/,
  );
  assert.match(
    prompt,
    /weekly-report-to-code relevance a required analysis dimension/,
  );
  assert.match(
    prompt,
    /双源印证, 部分印证, 仅周报, 仅代码, 证据冲突, 无法判断/,
  );
  assert.match(
    prompt,
    /weekly-report item -> member\/project identity -> commit title/,
  );
  assert.match(prompt, /must not directly increase that member's 目标与交付/);
  assert.match(prompt, /exact heading '## 周报与代码关联性'/);
  assert.match(prompt, /Do not rank people by volume/);
  assert.match(prompt, /use relative grading/);
  assert.match(prompt, /Omit projects with zero commits/);
  assert.match(prompt, /Include every project in that array/);
  assert.match(prompt, /complete member-level counts and project paths/);
  assert.match(prompt, /数据范围与口径、总体进展、周报与代码关联性、成员进展/);
  assert.match(prompt, /at or below 15,000 Chinese characters/);
  assert.match(prompt, /do not use Markdown tables/);
  assert.match(prompt, /every active project with one compact bullet/);
  assert.match(prompt, /every eligible member \(a GitLab contributor/);
  assert.match(prompt, /总分 NN\/100（证据置信度：高\/中\/低）/);
  assert.match(prompt, /目标与交付 40 points/);
  assert.match(prompt, /质量与可信证据 25 points/);
  assert.match(prompt, /协作与影响 20 points/);
  assert.match(prompt, /风险管理与闭环 15 points/);
  assert.match(prompt, /add up exactly to the displayed total/);
  assert.match(
    prompt,
    /interpolate only when the evidence clearly falls between/,
  );
  assert.match(prompt, /40=committed outcomes completed and validated/);
  assert.match(prompt, /25=strong multi-source validation/);
  assert.match(prompt, /20=documented material cross-team impact/);
  assert.match(prompt, /15=mitigation or closure verified/);
  assert.match(prompt, /label evidence as 周报、GitLab、or 双源印证/);
  assert.match(prompt, /Every awarded score needs an objective rationale/);
  assert.match(prompt, /described as unknown rather than failed/);
  assert.match(prompt, /never invent a default score/);
  assert.match(
    prompt,
    /Missing GitLab activity alone must not reduce the score/,
  );
  assert.match(
    prompt,
    /an unaccounted weekly-report name must be skipped rather than scored/,
  );
  assert.match(prompt, /Never combine distinct names/);
  assert.match(
    prompt,
    /concrete GitLab code, document, configuration, or test changes/,
  );
  assert.match(prompt, /inspect that contributor's commits/);
  assert.match(prompt, /must not replace the available analysis/);
  assert.match(prompt, /一个项目读取失败/);
  assert.match(prompt, /Return only the final report Markdown/);
});
