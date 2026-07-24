import type { HermesGitLabCredentials } from "./hermes-gitlab.ts";
import { resolveHermesGitLabCredentials } from "./hermes-gitlab.ts";
import type { GitLabWeeklyReportRequest } from "./weekly-report.ts";

const MAX_PROJECTS = 200;
const MAX_USERS = 500;
const MAX_COMMITS_PER_PROJECT = 1_000;
const MAX_REPORT_COMMITS = 240;
const MAX_DETAILED_COMMITS = 160;
const MAX_FILES_PER_COMMIT = 60;
const MAX_DIFF_CHARS_PER_FILE = 900;
const MAX_TOTAL_DIFF_CHARS = 72_000;
const API_CONCURRENCY = 6;

type GitLabProject = {
  default_branch?: string | null;
  id: number;
  last_activity_at?: string;
  path_with_namespace: string;
  web_url: string;
};

type GitLabUser = {
  bot?: boolean;
  id: number;
  name: string;
  state?: string;
  username: string;
  web_url?: string;
};

type GitLabCommit = {
  author_email: string;
  author_name: string;
  authored_date: string;
  committed_date?: string;
  id: string;
  message?: string;
  short_id: string;
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
  title: string;
  web_url: string;
};

type GitLabCommitDiff = {
  collapsed?: boolean;
  deleted_file?: boolean;
  diff?: string;
  new_file?: boolean;
  new_path: string;
  old_path: string;
  renamed_file?: boolean;
  too_large?: boolean;
};

export type GitLabWeeklyActivityFile = {
  change: "added" | "deleted" | "modified" | "renamed";
  kind: "code" | "config" | "document" | "other" | "test";
  patchExcerpt: string | null;
  path: string;
  truncated: boolean;
};

export type GitLabWeeklyActivityCommit = {
  authoredAt: string;
  files: GitLabWeeklyActivityFile[];
  filesTruncated: boolean;
  message: string;
  projectPath: string;
  projectUrl: string;
  sha: string;
  shortSha: string;
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
  title: string;
  url: string;
};

export type GitLabWeeklyActivityContributor = {
  commits: GitLabWeeklyActivityCommit[];
  commitCount: number;
  commitsTruncated: boolean;
  email: string | null;
  name: string;
  projectPaths: string[];
};

export type GitLabWeeklyActivityProject = {
  commitCount: number;
  contributorCount: number;
  contributors: string[];
  latestCommitAt: string;
  path: string;
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
  url: string;
};

export type GitLabWeeklyActivity = {
  contributors: GitLabWeeklyActivityContributor[];
  coverage: {
    commitCount: number;
    commitsTruncated: boolean;
    contributorCount: number;
    detailedCommitCount: number;
    projectsScanned: number;
    projectsTruncated: boolean;
    projectsWithActivity: number;
    rosterCount: number;
    sampledCommitCount: number;
  };
  generatedAt: string;
  period: GitLabWeeklyReportRequest["period"];
  projects: GitLabWeeklyActivityProject[];
  roster: Array<{
    name: string;
    username: string;
    url: string | null;
  }>;
  sourceUrl: string;
  warnings: string[];
};

export function gitLabWeeklyActivityFailure(
  request: GitLabWeeklyReportRequest,
  error: unknown,
  now = new Date(),
): GitLabWeeklyActivity {
  return {
    generatedAt: now.toISOString(),
    sourceUrl: request.gitlabUrl,
    period: request.period,
    roster: [],
    projects: [],
    contributors: [],
    coverage: {
      projectsScanned: 0,
      projectsWithActivity: 0,
      projectsTruncated: false,
      rosterCount: 0,
      commitCount: 0,
      commitsTruncated: false,
      contributorCount: 0,
      detailedCommitCount: 0,
      sampledCommitCount: 0,
    },
    warnings: [
      `GitLab 周报数据采集失败：${error instanceof Error ? error.message : "未知错误"}`,
    ],
  };
}

type FetchPageResult<T> = {
  items: T[];
  truncated: boolean;
};

type ProjectCommit = {
  commit: GitLabCommit;
  project: GitLabProject;
};

function normalizedIdentity(commit: GitLabCommit) {
  return (
    commit.author_email.trim().toLowerCase() ||
    commit.author_name.trim().toLowerCase()
  );
}

