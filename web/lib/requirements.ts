/**
 * Checkpoint A: the reviewer confirms the requirement list the AI extracted.
 *
 * Every change is written to requirement_change with the reviewer's name, so the
 * confirmed list can be traced back to the extraction. Once the list is confirmed
 * it is locked; reopening it needs a reason. Callers run each mutation in a transaction.
 */
import type { ClientBase } from "pg";

export const ROW_TYPES = [
  "Functional", "Integration", "Security", "Legal", "Commercial",
  "Implementation", "Support", "Submission", "Response question",
] as const;
export type RowType = (typeof ROW_TYPES)[number];

export const PRIORITIES = ["mandatory", "scored", "optional"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Db = Pick<ClientBase, "query">;

export class CheckpointError extends Error {}

export type Rfp = {
  id: number;
  buyer: string;
  title: string;
  sourceFile: string;
  dueDate: Date | null;
  extractModel: string | null;
  extractPromptVersion: string | null;
  extractedAt: Date | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  rowCount: number;
};

export type Requirement = {
  id: number;
  reqRef: string;
  section: string | null;
  text: string;
  type: string;
  priority: Priority;
  page: number | null;
  createdBy: "ai" | "reviewer";
  edited: boolean;               // changed by a reviewer after extraction (edit or merge)
};

export type RequirementInput = {
  section: string | null;
  text: string;
  type: RowType;
  priority: Priority;
  page: number | null;
};

export type Change = {
  id: number;
  requirementId: number | null;
  action: "add" | "edit" | "merge" | "delete" | "confirm" | "reopen";
  before: unknown;
  after: unknown;
  reviewer: string;
  reason: string | null;
  changedAt: Date;
};

const RFP_COLUMNS = `
  r.id, r.buyer, r.title, r.source_file, r.due_date, r.extract_model, r.extract_prompt_version,
  r.extracted_at, r.requirements_confirmed_by, r.requirements_confirmed_at,
  (select count(*) from requirement q where q.rfp_id = r.id) as row_count`;

const REQUIREMENT_COLUMNS = `
  q.id, q.req_ref, q.rfp_section, q.text, q.type, q.mandatory, q.scored, q.page, q.created_by,
  exists (select 1 from requirement_change c
          where c.requirement_id = q.id and c.action in ('edit', 'merge')) as edited`;

// Extraction inserts rows in document order, so (page, id) keeps added rows next to their page.
const DOCUMENT_ORDER = "q.page nulls last, q.id";

// ---------------------------------------------------------------------------- reads

export async function listRfps(db: Db): Promise<Rfp[]> {
  const { rows } = await db.query<RfpRow>(`select ${RFP_COLUMNS} from rfp r order by r.received_at desc, r.id desc`);
  return rows.map(toRfp);
}

export async function getRfp(db: Db, rfpId: number): Promise<Rfp | null> {
  const { rows } = await db.query<RfpRow>(`select ${RFP_COLUMNS} from rfp r where r.id = $1`, [rfpId]);
  return rows[0] ? toRfp(rows[0]) : null;
}

export async function listRequirements(db: Db, rfpId: number): Promise<Requirement[]> {
  const { rows } = await db.query<RequirementRow>(
    `select ${REQUIREMENT_COLUMNS} from requirement q where q.rfp_id = $1 order by ${DOCUMENT_ORDER}`,
    [rfpId],
  );
  return rows.map(toRequirement);
}

export async function listChanges(db: Db, rfpId: number): Promise<Change[]> {
  const { rows } = await db.query(
    `select id, requirement_id, action, before, after, reviewer, reason, changed_at
     from requirement_change where rfp_id = $1 order by changed_at desc, id desc`,
    [rfpId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    requirementId: r.requirement_id === null ? null : Number(r.requirement_id),
    action: r.action,
    before: r.before,
    after: r.after,
    reviewer: r.reviewer,
    reason: r.reason,
    changedAt: r.changed_at,
  }));
}

// ---------------------------------------------------------------------------- changes

export async function addRequirement(
  db: Db, rfpId: number, input: RequirementInput, reviewer: string, reason?: string,
): Promise<Requirement> {
  const name = checkReviewer(reviewer);
  const row = checkInput(input);
  await lockOpenList(db, rfpId);
  const { rows } = await db.query(
    `insert into requirement (rfp_id, req_ref, rfp_section, text, type, mandatory, scored, page, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'reviewer') returning id`,
    [rfpId, await nextRef(db, rfpId), row.section, row.text, row.type,
     row.priority === "mandatory", row.priority === "scored", row.page],
  );
  const added = await getRequirement(db, Number(rows[0].id));
  await logChange(db, rfpId, added.id, "add", null, snapshot(added), name, reason);
  return added;
}

