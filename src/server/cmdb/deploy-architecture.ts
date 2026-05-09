export const supportedDockerTargetArchitectures = ["amd64", "arm64"] as const;

export type DockerTargetArchitecture =
  (typeof supportedDockerTargetArchitectures)[number];

export function normalizeDockerTargetArchitecture(
  value: string | null | undefined,
): DockerTargetArchitecture | null {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return null;

  switch (normalized) {
    case "amd64":
    case "x86-64":
    case "x64":
      return "amd64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      return null;
  }
}

export function dockerPlatformForArchitecture(
  architecture: DockerTargetArchitecture,
) {
  return `linux/${architecture}` as const;
}

export function buildDockerTargetArchitectureVariables(args: {
  targetArchitectures: Array<string | null | undefined>;
  primaryArchitecture?: string | null;
}) {
  const targetArchitectures = Array.from(
    new Set(
      args.targetArchitectures
        .map(normalizeDockerTargetArchitecture)
        .filter(
          (architecture): architecture is DockerTargetArchitecture =>
            Boolean(architecture),
        ),
    ),
  );
  const variables: Record<string, string> = {};
  const primaryArchitecture = normalizeDockerTargetArchitecture(
    args.primaryArchitecture,
  );

  if (targetArchitectures.length > 0) {
    variables.DEPLOY_TARGET_ARCHES = targetArchitectures.join(",");
  }

  if (targetArchitectures.length === 1) {
    const targetArchitecture = targetArchitectures[0]!;
    variables.DEPLOY_TARGET_ARCH = targetArchitecture;
    variables.DOCKER_DEFAULT_PLATFORM =
      dockerPlatformForArchitecture(targetArchitecture);
    variables.TARGETARCH = targetArchitecture;
    variables.TARGETPLATFORM = dockerPlatformForArchitecture(targetArchitecture);
  }

  if (primaryArchitecture) {
    variables.DEPLOY_ASSET_ARCH = primaryArchitecture;
    variables.DEPLOY_ASSET_PLATFORM =
      dockerPlatformForArchitecture(primaryArchitecture);
  }

  return variables;
}
