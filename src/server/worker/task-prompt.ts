import {
  dockerRunnerEngineLabels,
  type DockerRunnerEngine,
  type Priority,
  type RiskLevel,
  type TaskType,
} from "../office/catalog.ts";
import {
  hasHermesGitLabCredentials,
  type HermesGitLabRepository,
} from "../office/hermes-gitlab.ts";

export type RunnerTaskPromptInput = {
  engine: DockerRunnerEngine;
  title: string;
  summary?: string | null;
  taskType: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  gitlabRepository?: HermesGitLabRepository | null;
};

function hermesGitLabPromptLines(repository: HermesGitLabRepository | null) {
  if (!repository) return [];

  return [
    "GitLab repository context:",
    repository.repositoryUrl
      ? `Repository URL: ${repository.repositoryUrl}`
      : `Project path: ${repository.projectPath ?? repository.input}`,
    repository.ref ? `Ref: ${repository.ref}` : "Ref: default branch",
    hasHermesGitLabCredentials()
      ? "Git credentials are prepared in the runner environment; use normal HTTPS git commands without printing secrets."
      : "Git credentials are not configured for Hermes; report authentication failures clearly if the repository is private.",
  ];
}

export function buildRunnerTaskPrompt(input: RunnerTaskPromptInput) {
  return [
    `You are a ${dockerRunnerEngineLabels[input.engine]} execution worker inside Cola Virtual Office.`,
    `Task title: ${input.title}`,
    `Task summary: ${input.summary ?? "No summary provided."}`,
    `Task type: ${input.taskType}`,
    `Priority: ${input.priority}`,
    `Risk level: ${input.riskLevel}`,
    ...hermesGitLabPromptLines(input.gitlabRepository ?? null),
    "Use the workspace and files made available by the runner environment.",
    "Return a concise completion summary and mention any files changed.",
  ].join("\n");
}
