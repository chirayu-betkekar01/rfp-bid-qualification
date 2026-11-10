import { Pool, type PoolClient } from "pg";

// One pool per server process; dev reloads reuse it instead of opening new connections.
const globalForPool = globalThis as unknown as { pool?: Pool };

export function pool(): Pool {
  if (!globalForPool.pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Set DATABASE_URL in the repo-root .env");
    globalForPool.pool = new Pool({ connectionString: withoutSslMode(url), max: 5, ssl: sslFor(url) });
  }
  return globalForPool.pool;
}

const LOCAL = /@(localhost|127\.0\.0\.1)(:|\/)/;

/**
 * Local Supabase has no TLS. A hosted database (Supabase cloud) is reached over TLS with its
 * certificate verified. Supabase signs it with its own CA, which Node does not ship, so the
 * deployment sets DATABASE_SSL_CA to that CA certificate (PEM, from the Supabase dashboard).
 */
function sslFor(url: string) {
  if (LOCAL.test(url)) return false;
  // Accept the PEM with real line breaks or with "\n" escapes (some env editors flatten it).
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

// pg reads sslmode from the URL, which would override the settings above.
function withoutSslMode(url: string): string {
  return url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
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
