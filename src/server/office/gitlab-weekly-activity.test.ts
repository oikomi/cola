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
  assert.equal(activity.coverage.sampledCommitCount, 1);
  assert.deepEqual(
    activity.projects.map((project) => project.path),
    ["team/cola"],
  );
  assert.equal(activity.contributors[0]?.name, "苗宏");
  assert.equal(activity.contributors[0]?.commitCount, 1);
  assert.deepEqual(activity.contributors[0]?.projectPaths, ["team/cola"]);
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

void test("high-volume projects cannot hide other active projects", async () => {
  const busyCommits = Array.from({ length: 240 }, (_, index) => {
    const id = `busy-${String(index).padStart(3, "0")}`;
    return {
      id,
      short_id: id,
      title: `高频项目提交 ${index}`,
      message: `高频项目提交 ${index}`,
      author_name: "高频提交者",
      author_email: "busy@example.com",
      authored_date: new Date(
        Date.parse("2026-07-24T07:00:00.000Z") - index * 1_000,
      ).toISOString(),
      web_url: `https://code.example.com/team/busy/-/commit/${id}`,
      stats: { additions: 1, deletions: 0, total: 1 },
    };
  });
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(requestUrlString(input));

    if (url.pathname === "/api/v4/projects") {
      return jsonResponse([
        {
          id: 30,
          path_with_namespace: "team/busy",
          web_url: "https://code.example.com/team/busy",
        },
        {
          id: 31,
          path_with_namespace: "team/smaller-but-active",
          web_url: "https://code.example.com/team/smaller-but-active",
        },
      ]);
    }
    if (url.pathname === "/api/v4/users") return jsonResponse([]);
    if (url.pathname === "/api/v4/projects/30/repository/commits") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const start = (page - 1) * 100;
      const items = busyCommits.slice(start, start + 100);
      return jsonResponse(
        items,
        page < 3 ? { "x-next-page": String(page + 1) } : {},
      );
    }
    if (url.pathname === "/api/v4/projects/31/repository/commits") {
      return jsonResponse([
        {
          id: "smaller-commit",
          short_id: "smaller",
          title: "较早但必须保留的项目交付",
          message: "较早但必须保留的项目交付",
          author_name: "另一位提交者",
          author_email: "other@example.com",
          authored_date: "2026-07-20T01:00:00.000Z",
          web_url:
            "https://code.example.com/team/smaller-but-active/-/commit/smaller-commit",
          stats: { additions: 5, deletions: 1, total: 6 },
        },
      ]);
    }
    if (url.pathname.endsWith("/diff")) return jsonResponse([]);

    return new Response("not found", { status: 404 });
  };
  const request = createGitLabWeeklyReportRequest({
    gitlabUrl: "https://code.example.com",
    periodPreset: "last_7_days",
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
  });

  assert.equal(activity.coverage.commitCount, 241);
  assert.equal(activity.coverage.sampledCommitCount, 96);
  assert.equal(activity.coverage.projectsWithActivity, 2);
  assert.equal(activity.coverage.commitsTruncated, true);
  assert.deepEqual(activity.projects.map((project) => project.path).sort(), [
    "team/busy",
    "team/smaller-but-active",
  ]);
  const smallerContributor = activity.contributors.find(
    (contributor) => contributor.name === "另一位提交者",
  );
  assert.equal(smallerContributor?.commitCount, 1);
  assert.equal(
    smallerContributor?.commits[0]?.projectPath,
    "team/smaller-but-active",
  );
  assert.match(activity.warnings.join("\n"), /完整采集结果计算/);
});
