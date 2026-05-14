export function buildJupyterLabCommand(input: {
  workdir: string;
  port: number;
}) {
  return [
    "set -eu",
    `mkdir -p ${JSON.stringify(input.workdir)}`,
    "exec start-notebook.py \\",
    "  --ServerApp.ip=0.0.0.0 \\",
    `  --ServerApp.port=${input.port} \\`,
    "  --ServerApp.open_browser=False \\",
    `  --ServerApp.root_dir=${JSON.stringify(input.workdir)} \\`,
    "  --allow-root \\",
    '  --ServerApp.token="${JUPYTER_TOKEN}"',
  ].join("\n");
}
