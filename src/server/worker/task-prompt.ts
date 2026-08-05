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
    "Apply a GitLab-account eligibility gate before any member-level analysis. A weekly-report member is eligible only when the name, username, or other explicit identity can be matched reliably to a GitLab user in roster or to a GitLab contributor identity; do not infer an account from a similar-looking name alone.",
    "Skip weekly-report members with no confirmed GitLab account entirely: do not create a 成员进展 heading, assign a score, or attribute GitLab evidence to them. You may report an aggregate skipped-member count and the identity-matching limitation under 数据范围与口径 or 数据缺口, without analyzing their individual work. If the roster could not be loaded, treat only contributor identities as confirmed accounts and do not guess from report names.",
    "A confirmed GitLab account with zero commits remains eligible. Mark the member as having no GitLab code evidence (usually 仅周报 or 无法判断), preserve verified non-code claims without treating the lack of commits as failure, and keep that member separate from unaccounted report names.",
    "Make weekly-report-to-code relevance a required analysis dimension, not an optional narrative. First decompose the weekly report into atomic work items (member, project, goal, deliverable, blocker, and claimed outcome), then compare each item with the same-period GitLab commit title/message, project, changed paths, file kinds, stats, tests, and available patch excerpts.",
    "Use these exact relation labels for every work item: 双源印证, 部分印证, 仅周报, 仅代码, 证据冲突, 无法判断. 双源印证 requires a concrete weekly-report claim and a concrete GitLab change that describes or implements the same scope; 部分印证 means only part of the claim is supported. Do not call a commit relevant solely because its author or date matches.",
    "A commit may support a reported deliverable only when you can state the evidence chain (weekly-report item -> member/project identity -> commit title or message -> changed path or patch/test signal). Unmatched or semantically unrelated commits must be reported as 仅代码 and must not directly increase that member's 目标与交付 or 质量与可信证据 score. Keep report-only non-code work as 仅周报 instead of treating missing commits as failure.",
    "When the weekly report and code disagree, prefer the concrete observable evidence for the discrepancy, label it 证据冲突, explain what cannot be verified, and give one follow-up action. State relation confidence (高/中/低) and quote only short, relevant report phrases or commit evidence; never paste large diffs or secrets.",
    "Treat commit counts and changed-line counts as coverage signals, not employee performance scores. Do not rank people by volume, use relative grading, or make a larger diff automatically produce a higher score.",
    "Group obvious aliases only when name/email evidence supports it. Do not expose email addresses in the report.",
    "Analyze document, code, configuration, and test changes from commit messages, paths, stats, and available patch excerpts. Do not quote secrets or large code fragments.",
    "For GitLab-derived project activity, only analyze projects represented by commits in the evidence dataset. Omit projects with zero commits from the GitLab project summary; report-only progress may still be included when clearly labeled as Feishu weekly-report evidence. projectsScanned is discovery coverage, not a request to discuss inactive projects.",
    "The projects array is the complete active-project summary from all collected commits. Include every project in that array; never let a high-volume project hide another active project.",
    "The contributors array contains complete member-level counts and project paths; each commits array is a representative evidence sample and may be truncated. Include every contributor found in the dataset because each contributor has a confirmed GitLab identity. Add roster members with no detected activity only when they can be matched unambiguously to a weekly-report member and therefore pass the account gate.",
    "coverage.commitCount is the collected total and coverage.sampledCommitCount is the representative commit sample included for detailed analysis.",
    "Write polished Markdown with these sections: 数据范围与口径、总体进展、周报与代码关联性、成员进展、跨项目协作与风险、后续建议、数据缺口. Under 数据范围与口径, state that scores are point-in-time evidence-based progress assessments rather than final performance ratings.",
    "Keep the final report at or below 15,000 Chinese characters. Use headings and compact bullet lists only; do not use Markdown tables, HTML, Mermaid, or long raw commit inventories because the result will be converted into Feishu document blocks.",
    "Under 总体进展, cover every active project with one compact bullet (project link plus one evidence-based result or, when details are unavailable, only its activity scope). Expand at most five high-signal projects and use no more than two commit links for each expanded project.",
    "Under 成员进展, give every eligible member (a GitLab contributor, or a roster member with an unambiguous weekly-report identity match) a separate level-3 heading formatted exactly as '### 姓名｜总分 NN/100（证据置信度：高/中/低）'. Never create a heading for a weekly-report member who has no confirmed GitLab account. Never combine distinct names into one entry. Merge aliases only when identity evidence is strong; if identities cannot be matched, skip the report-only name instead of explaining or scoring it.",
    "Score every member with this fixed 100-point rubric: 目标与交付 40 points, 质量与可信证据 25 points, 协作与影响 20 points, 风险管理与闭环 15 points. Use integer component scores and make the four awarded points add up exactly to the displayed total. Apply the same rubric to every member while allowing non-code artifacts and verified coordination outcomes to support the relevant dimensions.",
    "Use these scoring anchors and interpolate only when the evidence clearly falls between them: 目标与交付 0=no verified progress, 10=plan or early work, 20=material partial deliverable, 30=stated goals substantially completed, 40=committed outcomes completed and validated; 质量与可信证据 0=no verifiable artifact, 8=artifact without validation, 16=tests/review/documented validation, 25=strong multi-source validation with quality issues resolved; 协作与影响 0=no evidence, 7=verified individual-scope impact, 14=concrete review/unblocking/cross-project contribution, 20=documented material cross-team impact; 风险管理与闭环 0=no evidence, 5=risk identified, 10=risk plus owner/action, 15=mitigation or closure verified.",
    "Use the exact heading '## 周报与代码关联性'. Begin that section with a compact count of the six relation labels, then list each material weekly-report work item with its member/project, relation label, confidence, short report claim, concrete GitLab evidence or explicit absence, and conclusion. Also list high-signal 仅代码 commits that do not map to a report item. Do not hide a mismatch behind aggregate scores.",
    "For each eligible member, write exactly three information-dense bullets totaling roughly 300-500 Chinese characters: 分项评分 must show all four awarded scores in '目标与交付 NN/40；质量与可信证据 NN/25；协作与影响 NN/20；风险管理与闭环 NN/15' form; 客观依据 must connect each awarded score to specific weekly-report statements and concrete GitLab code, document, configuration, or test changes when available, explicitly state the applicable relation label and confidence, label evidence as 周报、GitLab、or 双源印证, and include up to two useful commit links; 风险与后续 must explain an evidence-backed blocker, discrepancy, unfinished item, or evidence gap and one specific next action. List all involved projects compactly, but do not substitute project names or commit counts for actual progress analysis.",
    "Every awarded score needs an objective rationale. Award points only for supported evidence; an unverified dimension earns no points but must be described as unknown rather than failed. When evidence is incomplete, score only the observable progress, lower the evidence confidence, and state the exact limitation; never invent a default score. Missing GitLab activity alone must not reduce the score for verified non-code work by an eligible account, but an unaccounted weekly-report name must be skipped rather than scored.",
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
