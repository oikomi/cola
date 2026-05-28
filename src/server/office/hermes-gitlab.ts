export type HermesGitLabCredentials = {
  url: string;
  username: string;
  token: string;
  source: "hermes" | "global";
};

export type HermesGitLabRepository = {
  input: string;
  projectPath: string | null;
  repositoryUrl: string | null;
  ref: string | null;
};

function trimEnv(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stripGitSuffix(value: string) {
  return value.replace(/\.git$/i, "");
}

export function resolveHermesGitLabCredentials(): HermesGitLabCredentials | null {
  const url =
    trimEnv(process.env.COLA_HERMES_GITLAB_URL) ??
    trimEnv(process.env.GITLAB_URL);
  const hermesToken = trimEnv(process.env.COLA_HERMES_GITLAB_TOKEN);
  const globalToken = trimEnv(process.env.GITLAB_API_TOKEN);
  const token = hermesToken ?? globalToken;

  if (!url || !token) return null;

  return {
    url: stripTrailingSlash(url),
    username: trimEnv(process.env.COLA_HERMES_GITLAB_USERNAME) ?? "oauth2",
    token,
    source: hermesToken ? "hermes" : "global",
  };
}

export function hasHermesGitLabCredentials() {
  return Boolean(resolveHermesGitLabCredentials());
}

export function normalizeHermesGitLabRepository(
  repositoryInput: string | null | undefined,
  refInput?: string | null,
): HermesGitLabRepository | null {
  const input = trimEnv(repositoryInput);
  if (!input) return null;

  const ref = trimEnv(refInput);
  const normalizedInput = stripTrailingSlash(input);

  try {
    const url = new URL(normalizedInput);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const projectPath = stripGitSuffix(
        decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, ""),
      );

      return {
        input: normalizedInput,
        projectPath: projectPath || null,
        repositoryUrl: normalizedInput,
        ref,
      };
    }
  } catch {
    // Treat non-URL input as a GitLab project path like group/project.
  }

  const projectPath = stripGitSuffix(normalizedInput.replace(/^\/+|\/+$/g, ""));
  if (!projectPath) return null;

  const baseUrl =
    trimEnv(process.env.COLA_HERMES_GITLAB_URL) ??
    trimEnv(process.env.GITLAB_URL);

  return {
    input: normalizedInput,
    projectPath,
    repositoryUrl: baseUrl
      ? `${stripTrailingSlash(baseUrl)}/${projectPath}.git`
      : null,
    ref,
  };
}

export function readHermesGitLabRepository(
  payload: unknown,
): HermesGitLabRepository | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const gitlab = "gitlab" in payload ? payload.gitlab : null;
  if (!gitlab || typeof gitlab !== "object" || Array.isArray(gitlab)) {
    return null;
  }

  const repositoryInput =
    "repository" in gitlab && typeof gitlab.repository === "string"
      ? gitlab.repository
      : "projectPath" in gitlab && typeof gitlab.projectPath === "string"
        ? gitlab.projectPath
        : null;
  const ref =
    "ref" in gitlab && typeof gitlab.ref === "string" ? gitlab.ref : null;

  return normalizeHermesGitLabRepository(repositoryInput, ref);
}
