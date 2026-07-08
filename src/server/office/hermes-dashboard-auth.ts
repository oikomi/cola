export type HermesDashboardAuthEnvVar = {
  name: string;
  value: string;
};

const HERMES_DASHBOARD_BASIC_AUTH_USERNAME = "cola";

export function buildHermesDashboardAuthEnv(
  dashboardToken: string | null | undefined,
): HermesDashboardAuthEnvVar[] {
  const token = dashboardToken?.trim();
  if (!token) return [];

  return [
    {
      name: "HERMES_DASHBOARD_BASIC_AUTH_USERNAME",
      value: HERMES_DASHBOARD_BASIC_AUTH_USERNAME,
    },
    {
      name: "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD",
      value: token,
    },
    {
      name: "HERMES_DASHBOARD_BASIC_AUTH_SECRET",
      value: token,
    },
  ];
}
