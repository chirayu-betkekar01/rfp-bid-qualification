import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { pool } from "./db";
import { getPerson, MANAGER_ROLE, type Person } from "./people";
import { CheckpointError, type Db } from "./requirements";
import { readSessionValue, sessionSecret, SESSION_COOKIE } from "./session";

// Demo sign-in: every fictional team member signs in with their email and one shared password,
// which the sign-in page shows. It stands in for real accounts; the name of whoever is signed
// in is saved with every change they make. Experts can still open their personal link directly.
export const DEMO_PASSWORD = "tallyhouse";

export type DemoAccount = { id: number; name: string; role: string; email: string };

/** Everyone who can sign in, proposal managers first, for the list beside the sign-in form. */
export async function listDemoAccounts(db: Db): Promise<DemoAccount[]> {
  const { rows } = await db.query(
    `select id, name, role, email from person where active order by role = $1 desc, role, name`, [MANAGER_ROLE],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, role: r.role, email: r.email }));
}

/** The person these credentials belong to. One message for every failure, so it doesn't reveal which emails exist. */
export async function checkCredentials(db: Db, email: string, password: string): Promise<Person> {
  const { rows } = await db.query(`select id from person where active and lower(email) = lower($1)`, [email.trim()]);
  if (!rows[0] || password !== DEMO_PASSWORD) throw new CheckpointError("That email and password don't match.");
  return getPerson(db, Number(rows[0].id));
}

/** Where someone lands after signing in: the page they asked for, or their usual start page. */
export function landingPage(person: Person, next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")) return next;
  return person.role === MANAGER_ROLE ? "/" : `/r/${person.linkToken}`;
}

/** Whoever is signed in, or null. */
export async function getActor(): Promise<Person | null> {
  await connection();      // request time only: checking the session's expiry reads the clock
  const id = await readSessionValue((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
  if (id === null) return null;
  try {
    return await getPerson(pool(), id);
  } catch (error) {
    if (error instanceof CheckpointError) return null;
    throw error;
  }
}

/** For pages behind sign-in: the proxy only checks a cookie exists, this checks it is valid. */
export async function requireActor(): Promise<Person> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}
