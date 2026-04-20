import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, "../..");
export const WORKSPACE_MANIFEST_DIR = path.join(
  REPO_ROOT,
  "infra",
  "remote-work",
  "runtime",
  "workspaces",
);

export function ensureWorkspaceManifestDir() {
  fs.mkdirSync(WORKSPACE_MANIFEST_DIR, { recursive: true });
}
