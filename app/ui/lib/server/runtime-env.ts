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
    accumulator[key] = value;
    return accumulator;
  }, {});
}

function loadFallbackEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const fallbackPath = path.resolve(process.cwd(), "..", "..", "base", ".env");
  cachedEnv = existsSync(fallbackPath) ? parseEnvFile(readFileSync(fallbackPath, "utf8")) : {};
  return cachedEnv;
}

function getValue(key: string, fallback?: string) {
  const fromProcess = process.env[key];
  if (fromProcess) {
    return fromProcess;
  }

  const fromFallback = loadFallbackEnv()[key];
  if (fromFallback) {
    return fromFallback;
  }

  return fallback;
}

export function getOperationsRuntimeConfig() {
  const postgresHost = getValue("GHOST_POSTGRES_HOST", "127.0.0.1")!;
  const postgresPort = Number(getValue("GHOST_POSTGRES_PORT", "5433"));
  const postgresUser = getValue("GHOST_POSTGRES_USER", "ghost")!;
  const postgresPassword = getValue("GHOST_POSTGRES_PASSWORD", "")!;
  const appDb = getValue("GHOST_APP_DB", "ghost_app")!;
  const coreDb = getValue("GHOST_POSTGRES_DB", "ghost_core")!;

  return {
    postgresHost,
    postgresPort,
    postgresUser,
    postgresPassword,
    appDb,
    coreDb,
    enableOperationsMocks: getValue("GHOST_ENABLE_OPERATIONS_MOCKS", "false") === "true",
  };
}
