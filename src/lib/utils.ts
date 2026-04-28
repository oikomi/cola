import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function optionLabel<T extends string>(
  labels: Record<T, string>,
  fallback: string,
) {
  return (value: unknown) =>
    typeof value === "string" && value in labels
      ? labels[value as T]
      : fallback;
}