/** Change some fields of one row. Returns the row; an edit that changes nothing is not logged. */
export async function editRequirement(
  db: Db, requirementId: number, changes: Partial<RequirementInput>, reviewer: string, reason?: string,
): Promise<Requirement> {
  const name = checkReviewer(reviewer);
  const current = await getRequirement(db, requirementId);
  const rfpId = await rfpOf(db, requirementId);
  await lockOpenList(db, rfpId);
  const row = checkInput({ ...inputOf(current), ...changes });
  if (sameInput(row, inputOf(current))) return current;

  await db.query(
    `update requirement set rfp_section = $2, text = $3, type = $4, mandatory = $5, scored = $6, page = $7
     where id = $1`,
    [requirementId, row.section, row.text, row.type,
     row.priority === "mandatory", row.priority === "scored", row.page],
  );
  const updated = await getRequirement(db, requirementId);
  await logChange(db, rfpId, requirementId, "edit", snapshot(current), snapshot(updated), name, reason);
  return { ...updated, edited: true };
}

/**
 * Merge two or more rows of one RFP into the first of them in document order.
 * The other rows are deleted; the log keeps every original row.
 */
export async function mergeRequirements(
  db: Db, requirementIds: number[], merged: RequirementInput, reviewer: string, reason?: string,
): Promise<Requirement> {
  const name = checkReviewer(reviewer);
  const ids = [...new Set(requirementIds)];
  if (ids.length < 2) throw new CheckpointError("Pick at least two rows to merge.");
  const row = checkInput(merged);

  const { rows } = await db.query(
    `select q.id, q.rfp_id from requirement q where q.id = any($1) order by ${DOCUMENT_ORDER}`, [ids],
  );
  if (rows.length !== ids.length) throw new CheckpointError("Some of these rows no longer exist.");
  const rfpIds = new Set(rows.map((r) => Number(r.rfp_id)));
  if (rfpIds.size !== 1) throw new CheckpointError("Only rows from the same RFP can be merged.");
  const rfpId = [...rfpIds][0];
  await lockOpenList(db, rfpId);

  const originals = await Promise.all(rows.map((r) => getRequirement(db, Number(r.id))));
  const [keep, ...rest] = originals;
  await db.query(`delete from requirement where id = any($1)`, [rest.map((r) => r.id)]);
  await db.query(
    `update requirement set rfp_section = $2, text = $3, type = $4, mandatory = $5, scored = $6, page = $7
     where id = $1`,
    [keep.id, row.section, row.text, row.type,
     row.priority === "mandatory", row.priority === "scored", row.page],
  );
  const result = await getRequirement(db, keep.id);
  await logChange(db, rfpId, keep.id, "merge", originals.map(snapshot), snapshot(result), name, reason);
  return { ...result, edited: true };
}

export async function deleteRequirement(
  db: Db, requirementId: number, reviewer: string, reason?: string,
): Promise<void> {
  const name = checkReviewer(reviewer);
  const current = await getRequirement(db, requirementId);
  const rfpId = await rfpOf(db, requirementId);
  await lockOpenList(db, rfpId);
  await db.query(`delete from requirement where id = $1`, [requirementId]);
  await logChange(db, rfpId, requirementId, "delete", snapshot(current), null, name, reason);
}

/** Checkpoint A sign-off: the list is final and drafting can start. */
export async function confirmRequirements(db: Db, rfpId: number, reviewer: string): Promise<void> {
  const name = checkReviewer(reviewer);
  await lockOpenList(db, rfpId);
  const { rows } = await db.query(`select count(*) as n from requirement where rfp_id = $1`, [rfpId]);
  const count = Number(rows[0].n);
  if (count === 0) throw new CheckpointError("There are no rows to confirm.");
  await db.query(
    `update rfp set requirements_confirmed_by = $2, requirements_confirmed_at = now() where id = $1`,
    [rfpId, name],
  );
  await logChange(db, rfpId, null, "confirm", null, { rows: count }, name);
}

export async function reopenRequirements(db: Db, rfpId: number, reviewer: string, reason: string): Promise<void> {
  const name = checkReviewer(reviewer);
  if (!reason?.trim()) throw new CheckpointError("Give a reason for reopening the list.");
  const { rows } = await db.query(
    `select requirements_confirmed_by from rfp where id = $1 for update`, [rfpId],
  );
  if (!rows[0]) throw new CheckpointError("This RFP does not exist.");
  if (!rows[0].requirements_confirmed_by) throw new CheckpointError("This list is not confirmed yet.");
  await db.query(
    `update rfp set requirements_confirmed_by = null, requirements_confirmed_at = null where id = $1`, [rfpId],
  );
  await logChange(db, rfpId, null, "reopen", { confirmed_by: rows[0].requirements_confirmed_by }, null,
                  name, reason);
}

