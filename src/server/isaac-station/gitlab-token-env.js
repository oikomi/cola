/**
 * @param {{ secretName?: string; secretKey?: string; envName?: string } | undefined} input
 */
export function buildIsaacLabGitLabTokenEnv(input) {
  const secretName = input?.secretName ?? "isaac-gitlab-token";
  const secretKey = input?.secretKey ?? "GITLAB_TOKEN";
  const envName = input?.envName ?? "GITLAB_TOKEN";

  if (!secretName) return [];
  if (!secretKey) return [];
  if (!envName) return [];

  return [
    {
      name: envName,
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: secretKey,
          optional: true,
        },
      },
    },
  ];
}
