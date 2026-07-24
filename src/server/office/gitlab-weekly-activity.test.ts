import assert from "node:assert/strict";
import test from "node:test";

import { collectGitLabWeeklyActivity } from "./gitlab-weekly-activity.ts";
import { createGitLabWeeklyReportRequest } from "./weekly-report.ts";

function jsonResponse(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function requestUrlString(input: string | URL | Request) {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

void test("GitLab weekly collector groups commits and classifies changed files", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrlString(input);
    requestedUrls.push(url);
    assert.equal(
      (init?.headers as Record<string, string>)["PRIVATE-TOKEN"],
      "test-token",
    );

    if (url.includes("/api/v4/projects?")) {
      return jsonResponse([
        {
          id: 17,
          path_with_namespace: "team/cola",
          web_url: "https://code.example.com/team/cola",
        },
        {
          id: 18,
          path_with_namespace: "team/quiet-project",
          web_url: "https://code.example.com/team/quiet-project",
        },
      ]);
    }
    if (url.includes("/api/v4/users?")) {
      return jsonResponse([
        {
          id: 1,
          name: "苗宏",
          username: "miaohong",
          state: "active",
          web_url: "https://code.example.com/miaohong",
        },
      ]);
    }
    if (url.includes("/projects/18/repository/commits?")) {
      return jsonResponse([]);
    }
    if (url.includes("/projects/17/repository/commits?")) {
      return jsonResponse([
        {
          id: "abcdef123456",
          short_id: "abcdef12",
          title: "补充部署说明并修复任务队列",
          message: "补充部署说明并修复任务队列",
          author_name: "苗宏",
          author_email: "miao@example.com",
          authored_date: "2026-07-16T10:00:00.000+08:00",
          web_url: "https://code.example.com/team/cola/-/commit/abcdef123456",
          stats: { additions: 18, deletions: 3, total: 21 },
        },
      ]);
    }
    if (url.includes("/repository/commits/abcdef123456/diff?")) {
      return jsonResponse([
        {
          old_path: "docs/deploy.md",
          new_path: "docs/deploy.md",
          diff: "@@ -1 +1 @@\n-old\n+new deployment guidance",
        },
        {
          old_path: "src/queue.ts",
          new_path: "src/queue.ts",
          diff: "@@ -1 +1 @@\n-old\n+new",
        },
      ]);
    }

    return new Response("not found", { status: 404 });
  };
  const request = createGitLabWeeklyReportRequest({
    gitlabUrl: "https://code.example.com",
    periodPreset: "previous_week",
    now: new Date("2026-07-24T08:00:00.000Z"),
  });

  const activity = await collectGitLabWeeklyActivity(request, {
    credentials: {
      url: "https://code.example.com",
      username: "oauth2",
      token: "test-token",
      source: "hermes",
    },
    fetchImpl,
    now: new Date("2026-07-24T08:01:00.000Z"),
  });

  assert.equal(activity.coverage.projectsScanned, 2);
  assert.equal(activity.coverage.projectsWithActivity, 1);
  assert.equal(activity.coverage.commitCount, 1);
  assert.equal(activity.contributors[0]?.name, "苗宏");
  assert.deepEqual(
    activity.contributors[0]?.commits[0]?.files.map((file) => file.kind),
    ["document", "code"],
  );
  assert.ok(
    requestedUrls.some(
      (url) =>
        url.includes("since=2026-07-12T16%3A00%3A00.000Z") &&
        url.includes("until=2026-07-19T16%3A00%3A00.000Z"),
    ),
  );
  const quietProjectRequests = requestedUrls.filter((url) =>
    url.includes("/projects/18/"),
  );
  assert.equal(quietProjectRequests.length, 1);
  assert.match(quietProjectRequests[0] ?? "", /\/repository\/commits\?/);
  assert.doesNotMatch(JSON.stringify(activity), /quiet-project/);
  assert.doesNotMatch(JSON.stringify(activity), /test-token/);
});
