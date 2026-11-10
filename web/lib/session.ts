/**
 * A signed session cookie: "<person id>.<expiry ms>.<HMAC-SHA256 signature>". Editing the id
 * breaks the signature, so nobody can sign in as someone else by changing the cookie.
 *
 * Web Crypto only, no Next.js imports, so the proxy and the server can both use it.
 */
export const SESSION_COOKIE = "session";
export const SESSION_DAYS = 7;

const encoder = new TextEncoder();
const globalForSecret = globalThis as unknown as { sessionSecret?: string };

/**
 * SESSION_SECRET from .env. Without it, a random secret is made once per server process:
 * fine for the demo, but everyone is signed out when the server restarts.
 */
export function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  // A deployment runs many server instances; a secret per instance would sign people out at random.
  if (process.env.VERCEL) throw new Error("Set SESSION_SECRET in the deployment's environment variables.");
  globalForSecret.sessionSecret ??= crypto.randomUUID() + crypto.randomUUID();
  return globalForSecret.sessionSecret;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSessionValue(personId: number, secret: string, now = Date.now()): Promise<{ value: string; expires: Date }> {
  const expires = new Date(now + SESSION_DAYS * 86_400_000);
  const payload = `${personId}.${expires.getTime()}`;
  return { value: `${payload}.${await sign(payload, secret)}`, expires };
}

/** The person id in a valid, unexpired session, or null. */
export async function readSessionValue(value: string | undefined, secret: string, now = Date.now()): Promise<number | null> {
  const [id, expiry, signature, ...rest] = (value ?? "").split(".");
  if (!id || !expiry || !signature || rest.length > 0) return null;
  const expected = await sign(`${id}.${expiry}`, secret);
  if (!constantTimeEqual(signature, expected)) return null;
  if (Number(expiry) <= now) return null;
  const personId = Number(id);
  return Number.isInteger(personId) && personId > 0 ? personId : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
