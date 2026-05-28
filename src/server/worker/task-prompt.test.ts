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
