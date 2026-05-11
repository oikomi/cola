export function isSafeInternalNextPath(value: string | null | undefined) {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;

  try {
    const parsed = new URL(value, "https://cola.local");
    return parsed.origin === "https://cola.local";
  } catch {
    return false;
  }
}

export function normalizeNextPath(value: string | null | undefined) {
  return isSafeInternalNextPath(value) ? value! : "/";
}

