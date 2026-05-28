export type JupyterLabImageOption = {
  label: string;
  image: string;
  description: string;
};

const MAX_JUPYTERLAB_IMAGE_OPTIONS = 5;

const DEFAULT_JUPYTERLAB_IMAGE_OPTIONS = [
  {
    label: "PyTorch CPU",
    image: "quay.io/jupyter/pytorch-notebook:latest",
    description: "默认 CPU 版 PyTorch，适合数据检查和轻量 notebook。",
  },
  {
    label: "PyTorch CUDA 12",
    image: "quay.io/jupyter/pytorch-notebook:cuda12-latest",
    description: "CUDA 12 版 PyTorch，匹配当前 NVIDIA 驱动 CUDA 12.x 能力。",
  },
] satisfies JupyterLabImageOption[];
const FALLBACK_JUPYTERLAB_IMAGE = "quay.io/jupyter/pytorch-notebook:latest";

function normalizeImageOption(option: JupyterLabImageOption) {
  return {
    label: option.label.trim(),
    image: option.image.trim(),
    description: option.description.trim(),
  };
}

function parseConfiguredImageOption(
  entry: string,
): JupyterLabImageOption | null {
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
    .filter((option): option is JupyterLabImageOption => Boolean(option));
}

function uniqueImageOptions(options: JupyterLabImageOption[]) {
  const seen = new Set<string>();
  const result: JupyterLabImageOption[] = [];

  for (const option of options) {
    const normalized = normalizeImageOption(option);
    if (!normalized.image || seen.has(normalized.image)) continue;

    seen.add(normalized.image);
    result.push(normalized);
  }

  return result.slice(0, MAX_JUPYTERLAB_IMAGE_OPTIONS);
}

export function resolveJupyterLabImageOptions(
  env: Record<string, string | undefined> = process.env,
) {
  const configuredOptions = env.COLA_JUPYTERLAB_IMAGE_OPTIONS?.trim()
    ? parseConfiguredImageOptions(env.COLA_JUPYTERLAB_IMAGE_OPTIONS)
    : [];
  const baseOptions =
    configuredOptions.length > 0
      ? configuredOptions
      : DEFAULT_JUPYTERLAB_IMAGE_OPTIONS;
  const configuredDefaultImage = env.COLA_JUPYTERLAB_IMAGE?.trim();
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

export function resolveJupyterLabImage(
  requestedImage: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const imageOptions = resolveJupyterLabImageOptions(env);
  const normalizedRequestedImage = requestedImage?.trim();
  const image =
    (normalizedRequestedImage && normalizedRequestedImage.length > 0
      ? normalizedRequestedImage
      : undefined) ??
    imageOptions[0]?.image ??
    FALLBACK_JUPYTERLAB_IMAGE;

  if (!imageOptions.some((option) => option.image === image)) {
    throw new Error("JupyterLab 镜像必须从可选镜像列表中选择。");
  }

  return image;
}