function apiUrl(
  credentials: HermesGitLabCredentials,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
) {
  const url = new URL(
    `${credentials.url.replace(/\/+$/, "")}/api/v4/${path.replace(/^\/+/, "")}`,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function responseError(response: Response) {
  const fallback = `HTTP ${response.status}`;
  try {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === "string") return payload.message;
  } catch {
    // Keep the status-only fallback when GitLab did not return JSON.
  }
  return fallback;
}

async function fetchPages<T>(input: {
  credentials: HermesGitLabCredentials;
  fetchImpl: typeof fetch;
  maxItems: number;
  maxPages: number;
  params?: Record<string, string | number | boolean | undefined>;
  path: string;
}): Promise<FetchPageResult<T>> {
  const items: T[] = [];
  let page = 1;
  let hasMore = false;

  do {
    const response = await input.fetchImpl(
      apiUrl(input.credentials, input.path, {
        ...input.params,
        page,
        per_page: Math.min(100, input.maxItems),
      }),
      {
        headers: {
          Accept: "application/json",
          "PRIVATE-TOKEN": input.credentials.token,
        },
      },
    );

    if (!response.ok) {
      throw new Error(await responseError(response));
    }

    const pageItems = (await response.json()) as T[];
    items.push(...pageItems);
    const nextPage = response.headers.get("x-next-page")?.trim();
    hasMore = Boolean(nextPage) || pageItems.length === 100;
    page = nextPage ? Number(nextPage) : page + 1;
  } while (hasMore && page <= input.maxPages && items.length < input.maxItems);

  return {
    items: items.slice(0, input.maxItems),
    truncated: hasMore || items.length > input.maxItems,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function classifyFile(path: string): GitLabWeeklyActivityFile["kind"] {
  const normalized = path.toLowerCase();
  if (
    /(^|\/)(docs?|documentation)\//.test(normalized) ||
    /\.(md|mdx|rst|adoc|txt|pdf|docx?)$/.test(normalized)
  ) {
    return "document";
  }
  if (
    /(^|\/)(__tests__|tests?|specs?)\//.test(normalized) ||
    /\.(test|spec)\.[^.]+$/.test(normalized)
  ) {
    return "test";
  }
  if (
    /(^|\/)(\.gitlab-ci|dockerfile|makefile)/.test(normalized) ||
    /\.(ya?ml|toml|ini|conf|json)$/.test(normalized)
  ) {
    return "config";
  }
  if (/\.[a-z0-9]{1,8}$/.test(normalized)) return "code";
  return "other";
}

function fileChange(
  diff: GitLabCommitDiff,
): GitLabWeeklyActivityFile["change"] {
  if (diff.new_file) return "added";
  if (diff.deleted_file) return "deleted";
  if (diff.renamed_file) return "renamed";
  return "modified";
}

function projectCommitKey(item: ProjectCommit) {
  return `${item.project.id}:${item.commit.id}`;
}

function selectCommitsWithCoverage(
  commits: ProjectCommit[],
  maxItems: number,
  coverageKeys: Array<(item: ProjectCommit) => string>,
) {
  const selected: ProjectCommit[] = [];
  const selectedKeys = new Set<string>();

  const add = (item: ProjectCommit) => {
    if (selected.length >= maxItems) return;
    const key = projectCommitKey(item);
    if (selectedKeys.has(key)) return;
    selected.push(item);
    selectedKeys.add(key);
  };

  for (const coverageKey of coverageKeys) {
    const seen = new Set<string>();
    for (const item of commits) {
      const key = coverageKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      add(item);
    }
  }

  for (const item of commits) {
    if (selected.length >= maxItems) break;
    add(item);
  }

  return selected.sort(
    (left, right) =>
      Date.parse(right.commit.authored_date) -
      Date.parse(left.commit.authored_date),
  );
}

function selectReportCommits(commits: ProjectCommit[]) {
  return selectCommitsWithCoverage(commits, MAX_REPORT_COMMITS, [
    (item) => normalizedIdentity(item.commit),
    (item) => String(item.project.id),
  ]);
}

function selectCommitsForDetails(commits: ProjectCommit[]) {
  return selectCommitsWithCoverage(commits, MAX_DETAILED_COMMITS, [
    (item) => String(item.project.id),
    (item) => normalizedIdentity(item.commit),
  ]);
}

function summarizeProjects(
  commits: ProjectCommit[],
): GitLabWeeklyActivityProject[] {
  const projectMap = new Map<
    number,
    GitLabWeeklyActivityProject & { contributorNames: Map<string, string> }
  >();

  for (const item of commits) {
    const current = projectMap.get(item.project.id) ?? {
      path: item.project.path_with_namespace,
      url: item.project.web_url,
      commitCount: 0,
      contributorCount: 0,
      contributors: [],
      contributorNames: new Map<string, string>(),
      latestCommitAt: item.commit.authored_date,
      stats: { additions: 0, deletions: 0, total: 0 },
    };
    const contributorKey = normalizedIdentity(item.commit);
    if (!current.contributorNames.has(contributorKey)) {
      current.contributorNames.set(
        contributorKey,
        item.commit.author_name.trim() || "未知提交者",
      );
    }
    current.commitCount += 1;
    current.stats.additions += item.commit.stats?.additions ?? 0;
    current.stats.deletions += item.commit.stats?.deletions ?? 0;
    current.stats.total += item.commit.stats?.total ?? 0;
    if (
      Date.parse(item.commit.authored_date) > Date.parse(current.latestCommitAt)
    ) {
      current.latestCommitAt = item.commit.authored_date;
    }
    projectMap.set(item.project.id, current);
  }

  return Array.from(projectMap.values())
    .map(({ contributorNames, ...project }) => ({
      ...project,
      contributorCount: contributorNames.size,
      contributors: Array.from(contributorNames.values()).sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    }))
    .sort(
      (left, right) =>
        Date.parse(right.latestCommitAt) - Date.parse(left.latestCommitAt) ||
        left.path.localeCompare(right.path),
    );
}

function compactCommitMessage(commit: GitLabCommit) {
  const message = (commit.message ?? commit.title).replace(/\s+/g, " ").trim();
  return message.length <= 500 ? message : `${message.slice(0, 499)}…`;
}

function baseCommit(item: ProjectCommit): GitLabWeeklyActivityCommit {
  return {
    authoredAt: item.commit.authored_date,
    files: [],
    filesTruncated: false,
    message: compactCommitMessage(item.commit),
    projectPath: item.project.path_with_namespace,
    projectUrl: item.project.web_url,
    sha: item.commit.id,
    shortSha: item.commit.short_id,
    stats: {
      additions: item.commit.stats?.additions ?? 0,
      deletions: item.commit.stats?.deletions ?? 0,
      total: item.commit.stats?.total ?? 0,
    },
    title: item.commit.title,
    url: item.commit.web_url,
  };
}

export async function collectGitLabWeeklyActivity(
  request: GitLabWeeklyReportRequest,
  options: {
    credentials?: HermesGitLabCredentials | null;
    fetchImpl?: typeof fetch;
    now?: Date;
  } = {},
): Promise<GitLabWeeklyActivity> {
  const credentials =
    options.credentials === undefined
      ? resolveHermesGitLabCredentials()
      : options.credentials;
  if (!credentials) {
    throw new Error("GitLab 周报采集缺少服务端访问凭据。");
  }

  if (new URL(credentials.url).origin !== new URL(request.gitlabUrl).origin) {
    throw new Error("周报任务的 GitLab 实例与服务端配置不一致。");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const projectsResult = await fetchPages<GitLabProject>({
    credentials,
    fetchImpl,
    path: "projects",
    params: {
      archived: false,
      order_by: "last_activity_at",
      simple: true,
      sort: "desc",
    },
    maxItems: MAX_PROJECTS,
    maxPages: Math.ceil(MAX_PROJECTS / 100),
  });

  let roster: GitLabWeeklyActivity["roster"] = [];
  try {
    const usersResult = await fetchPages<GitLabUser>({
      credentials,
      fetchImpl,
      path: "users",
      params: {
        active: true,
        without_project_bots: true,
      },
      maxItems: MAX_USERS,
      maxPages: Math.ceil(MAX_USERS / 100),
    });
    roster = usersResult.items
      .filter((user) => user.state !== "blocked" && !user.bot)
      .map((user) => ({
        name: user.name,
        username: user.username,
        url: user.web_url ?? null,
      }));
    if (usersResult.truncated) {
      warnings.push(`GitLab 成员超过 ${MAX_USERS} 人，成员清单已截断。`);
    }
  } catch (error) {
    warnings.push(
      `GitLab 成员清单读取失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }

  const projectCommitResults = await mapWithConcurrency(
    projectsResult.items,
    API_CONCURRENCY,
    async (project) => {
      try {
        const result = await fetchPages<GitLabCommit>({
          credentials,
          fetchImpl,
          path: `projects/${project.id}/repository/commits`,
          params: {
            all: true,
            since: request.period.startAt,
            until: request.period.endAt,
            with_stats: true,
          },
          maxItems: MAX_COMMITS_PER_PROJECT,
          maxPages: Math.ceil(MAX_COMMITS_PER_PROJECT / 100),
        });
        if (result.truncated) {
          warnings.push(
            `${project.path_with_namespace} 的提交超过单项目 ${MAX_COMMITS_PER_PROJECT} 条采集上限，已截断。`,
          );
        }
        return result.items.map((commit) => ({ project, commit }));
      } catch (error) {
        warnings.push(
          `${project.path_with_namespace} 提交读取失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
        return [];
      }
    },
  );

  const deduplicatedCommits = new Map<string, ProjectCommit>();
  for (const item of projectCommitResults.flat()) {
    deduplicatedCommits.set(`${item.project.id}:${item.commit.id}`, item);
  }
  const allCommits = Array.from(deduplicatedCommits.values()).sort(
    (left, right) =>
      Date.parse(right.commit.authored_date) -
      Date.parse(left.commit.authored_date),
  );
  const commits = selectReportCommits(allCommits);
  const commitsTruncated = allCommits.length > commits.length;
  const detailedCommits = selectCommitsForDetails(commits);
  let remainingDiffChars = MAX_TOTAL_DIFF_CHARS;

  const details = await mapWithConcurrency(
    detailedCommits,
    API_CONCURRENCY,
    async (item) => {
      try {
        const result = await fetchPages<GitLabCommitDiff>({
          credentials,
          fetchImpl,
          path: `projects/${item.project.id}/repository/commits/${encodeURIComponent(item.commit.id)}/diff`,
          maxItems: MAX_FILES_PER_COMMIT,
          maxPages: 1,
        });
        const commit = baseCommit(item);
        commit.filesTruncated = result.truncated;
        commit.files = result.items.map((diff) => {
          const patch = diff.diff?.trim() ?? "";
          const allowedLength = Math.max(
            0,
            Math.min(MAX_DIFF_CHARS_PER_FILE, remainingDiffChars),
          );
          const patchExcerpt =
            allowedLength > 0 ? patch.slice(0, allowedLength) : "";
          remainingDiffChars -= patchExcerpt.length;

          return {
            path: diff.new_path || diff.old_path,
            kind: classifyFile(diff.new_path || diff.old_path),
            change: fileChange(diff),
            patchExcerpt: patchExcerpt || null,
            truncated:
              Boolean(diff.collapsed) ||
              Boolean(diff.too_large) ||
              patch.length > patchExcerpt.length,
          };
        });
        return commit;
      } catch (error) {
        warnings.push(
          `${item.project.path_with_namespace}@${item.commit.short_id} 变更详情读取失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
        return baseCommit(item);
      }
    },
  );

  const detailByCommit = new Map(
    detailedCommits.map((item, index) => [
      projectCommitKey(item),
      details[index]!,
    ]),
  );
  const sampledCommitKeys = new Set(commits.map(projectCommitKey));
  const contributorMap = new Map<
    string,
    {
      email: string | null;
      items: ProjectCommit[];
      name: string;
      projectPaths: Set<string>;
    }
  >();

  for (const item of allCommits) {
    const key = normalizedIdentity(item.commit);
    const contributor = contributorMap.get(key) ?? {
      name: item.commit.author_name.trim() || "未知提交者",
      email: item.commit.author_email.trim() || null,
      items: [],
      projectPaths: new Set<string>(),
    };
    contributor.items.push(item);
    contributor.projectPaths.add(item.project.path_with_namespace);
    contributorMap.set(key, contributor);
  }

  const contributors = Array.from(contributorMap.values())
    .map((contributor): GitLabWeeklyActivityContributor => {
      const sampledItems = contributor.items.filter((item) =>
        sampledCommitKeys.has(projectCommitKey(item)),
      );
      return {
        name: contributor.name,
        email: contributor.email,
        commitCount: contributor.items.length,
        commitsTruncated: sampledItems.length < contributor.items.length,
        projectPaths: Array.from(contributor.projectPaths).sort(),
        commits: sampledItems.map(
          (item) =>
            detailByCommit.get(projectCommitKey(item)) ?? baseCommit(item),
        ),
      };
    })
    .sort(
      (left, right) =>
        right.commitCount - left.commitCount ||
        left.name.localeCompare(right.name, "zh-CN"),
    );
  const projects = summarizeProjects(allCommits);

  if (projectsResult.truncated) {
    warnings.push(`可见项目超过 ${MAX_PROJECTS} 个，项目清单已截断。`);
  }
  if (commitsTruncated) {
    warnings.push(
      `所选周期共采集 ${allCommits.length} 条提交；报告保留 ${commits.length} 条代表提交，项目和成员汇总仍按完整采集结果计算。`,
    );
  }
  if (remainingDiffChars <= 0) {
    warnings.push("代码与文档变更片段达到上下文上限，后续提交仅保留元数据。");
  }

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    sourceUrl: credentials.url,
    period: request.period,
    roster,
    projects,
    contributors,
    coverage: {
      projectsScanned: projectsResult.items.length,
      projectsWithActivity: projects.length,
      projectsTruncated: projectsResult.truncated,
      rosterCount: roster.length,
      commitCount: allCommits.length,
      sampledCommitCount: commits.length,
      commitsTruncated,
      contributorCount: contributors.length,
      detailedCommitCount: detailedCommits.length,
    },
    warnings,
  };
}
