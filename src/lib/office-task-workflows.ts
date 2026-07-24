export const officeTaskWorkflowValues = [
  "general",
  "gitlab_weekly_report",
] as const;

export const weeklyReportPeriodPresetValues = [
  "previous_week",
  "current_week",
] as const;

export type OfficeTaskWorkflow = (typeof officeTaskWorkflowValues)[number];
export type WeeklyReportPeriodPreset =
  (typeof weeklyReportPeriodPresetValues)[number];

export type WeeklyReportPeriod = {
  endAt: string;
  label: string;
  preset: WeeklyReportPeriodPreset;
  startAt: string;
  timezone: "Asia/Shanghai";
};

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatShanghaiDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("/", "-");
}

export function resolveWeeklyReportPeriod(
  preset: WeeklyReportPeriodPreset,
  now = new Date(),
): WeeklyReportPeriod {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  const daysSinceMonday = (shanghaiNow.getUTCDay() + 6) % 7;
  const currentWeekStart =
    Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate() - daysSinceMonday,
    ) - SHANGHAI_UTC_OFFSET_MS;
  const startAtMs =
    preset === "previous_week"
      ? currentWeekStart - 7 * DAY_MS
      : currentWeekStart;
  const endAtMs = preset === "previous_week" ? currentWeekStart : now.getTime();
  const displayEndMs = preset === "previous_week" ? endAtMs - DAY_MS : endAtMs;

  return {
    preset,
    startAt: new Date(startAtMs).toISOString(),
    endAt: new Date(endAtMs).toISOString(),
    timezone: "Asia/Shanghai",
    label: `${formatShanghaiDate(new Date(startAtMs))} 至 ${formatShanghaiDate(
      new Date(displayEndMs),
    )}`,
  };
}
