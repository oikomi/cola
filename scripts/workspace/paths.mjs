import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, "../..");
export const WORKSPACE_RUNTIME_DIR = path.join(
  REPO_ROOT,
  "runtime",
  "workspace",
);
export const WORKSPACE_MANIFEST_DIR = path.join(
  WORKSPACE_RUNTIME_DIR,
  "manifests",
);
export const WORKSPACE_IMAGE_PATH = path.join(
  WORKSPACE_RUNTIME_DIR,
  "latest-image.txt",
);
export const WORKSPACE_IMAGE_CONTEXT_DIR = path.join(
  REPO_ROOT,
  "workloads",
  "remote-workspace",
);

export function ensureWorkspaceManifestDir() {
  fs.mkdirSync(WORKSPACE_RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_MANIFEST_DIR, { recursive: true });
}
