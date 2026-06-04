import assert from "node:assert/strict";
import test from "node:test";

import { buildIsaacLabGitLabTokenEnv } from "./gitlab-token-env.js";

void test("buildIsaacLabGitLabTokenEnv injects GitLab token from Kubernetes Secret", () => {
  assert.deepEqual(
    buildIsaacLabGitLabTokenEnv({
      secretName: "isaac-gitlab-token",
      secretKey: "GITLAB_TOKEN",
      envName: "GITLAB_TOKEN",
    }),
    [
      {
        name: "GITLAB_TOKEN",
        valueFrom: {
          secretKeyRef: {
            name: "isaac-gitlab-token",
            key: "GITLAB_TOKEN",
            optional: true,
          },
        },
      },
    ],
  );
});

void test("buildIsaacLabGitLabTokenEnv can be disabled by empty platform config", () => {
  assert.deepEqual(
    buildIsaacLabGitLabTokenEnv({
      secretName: "",
      secretKey: "GITLAB_TOKEN",
      envName: "GITLAB_TOKEN",
    }),
    [],
  );
});
