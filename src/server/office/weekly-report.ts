import {
  resolveWeeklyReportPeriod,
  type WeeklyReportPeriod,
  type WeeklyReportPeriodPreset,
} from "../../lib/office-task-workflows.ts";

export type GitLabWeeklyReportRequest = {
  gitlabUrl: string;
  kind: "gitlab_weekly_report";
  output: "feishu_docx";
  period: WeeklyReportPeriod;
  scope: "all_visible_projects";
  version: 1;
};

export type WeeklyReportDocument = {
  documentId: string;
  title: string;
  url: string;
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createGitLabWeeklyReportRequest(input: {
  gitlabUrl: string;
  now?: Date;
  periodPreset: WeeklyReportPeriodPreset;
}): GitLabWeeklyReportRequest {
  return {
    kind: "gitlab_weekly_report",
    version: 1,
    scope: "all_visible_projects",
    gitlabUrl: input.gitlabUrl.replace(/\/+$/, ""),
    period: resolveWeeklyReportPeriod(input.periodPreset, input.now),
    output: "feishu_docx",
  };
}

export function readGitLabWeeklyReportRequest(
  payload: unknown,
): GitLabWeeklyReportRequest | null {
  if (!isRecord(payload) || !isRecord(payload.workflow)) return null;

  const workflow = payload.workflow;
  if (
    workflow.kind !== "gitlab_weekly_report" ||
    workflow.version !== 1 ||
    workflow.scope !== "all_visible_projects" ||
    workflow.output !== "feishu_docx" ||
    typeof workflow.gitlabUrl !== "string" ||
    !isRecord(workflow.period)
  ) {
    return null;
  }

  const period = workflow.period;
  if (
    (period.preset !== "previous_week" && period.preset !== "current_week") ||
    typeof period.startAt !== "string" ||
    typeof period.endAt !== "string" ||
    period.timezone !== "Asia/Shanghai" ||
    typeof period.label !== "string"
  ) {
    return null;
  }

  return {
    kind: "gitlab_weekly_report",
    version: 1,
    scope: "all_visible_projects",
    gitlabUrl: workflow.gitlabUrl,
    output: "feishu_docx",
    period: {
      preset: period.preset,
      startAt: period.startAt,
      endAt: period.endAt,
      timezone: "Asia/Shanghai",
      label: period.label,
    },
  };
}

export function readWeeklyReportDocument(
  payload: unknown,
): WeeklyReportDocument | null {
  if (!isRecord(payload) || !isRecord(payload.weeklyReport)) return null;
  const report = payload.weeklyReport;
  if (!isRecord(report.document)) return null;
  const document = report.document;

  if (
    typeof document.documentId !== "string" ||
    typeof document.title !== "string" ||
    typeof document.url !== "string"
  ) {
    return null;
  }

  return {
    documentId: document.documentId,
    title: document.title,
    url: document.url,
    warnings: Array.isArray(document.warnings)
      ? document.warnings.filter(
          (warning): warning is string => typeof warning === "string",
        )
      : [],
  };
}

export function attachWeeklyReportDocument(
  payload: unknown,
  request: GitLabWeeklyReportRequest,
  document: WeeklyReportDocument,
): Record<string, unknown> {
  const current = isRecord(payload) ? payload : {};
  const currentWeeklyReport = isRecord(current.weeklyReport)
    ? current.weeklyReport
    : {};

  return {
    ...current,
    weeklyReport: {
      ...currentWeeklyReport,
      kind: request.kind,
      period: request.period,
      sourceUrl: request.gitlabUrl,
      document,
    },
  };
}
