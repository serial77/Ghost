import { Pool } from "pg";
import { getOperationsRuntimeConfig } from "@/lib/server/runtime-env";

type DatabaseId = "app" | "core";

const pools = new Map<DatabaseId, Pool>();

function createPool(databaseId: DatabaseId) {
  const config = getOperationsRuntimeConfig();
  const database = databaseId === "app" ? config.appDb : config.coreDb;

  return new Pool({
    host: config.postgresHost,
    port: config.postgresPort,
    user: config.postgresUser,
    password: config.postgresPassword,
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
