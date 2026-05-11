export type UnslothStudioImageOption = {
  label: string;
  image: string;
  description: string;
};

const MAX_UNSLOTH_STUDIO_IMAGE_OPTIONS = 5;

const DEFAULT_UNSLOTH_STUDIO_IMAGE_OPTIONS = [
  {
    label: "Unsloth Studio",
    image: "unsloth/unsloth:latest",
    description: "Unsloth 官方镜像，包含 Studio 和 Unsloth Core。",
  },
] satisfies UnslothStudioImageOption[];

const FALLBACK_UNSLOTH_STUDIO_IMAGE = "unsloth/unsloth:latest";

function normalizeImageOption(option: UnslothStudioImageOption) {
  return {
    label: option.label.trim(),
    image: option.image.trim(),
    description: option.description.trim(),
  };
}

function parseConfiguredImageOption(
  entry: string,
): UnslothStudioImageOption | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return {
      label: trimmed,
      image: trimmed,
      description: trimmed,
    };
  }

  const label = trimmed.slice(0, separatorIndex).trim();
  const image = trimmed.slice(separatorIndex + 1).trim();
  if (!label || !image) return null;

  return {
    label,
    image,
    description: image,
  };
}

function parseConfiguredImageOptions(raw: string) {
  return raw
    .split(/\r?\n|,/)
    .map(parseConfiguredImageOption)
    .filter((option): option is UnslothStudioImageOption => Boolean(option));
}

function uniqueImageOptions(options: UnslothStudioImageOption[]) {
  const seen = new Set<string>();
  const result: UnslothStudioImageOption[] = [];

  for (const option of options) {
    const normalized = normalizeImageOption(option);
    if (!normalized.image || seen.has(normalized.image)) continue;

    seen.add(normalized.image);
    result.push(normalized);
  }

  return result.slice(0, MAX_UNSLOTH_STUDIO_IMAGE_OPTIONS);
}

export function resolveUnslothStudioImageOptions(
  env: Record<string, string | undefined> = process.env,
) {
  const configuredOptions = env.COLA_UNSLOTH_STUDIO_IMAGE_OPTIONS?.trim()
    ? parseConfiguredImageOptions(env.COLA_UNSLOTH_STUDIO_IMAGE_OPTIONS)
    : [];
  const baseOptions =
    configuredOptions.length > 0
      ? configuredOptions
      : DEFAULT_UNSLOTH_STUDIO_IMAGE_OPTIONS;
  const configuredDefaultImage = env.COLA_UNSLOTH_STUDIO_IMAGE?.trim();
  const options = configuredDefaultImage
    ? [
        {
          label: "默认镜像",
          image: configuredDefaultImage,
          description: configuredDefaultImage,
        },
        ...baseOptions,
      ]
    : baseOptions;

  return uniqueImageOptions(options);
}

export function resolveUnslothStudioImage(
  requestedImage: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const imageOptions = resolveUnslothStudioImageOptions(env);
  const normalizedRequestedImage = requestedImage?.trim();
  const image =
    (normalizedRequestedImage && normalizedRequestedImage.length > 0
      ? normalizedRequestedImage
      : undefined) ??
    imageOptions[0]?.image ??
    FALLBACK_UNSLOTH_STUDIO_IMAGE;

  if (!imageOptions.some((option) => option.image === image)) {
    throw new Error("Unsloth Studio 镜像必须从可选镜像列表中选择。");
  }

  return image;
}
