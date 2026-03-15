import { Pool } from "pg";
import { getOperationsRuntimeConfig } from "@/lib/server/runtime-env";

type DatabaseId = "app" | "core";

type PoolConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  idleTimeoutMillis: number;
};

type PoolEntry = {
  pool: Pool;
  signature: string;
};

const pools = new Map<DatabaseId, PoolEntry>();

function requireConfigString(value: string, key: string) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required Postgres config: ${key}`);
  }

  return value;
}

function buildPoolConfig(databaseId: DatabaseId): PoolConfig {
  const config = getOperationsRuntimeConfig();
  const database = requireConfigString(
    databaseId === "app" ? config.appDb : config.coreDb,
    databaseId === "app" ? "GHOST_APP_DB" : "GHOST_POSTGRES_DB",
  );

  return {
    host: requireConfigString(config.postgresHost, "GHOST_POSTGRES_HOST"),
    port: config.postgresPort,
    user: requireConfigString(config.postgresUser, "GHOST_POSTGRES_USER"),
    password: requireConfigString(config.postgresPassword, "GHOST_POSTGRES_PASSWORD"),
    database,
    max: 4,
    idleTimeoutMillis: 10_000,
  };
}

function poolSignature(config: PoolConfig) {
  return JSON.stringify(config);
}

function createPool(config: PoolConfig) {
  return new Pool(config);
}

export function getPool(databaseId: DatabaseId) {
  const config = buildPoolConfig(databaseId);
  const signature = poolSignature(config);
  const existing = pools.get(databaseId);
  if (existing?.signature === signature) {
    return existing.pool;
  }

  if (existing) {
    void existing.pool.end().catch(() => {});
  }

  const pool = createPool(config);
  pools.set(databaseId, { pool, signature });
  return pool;
}
