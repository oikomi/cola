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
import type { FeishuDocumentContext } from "../office/feishu-docs.ts";
import type { GitLabWeeklyActivity } from "../office/gitlab-weekly-activity.ts";

export type RunnerTaskPromptInput = {
  engine: DockerRunnerEngine;
  title: string;
  summary?: string | null;
  taskType: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  gitlabRepository?: HermesGitLabRepository | null;
  feishuDocuments?: FeishuDocumentContext[];
  feishuDocumentWarnings?: string[];
  gitlabWeeklyActivity?: GitLabWeeklyActivity | null;
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

function feishuDocumentPromptLines(
  documents: FeishuDocumentContext[] | undefined,
  warnings: string[] | undefined,
) {
  const lines: string[] = [];

  if (documents?.length) {
    lines.push(
      "Feishu document context:",
      "The following document content was fetched by Cola server with the Feishu OpenAPI. Do not open the Feishu web URL again unless the user explicitly asks.",
    );

    documents.forEach((document, index) => {
      lines.push(
        `Document ${index + 1}: ${document.title ?? document.sourceUrl}`,
        `Type: ${document.type}`,
        `Source URL: ${document.sourceUrl}`,
        "Content:",
        document.content,
      );
    });
  }

  if (warnings?.length) {
    lines.push(
      "Feishu document read warnings:",
      ...warnings.map((warning) => `- ${warning}`),
    );
  }

  return lines;
}

function gitLabWeeklyReportPromptLines(
  activity: GitLabWeeklyActivity | null | undefined,
) {
  if (!activity) return [];

  return [
    "You are preparing a company GitLab team weekly report in Simplified Chinese.",
    `Reporting period: ${activity.period.label} (${activity.period.timezone}; start inclusive, end exclusive).`,
    `GitLab scope: all non-archived projects visible to the server token on ${activity.sourceUrl}.`,
    "Use the evidence dataset below as the source of truth. Never invent work, people, impact, or completion status.",
    "Treat commit counts and changed-line counts as coverage signals, not employee performance scores. Do not rank people by volume.",
    "Group obvious aliases only when name/email evidence supports it. Do not expose email addresses in the report.",
    "Analyze document, code, configuration, and test changes from commit messages, paths, stats, and available patch excerpts. Do not quote secrets or large code fragments.",
    "Only analyze projects represented by commits in the evidence dataset. Omit projects with zero commits in the reporting period entirely; projectsScanned is discovery coverage, not a request to discuss inactive projects.",
    "The projects array is the complete active-project summary from all collected commits. Include every project in that array; never let a high-volume project hide another active project.",
    "The contributors array contains complete member-level counts and project paths; each commits array is a representative evidence sample and may be truncated. Include every contributor found in the dataset. Mention roster members with no detected activity only when identity matching is unambiguous.",
    "coverage.commitCount is the collected total and coverage.sampledCommitCount is the representative commit sample included for detailed analysis.",
    "Write polished Markdown with these sections: 数据范围与口径、总体进展、成员工作情况、跨项目协作与风险、下周建议、数据缺口。",
    "Keep the final report at or below 15,000 Chinese characters. Use headings and compact bullet lists only; do not use Markdown tables, HTML, Mermaid, or long raw commit inventories because the result will be converted into Feishu document blocks.",
    "Under 总体进展, cover every active project with one compact bullet (project link plus one evidence-based result or, when details are unavailable, only its activity scope). Expand at most five high-signal projects and use no more than two commit links for each expanded project.",
    "Under 成员工作情况, give every contributor a separate level-3 heading and never combine distinct contributor names into one entry. Merge aliases only when identity evidence is strong.",
    "For each contributor, write two information-dense bullets totaling roughly 250-400 Chinese characters: 本周交付与证据 must name concrete code, document, configuration, or test changes from representative commit titles/messages/files and include up to two useful commit links; 影响、风险与后续 must explain collaboration impact, an evidence-backed risk or unfinished item, and one specific next action. List all involved projects compactly, but do not substitute project names or commit counts for actual work analysis.",
    "When detailed evidence for a contributor is genuinely unavailable, state the exact evidence gap once and avoid inventing specifics; still keep that contributor separate and report the verified project scope.",
    "Keep 跨项目协作与风险 to at most eight bullets and 下周建议 to at most six bullets. Clearly label inference as inference.",
    "If collection warnings exist, surface them under 数据缺口. If no commits were collected, say that evidence is unavailable instead of fabricating a report.",
    "Return only the final report Markdown. Do not describe your process and do not modify any repository.",
    "GitLab weekly activity dataset:",
    JSON.stringify(activity, null, 2),
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
    ...feishuDocumentPromptLines(
      input.feishuDocuments,
      input.feishuDocumentWarnings,
    ),
    ...gitLabWeeklyReportPromptLines(input.gitlabWeeklyActivity),
    "Use the workspace and files made available by the runner environment.",
    input.gitlabWeeklyActivity
      ? "The requested deliverable is the report itself; do not return a separate completion summary."
      : "Return a concise completion summary and mention any files changed.",
  ].join("\n");
}
