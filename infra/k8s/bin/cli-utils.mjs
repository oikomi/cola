import fs from "node:fs";

export function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`无法解析参数: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${token} 缺少值`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

export function requireArgs(args, requiredKeys) {
  for (const key of requiredKeys) {
    if (!args[key]) {
      throw new Error(`缺少必要参数 --${key}`);
    }
  }
}

export function readJsonFile(filePath, fallbackValue) {
  const source = fs.readFileSync(filePath, "utf8").trim();

  if (!source) {
    if (arguments.length >= 2) {
      return fallbackValue;
    }
    throw new Error(`JSON 文件为空: ${filePath}`);
  }

  return JSON.parse(source);
}
