import { cookies } from "next/headers";

import { pool } from "./db";
import { getPerson, type Person } from "./people";
import { CheckpointError } from "./requirements";

// There is no login yet: on the manager screen you pick who you are, and that name is
// stored with every change. Experts are identified by their personal link instead.
export const ACTOR_COOKIE = "person";

export async function getActor(): Promise<Person | null> {
  const id = Number((await cookies()).get(ACTOR_COOKIE)?.value);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    return await getPerson(pool(), id);
  } catch (error) {
    if (error instanceof CheckpointError) return null;
    throw error;
  }
}