// ---------------------------------------------------------------------------- helpers

export function checkReviewer(reviewer: string): string {
  const name = (reviewer ?? "").trim();
  if (!name) throw new CheckpointError("Enter your name before making changes.");
  if (["ai", "system"].includes(name.toLowerCase())) {
    throw new CheckpointError("Changes must be made by a named person.");
  }
  return name;
}

export function checkInput(input: RequirementInput): RequirementInput {
  const text = (input.text ?? "").trim();
  if (!text) throw new CheckpointError("The requirement text can't be empty.");
  if (!ROW_TYPES.includes(input.type)) throw new CheckpointError(`Unknown type: ${input.type}`);
  if (!PRIORITIES.includes(input.priority)) throw new CheckpointError(`Unknown priority: ${input.priority}`);
  const page = input.page;
  if (page !== null && (!Number.isInteger(page) || page < 1)) {
    throw new CheckpointError("Page must be a whole number of 1 or more.");
  }
  return { section: input.section?.trim() || null, text, type: input.type, priority: input.priority, page };
}

async function lockOpenList(db: Db, rfpId: number): Promise<void> {
  const { rows } = await db.query(`select requirements_confirmed_at from rfp where id = $1 for update`, [rfpId]);
  if (!rows[0]) throw new CheckpointError("This RFP does not exist.");
  if (rows[0].requirements_confirmed_at) {
    throw new CheckpointError("This list is confirmed. Reopen it to make changes.");
  }
}

async function getRequirement(db: Db, requirementId: number): Promise<Requirement> {
  const { rows } = await db.query<RequirementRow>(`select ${REQUIREMENT_COLUMNS} from requirement q where q.id = $1`,
                                  [requirementId]);
  if (!rows[0]) throw new CheckpointError("This row no longer exists.");
  return toRequirement(rows[0]);
}

async function rfpOf(db: Db, requirementId: number): Promise<number> {
  const { rows } = await db.query(`select rfp_id from requirement where id = $1`, [requirementId]);
  return Number(rows[0].rfp_id);
}

async function nextRef(db: Db, rfpId: number): Promise<string> {
  const { rows } = await db.query(
    `select coalesce(max(substring(req_ref from '^R-(\\d+)$')::int), 0) + 1 as n
     from requirement where rfp_id = $1`,
    [rfpId],
  );
  return `R-${String(rows[0].n).padStart(3, "0")}`;
}

async function logChange(
  db: Db, rfpId: number, requirementId: number | null, action: Change["action"],
  before: unknown, after: unknown, reviewer: string, reason?: string,
): Promise<void> {
  await db.query(
    `insert into requirement_change (rfp_id, requirement_id, action, before, after, reviewer, reason)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [rfpId, requirementId, action, json(before), json(after), reviewer, reason?.trim() || null],
  );
}

function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function snapshot(r: Requirement) {
  return { req_ref: r.reqRef, rfp_section: r.section, text: r.text, type: r.type,
           priority: r.priority, page: r.page, created_by: r.createdBy };
}

function inputOf(r: Requirement): RequirementInput {
  return { section: r.section, text: r.text, type: r.type as RowType, priority: r.priority, page: r.page };
}

function sameInput(a: RequirementInput, b: RequirementInput): boolean {
  return a.section === b.section && a.text === b.text && a.type === b.type
    && a.priority === b.priority && a.page === b.page;
}

type RfpRow = {
  id: string; buyer: string; title: string; source_file: string; due_date: Date | null;
  extract_model: string | null; extract_prompt_version: string | null; extracted_at: Date | null;
  requirements_confirmed_by: string | null; requirements_confirmed_at: Date | null; row_count: string;
};

type RequirementRow = {
  id: string; req_ref: string; rfp_section: string | null; text: string; type: string; mandatory: boolean;
  scored: boolean; page: number | null; created_by: "ai" | "reviewer"; edited: boolean;
};

function toRfp(r: RfpRow): Rfp {
  return {
    id: Number(r.id),
    buyer: r.buyer,
    title: r.title,
    sourceFile: r.source_file,
    dueDate: r.due_date,
    extractModel: r.extract_model,
    extractPromptVersion: r.extract_prompt_version,
    extractedAt: r.extracted_at,
    confirmedBy: r.requirements_confirmed_by,
    confirmedAt: r.requirements_confirmed_at,
    rowCount: Number(r.row_count),
  };
}

function toRequirement(r: RequirementRow): Requirement {
  return {
    id: Number(r.id),
    reqRef: r.req_ref,
    section: r.rfp_section,
    text: r.text,
    type: r.type,
    priority: r.mandatory ? "mandatory" : r.scored ? "scored" : "optional",
    page: r.page,
    createdBy: r.created_by,
    edited: r.edited,
  };
}
