import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const rawConnectionTimeout = Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "3000");
const connectionTimeoutMillis =
  Number.isFinite(rawConnectionTimeout) && rawConnectionTimeout > 0 ? rawConnectionTimeout : 3000;

function positiveInt(name: string, fallback: number, max?: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return max === undefined ? value : Math.min(value, max);
}

// Keep pool sizing explicit so a production environment cannot silently pick
// up a driver default that changes the DB connection budget. The defaults are
// intentionally conservative for the two API replicas on the current host.
const poolMax = positiveInt("DATABASE_POOL_MAX", 10, 50);
const idleTimeoutMillis = positiveInt("DATABASE_IDLE_TIMEOUT_MS", 30_000, 300_000);
const maxUses = positiveInt("DATABASE_MAX_USES", 5_000, 100_000);
const statementTimeout = positiveInt("DATABASE_STATEMENT_TIMEOUT_MS", 5_000, 60_000);
const lockTimeout = positiveInt("DATABASE_LOCK_TIMEOUT_MS", 3_000, 30_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  connectionTimeoutMillis,
  idleTimeoutMillis,
  maxUses,
  statement_timeout: statementTimeout,
  lock_timeout: lockTimeout,
});
// The pool evicts disconnected idle clients itself. Handling this event keeps
// a database restart from terminating the API before it can reconnect.
pool.on("error", (error: Error & { code?: string }) => {
  console.error("Database idle connection lost", {
    code: /^[A-Z0-9]{5}$/.test(error.code ?? "") ? error.code : "CONNECTION_LOST",
  });
});
export const db = drizzle(pool, { schema });

export * from "./schema";
