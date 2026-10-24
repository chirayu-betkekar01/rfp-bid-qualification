import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

import type { Person } from "../lib/people";

// Runs against the local test database (npx supabase start); every test is rolled back.
export const url = process.env.TEST_DATABASE_URL;
export const db = new Client({ connectionString: url });

export function useRolledBackDb(): void {
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  beforeEach(() => db.query("begin"));
  afterEach(() => db.query("rollback"));
}

export async function rfp(): Promise<number> {
  const { rows } = await db.query(
    `insert into rfp (buyer, title, source_file) values ('Test buyer', 'Test RFP', 'x.pdf') returning id`,
  );
  return Number(rows[0].id);
}

export async function section(rfpId: number, ref: string, position = 1): Promise<number> {
  const { rows } = await db.query(
    `insert into rfp_section (rfp_id, ref, title, position) values ($1, $2, $3, $4) returning id`,
    [rfpId, ref, `${ref} TITLE`, position],
  );
  return Number(rows[0].id);
}

export async function item(rfpId: number, sectionId: number, ref: string, page: number, text: string,
                           { mandatory = false, type = "Legal" } = {}): Promise<number> {
  const { rows } = await db.query(
    `insert into requirement (rfp_id, req_ref, rfp_section, section_id, text, type, mandatory, page, created_by)
     values ($1, $2, 'Exhibit B.6', $3, $4, $5, $6, $7, 'ai') returning id`,
    [rfpId, ref, sectionId, text, type, mandatory, page],
  );
  return Number(rows[0].id);
}

export async function person(name: string, role: string): Promise<Person> {
  const { rows } = await db.query(
    `insert into person (name, role) values ($1, $2) returning id, link_token`, [name, role],
  );
  return { id: Number(rows[0].id), name, role, linkToken: rows[0].link_token };
}

export async function sendOut(rfpId: number): Promise<void> {
  await db.query(`update rfp set sent_out_at = now(), sent_out_by = 'Test Manager' where id = $1`, [rfpId]);
}

export async function assigneeOf(requirementId: number): Promise<number | null> {
  const { rows } = await db.query(`select assignee_id from requirement where id = $1`, [requirementId]);
  return rows[0].assignee_id === null ? null : Number(rows[0].assignee_id);
}
