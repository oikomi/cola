export const officeTaskWorkflowValues = [
  "general",
  "gitlab_weekly_report",
] as const;

export const weeklyReportPeriodPresetValues = [
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "previous_week",
  "current_week",
] as const;

export type OfficeTaskWorkflow = (typeof officeTaskWorkflowValues)[number];
export type WeeklyReportPeriodPreset =
  (typeof weeklyReportPeriodPresetValues)[number];

export function isWeeklyReportPeriodPreset(
  value: unknown,
): value is WeeklyReportPeriodPreset {
  return (
    typeof value === "string" &&
    (weeklyReportPeriodPresetValues as readonly string[]).includes(value)
  );
}

export function isFeishuDocumentUrl(value: string | null | undefined) {
  if (!value) return false;

  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const isWebProtocol = url.protocol === "https:" || url.protocol === "http:";
    const isFeishuHost =
      hostname === "feishu.cn" ||
      hostname.endsWith(".feishu.cn") ||
      hostname === "larksuite.com" ||
      hostname.endsWith(".larksuite.com") ||
      hostname === "larkoffice.com" ||
      hostname.endsWith(".larkoffice.com");
    const segments = url.pathname.split("/").filter(Boolean);
    const documentTypeIndex = segments.findIndex((segment) =>
      ["docx", "docs", "doc", "wiki"].includes(segment),
    );

    return (
      isWebProtocol && isFeishuHost && Boolean(segments[documentTypeIndex + 1])
    );
  } catch {
    return false;
  }
}

export type WeeklyReportPeriod = {
  endAt: string;
  label: string;
  preset: WeeklyReportPeriodPreset;
  startAt: string;
  timezone: "Asia/Shanghai";
};

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLING_PERIOD_DAYS: Partial<Record<WeeklyReportPeriodPreset, number>> = {
  last_7_days: 7,
  last_14_days: 14,
  last_30_days: 30,
};

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
  const rollingDays = ROLLING_PERIOD_DAYS[preset];
  if (rollingDays) {
    const endAtMs = now.getTime();
    const startAtMs = endAtMs - rollingDays * DAY_MS;

    return {
      preset,
      startAt: new Date(startAtMs).toISOString(),
      endAt: new Date(endAtMs).toISOString(),
      timezone: "Asia/Shanghai",
      label: `${formatShanghaiDate(new Date(startAtMs))} 至 ${formatShanghaiDate(now)}`,
    };
  }

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
