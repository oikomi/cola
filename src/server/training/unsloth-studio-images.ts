export type UnslothStudioImageOption = {
  label: string;
  image: string;
  description: string;
};

const UNSLOTH_STUDIO_LATEST_IMAGE = "unsloth/unsloth:latest";
const UNSLOTH_STUDIO_LATEST_IMAGE_OPTION = {
  label: "Unsloth Studio Latest",
  image: UNSLOTH_STUDIO_LATEST_IMAGE,
  description: "始终使用 Unsloth 官方 latest 镜像。",
} satisfies UnslothStudioImageOption;

export function resolveUnslothStudioImageOptions(
  _env: Record<string, string | undefined> = process.env,
) {
  return [UNSLOTH_STUDIO_LATEST_IMAGE_OPTION];
}

export function resolveUnslothStudioImage(
  _requestedImage: string | null | undefined,
  _env: Record<string, string | undefined> = process.env,
) {
  return UNSLOTH_STUDIO_LATEST_IMAGE;
}
