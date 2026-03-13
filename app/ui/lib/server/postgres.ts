import { Pool } from "pg";
import { getOperationsRuntimeConfig } from "@/lib/server/runtime-env";

type DatabaseId = "app" | "core";

const pools = new Map<DatabaseId, Pool>();

function requireConfigString(value: string, key: string) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required Postgres config: ${key}`);
  }

  return value;
}

function createPool(databaseId: DatabaseId) {
  const config = getOperationsRuntimeConfig();
  const database = requireConfigString(
    databaseId === "app" ? config.appDb : config.coreDb,
    databaseId === "app" ? "GHOST_APP_DB" : "GHOST_POSTGRES_DB",
  );

  return new Pool({
    host: requireConfigString(config.postgresHost, "GHOST_POSTGRES_HOST"),
    port: config.postgresPort,
    user: requireConfigString(config.postgresUser, "GHOST_POSTGRES_USER"),
    password: requireConfigString(config.postgresPassword, "GHOST_POSTGRES_PASSWORD"),
    database,
    max: 4,
    idleTimeoutMillis: 10_000,
  });
}

export function getPool(databaseId: DatabaseId) {
  const existing = pools.get(databaseId);
  if (existing) {
    return existing;
  }

  const pool = createPool(databaseId);
  pools.set(databaseId, pool);
  return pool;
}
