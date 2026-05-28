import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeHermesGitLabRepository,
  resolveHermesGitLabCredentials,
} from "./hermes-gitlab.ts";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  callback: () => T,
) {
  const previous = new Map(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

void test("Hermes GitLab repository input accepts project path", () => {
  withEnv(
    {
      COLA_HERMES_GITLAB_URL: "https://code.example.com/",
    },
    () => {
      assert.deepEqual(
        normalizeHermesGitLabRepository("xdream/robo-internal-state", "main"),
        {
          input: "xdream/robo-internal-state",
          projectPath: "xdream/robo-internal-state",
          repositoryUrl:
            "https://code.example.com/xdream/robo-internal-state.git",
          ref: "main",
        },
      );
    },
  );
});

void test("Hermes GitLab repository input accepts HTTPS clone URL", () => {
  assert.deepEqual(
    normalizeHermesGitLabRepository(
      "https://code.example.com/xdream/robo-internal-state.git",
      "",
    ),
    {
      input: "https://code.example.com/xdream/robo-internal-state.git",
      projectPath: "xdream/robo-internal-state",
      repositoryUrl: "https://code.example.com/xdream/robo-internal-state.git",
      ref: null,
    },
  );
});

void test("Hermes GitLab credentials prefer dedicated token", () => {
  withEnv(
    {
      GITLAB_URL: "https://global.example.com",
      GITLAB_API_TOKEN: "global-token",
      COLA_HERMES_GITLAB_URL: "https://code.example.com/",
      COLA_HERMES_GITLAB_USERNAME: "robot",
      COLA_HERMES_GITLAB_TOKEN: "hermes-token",
    },
    () => {
      assert.deepEqual(resolveHermesGitLabCredentials(), {
        url: "https://code.example.com",
        username: "robot",
        token: "hermes-token",
        source: "hermes",
      });
    },
  );
});
