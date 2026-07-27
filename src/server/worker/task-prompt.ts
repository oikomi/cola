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
  documents: FeishuDocumentContext[] | undefined,
) {
  if (!activity) return [];

  const hasWeeklyReportDocument = Boolean(documents?.length);

  return [
    "You are preparing a company team progress analysis in Simplified Chinese.",
    `Reporting period: ${activity.period.label} (${activity.period.timezone}; start inclusive, end exclusive).`,
    `GitLab scope: all non-archived projects visible to the server token on ${activity.sourceUrl}.`,
    hasWeeklyReportDocument
      ? "Use both the fetched Feishu weekly report and the GitLab activity dataset as complementary evidence. The deliverable must synthesize them into an overall member-progress analysis, not summarize either source in isolation."
      : "The required Feishu weekly report could not be loaded. Continue with GitLab evidence, state this source gap prominently under 数据缺口, and do not imply that the result is a complete overall-progress analysis.",
    "Reconcile the two sources member by member: distinguish progress corroborated by both sources, report-only statements, GitLab-only changes, conflicting evidence, and genuinely missing evidence. Never invent work, people, impact, or completion status.",
    "Treat the Feishu weekly report as self-reported plans, outcomes, blockers, and non-code work; treat GitLab commits as implementation evidence. A missing GitLab commit is not proof that reported non-code progress did not happen, and a commit without a matching report entry must still be analyzed.",
    "Treat commit counts and changed-line counts as coverage signals, not employee performance scores. Do not rank people by volume.",
    "Group obvious aliases only when name/email evidence supports it. Do not expose email addresses in the report.",
    "Analyze document, code, configuration, and test changes from commit messages, paths, stats, and available patch excerpts. Do not quote secrets or large code fragments.",
    "For GitLab-derived project activity, only analyze projects represented by commits in the evidence dataset. Omit projects with zero commits from the GitLab project summary; report-only progress may still be included when clearly labeled as Feishu weekly-report evidence. projectsScanned is discovery coverage, not a request to discuss inactive projects.",
    "The projects array is the complete active-project summary from all collected commits. Include every project in that array; never let a high-volume project hide another active project.",
    "The contributors array contains complete member-level counts and project paths; each commits array is a representative evidence sample and may be truncated. Include every contributor found in the dataset. Mention roster members with no detected activity only when identity matching is unambiguous.",
    "coverage.commitCount is the collected total and coverage.sampledCommitCount is the representative commit sample included for detailed analysis.",
    "Write polished Markdown with these sections: 数据范围与口径、总体进展、成员进展、跨项目协作与风险、后续建议、数据缺口。",
    "Keep the final report at or below 15,000 Chinese characters. Use headings and compact bullet lists only; do not use Markdown tables, HTML, Mermaid, or long raw commit inventories because the result will be converted into Feishu document blocks.",
    "Under 总体进展, cover every active project with one compact bullet (project link plus one evidence-based result or, when details are unavailable, only its activity scope). Expand at most five high-signal projects and use no more than two commit links for each expanded project.",
    "Under 成员进展, give every member named in either the Feishu weekly report or GitLab contributors a separate level-3 heading and never combine distinct names into one entry. Merge aliases only when identity evidence is strong; if identities cannot be matched, keep them separate and explain the uncertainty.",
    "For each member, write two information-dense bullets totaling roughly 250-400 Chinese characters: 进展与证据 must connect the weekly-report statements to concrete code, document, configuration, or test changes when available and include up to two useful commit links; 影响、风险与后续 must explain collaboration impact, an evidence-backed blocker, risk, discrepancy, or unfinished item, and one specific next action. List all involved projects compactly, but do not substitute project names or commit counts for actual progress analysis.",
    "Before claiming that a contributor's concrete work is unavailable, inspect that contributor's commits and each commit's title, message, files, kinds, stats, and patch excerpts. When commits or files are present, analyze those changes; phrases such as '具体模块不可见' or '缺少进一步证据' must not replace the available analysis.",
    "When detailed evidence for a contributor is genuinely unavailable, state the exact evidence gap once and avoid inventing specifics; still keep that contributor separate and report the verified project scope.",
    "Keep 跨项目协作与风险 to at most eight bullets and 后续建议 to at most six bullets. Clearly label inference as inference.",
    "If collection or Feishu document-read warnings exist, surface them under 数据缺口. If no commits were collected, say that GitLab evidence is unavailable instead of fabricating it.",
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
    ...gitLabWeeklyReportPromptLines(
      input.gitlabWeeklyActivity,
      input.feishuDocuments,
    ),
    "Use the workspace and files made available by the runner environment.",
    input.gitlabWeeklyActivity
      ? "The requested deliverable is the report itself; do not return a separate completion summary."
      : "Return a concise completion summary and mention any files changed.",
  ].join("\n");
}
