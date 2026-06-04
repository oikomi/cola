export type ContainerImageOption = {
  value: string;
  label: string;
  description: string;
};

function imageTag(image: string) {
  const imageName = image.split("/").at(-1) ?? image;
  const colonIndex = imageName.lastIndexOf(":");
  if (colonIndex >= 0) return imageName.slice(colonIndex + 1);

  const digestIndex = imageName.indexOf("@");
  if (digestIndex >= 0) return "digest";

  return image;
}

function configuredImageValues(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function imageOptionForValue(params: {
  image: string;
  productName: string;
  defaultOptions: ContainerImageOption[];
  defaultLabelSuffix?: string;
}) {
  const existing = params.defaultOptions.find(
    (option) => option.value === params.image,
  );

  if (existing) {
    return {
      ...existing,
      label: params.defaultLabelSuffix
        ? `${existing.label} ${params.defaultLabelSuffix}`
        : existing.label,
    };
  }

  return {
    value: params.image,
    label: `${params.productName} ${imageTag(params.image)}`,
    description: params.image,
  };
}

export function buildContainerImageOptions(params: {
  productName: string;
  defaultOptions: ContainerImageOption[];
  configuredImage?: string;
  configuredImages?: string;
}) {
  const options: ContainerImageOption[] = [];
  const configuredImage = params.configuredImage?.trim();

  if (configuredImage) {
    options.push(
      imageOptionForValue({
        image: configuredImage,
        productName: params.productName,
        defaultOptions: params.defaultOptions,
        defaultLabelSuffix: "(默认)",
      }),
    );
  }

  for (const image of configuredImageValues(params.configuredImages)) {
    options.push(
      imageOptionForValue({
        image,
        productName: params.productName,
        defaultOptions: params.defaultOptions,
      }),
    );
  }

  options.push(...params.defaultOptions);

  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}
