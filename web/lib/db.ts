import { Pool, type PoolClient } from "pg";

// One pool per server process; dev reloads reuse it instead of opening new connections.
const globalForPool = globalThis as unknown as { pool?: Pool };

export function pool(): Pool {
  if (!globalForPool.pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Set DATABASE_URL in the repo-root .env");
    globalForPool.pool = new Pool({ connectionString: url, max: 5 });
  }
  return globalForPool.pool;
}

export async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
