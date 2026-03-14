import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type RuntimeEnv = Record<string, string>;

let cachedEnv: RuntimeEnv | null = null;

function parseEnvFile(contents: string): RuntimeEnv {
  return contents.split("\n").reduce<RuntimeEnv>((accumulator, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return accumulator;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return accumulator;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    const normalized = value.replace(/^['"]|['"]$/g, "");
    accumulator[key] = normalized;
    return accumulator;
  }, {});
}

function mergeEnvFiles(paths: string[]) {
  const merged: RuntimeEnv = {};

  for (const envPath of [...paths].reverse()) {
    if (!existsSync(envPath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(readFileSync(envPath, "utf8")));
  }

  return merged;
}

function ancestorPaths(start: string) {
  const paths: string[] = [];
  let current = path.resolve(start);

  while (true) {
    paths.push(current);

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return paths;
}

function discoverEnvSearchPaths() {
  const candidates = new Set<string>();
  const roots = new Set<string>([
    ...ancestorPaths(process.cwd()),
    ...ancestorPaths(__dirname),
  ]);

  for (const root of roots) {
    candidates.add(path.join(root, ".env.local"));
    candidates.add(path.join(root, ".env"));
    candidates.add(path.join(root, "app", "ui", ".env.local"));
    candidates.add(path.join(root, "app", "ui", ".env"));
    candidates.add(path.join(root, "base", ".env"));
    candidates.add(path.join(root, "ghost-stack", "base", ".env"));
  }

  return [...candidates];
}

function loadFallbackEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = mergeEnvFiles(discoverEnvSearchPaths());
  return cachedEnv;
}

function isPresentValue(value: string | undefined, allowEmpty = true) {
  if (value === undefined) {
    return false;
  }

  if (allowEmpty) {
    return true;
  }

  return value !== "";
}

function getValue(key: string, fallback?: string, options?: { allowEmpty?: boolean }) {
  const allowEmpty = options?.allowEmpty ?? true;
  const fromProcess = process.env[key];
  if (isPresentValue(fromProcess, allowEmpty)) {
    return fromProcess;
  }

  const fromFallback = loadFallbackEnv()[key];
  if (isPresentValue(fromFallback, allowEmpty)) {
    return fromFallback;
  }

  return fallback;
}

export function getOperationsRuntimeConfig() {
  const postgresHost = getValue("GHOST_POSTGRES_HOST", "127.0.0.1", { allowEmpty: false })!;
  const postgresPort = Number(getValue("GHOST_POSTGRES_PORT", "5433", { allowEmpty: false }));
  const postgresUser = getValue("GHOST_POSTGRES_USER", "ghost", { allowEmpty: false })!;
  const postgresPassword = getValue("GHOST_POSTGRES_PASSWORD", "", { allowEmpty: false })!;
  const appDb = getValue("GHOST_APP_DB", "ghost_app", { allowEmpty: false })!;
  const coreDb = getValue("GHOST_POSTGRES_DB", "ghost_core", { allowEmpty: false })!;

  const n8nBaseUrl = getValue("GHOST_N8N_BASE_URL", "http://127.0.0.1:5678", { allowEmpty: false })!;

  return {
    postgresHost,
    postgresPort,
    postgresUser,
    postgresPassword,
    appDb,
    coreDb,
    n8nBaseUrl,
    enableOperationsMocks: getValue("GHOST_ENABLE_OPERATIONS_MOCKS", "false") === "true",
  };
}
