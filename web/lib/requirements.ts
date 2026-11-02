/**
 * The line-item list of an RFP: what the AI shredded, as the proposal manager fixes it.
 *
 * Every change is written to requirement_change with the person's name, so the list
 * can be traced back to the extraction. Once the RFP is sent out to experts the list
 * is locked: items can still be reassigned, but not added, edited, merged or deleted.
 * Callers run each mutation in a transaction.
 */
import type { ClientBase } from "pg";

export const ROW_TYPES = [
  "Functional", "Integration", "Security", "Legal", "Commercial",
  "Implementation", "Support", "Submission", "Response question",
] as const;
export type RowType = (typeof ROW_TYPES)[number];

export const PRIORITIES = ["mandatory", "scored", "optional"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ANSWERS = ["Yes", "No", "Maybe"] as const;
export type Answer = (typeof ANSWERS)[number];

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
  sentOutBy: string | null;
  sentOutAt: Date | null;
  responsesDueAt: Date | null;
  receivedAt: Date;
  rowCount: number;
  decision: Decision | null;     // go / no-go, recorded by a person
};

export type Decision = {
  decision: "bid" | "no_bid";
  recommendation: "bid" | "no_bid";
  score: number;
  decidedBy: string;
  reason: string;
  decidedAt: Date;
};

export type Section = {
  id: number;
  ref: string;                   // "IV", "Exhibit B"
  title: string;                 // "SCOPE OF WORK"
  position: number;
  assigneeId: number | null;     // the section's owner; items can be given to someone else
};

export type LineAnswer = {
  answer: Answer;
  note: string | null;
  personId: number;
  personName: string;
  status: "draft" | "submitted";
};

export type LibrarySource = {
  id: string;
  question: string;
  answer: string;
  status: "Current" | "Stale";
};

export type Suggestion = {
  answer: Answer | null;         // null: nothing in the library covers this
  reason: string;
  citedIds: string[];
  sources: LibrarySource[];      // the cited library answers, so a person can check them
  flags: string[];               // stale_source, unprofiled_source, hard_fail_gap:<name>, soft_gap:<name>
  id: number;
};

export type Forwarded = { fromName: string; note: string | null };

export type Requirement = {
  id: number;
  rfpId: number;
  reqRef: string;
  section: string | null;        // the RFP's own reference, e.g. "IV.A.1"
  sectionId: number | null;
  text: string;
  type: string;
  priority: Priority;
  page: number | null;
  createdBy: "ai" | "reviewer";
  edited: boolean;               // changed by a person after extraction (edit or merge)
  assigneeId: number | null;
  response: LineAnswer | null;
  suggestion: Suggestion | null;  // the AI's latest suggestion; never pre-selected
  forwardCount: number;
  lastForward: Forwarded | null;   // who passed it on most recently, and their note
};

export type RequirementInput = {
  section: string | null;
  sectionId: number | null;
  text: string;
  type: RowType;
  priority: Priority;
  page: number | null;
};

export type Change = {
  id: number;
  requirementId: number | null;
  action: "add" | "edit" | "merge" | "delete" | "confirm" | "reopen" | "assign" | "answer" | "forward" | "send_out";
  before: unknown;
  after: unknown;
  reviewer: string;
  reason: string | null;
  changedAt: Date;
};

const RFP_COLUMNS = `
  r.id, r.buyer, r.title, r.source_file, r.due_date, r.extract_model, r.extract_prompt_version,
  r.extracted_at, r.sent_out_by, r.sent_out_at, r.responses_due_at, r.received_at,
  r.decision, r.recommendation, r.go_no_go_score, r.decided_by, r.decision_reason, r.decided_at,
  (select count(*) from requirement q where q.rfp_id = r.id) as row_count`;

const REQUIREMENT_COLUMNS = `
  q.id, q.rfp_id, q.req_ref, q.rfp_section, q.section_id, q.text, q.type, q.mandatory, q.scored, q.page, q.created_by,
  q.assignee_id,
  exists (select 1 from requirement_change c
          where c.requirement_id = q.id and c.action in ('edit', 'merge')) as edited,
  a.answer, a.note, a.person_id as answer_person_id, p.name as answer_person_name, a.status as answer_status,
  g.id as suggestion_id, g.answer as suggestion_answer, g.reason as suggestion_reason, g.cited_ids, g.flags,
  (select coalesce(json_agg(json_build_object('id', l.id, 'question', l.question, 'answer', l.answer,
                                              'status', l.status) order by l.id), '[]'::json)
   from library_answer l where l.id = any(g.cited_ids)) as sources,
  (select count(*) from forward f where f.requirement_id = q.id) as forward_count,
  lf.from_name as forward_from, lf.note as forward_note`;

const REQUIREMENT_FROM = `
  requirement q
  left join line_response a on a.requirement_id = q.id
  left join person p on p.id = a.person_id
  left join lateral (select * from ai_suggestion g where g.requirement_id = q.id
                     order by g.created_at desc, g.id desc limit 1) g on true
  left join lateral (select fp.name as from_name, f.note from forward f join person fp on fp.id = f.from_person_id
                     where f.requirement_id = q.id order by f.forwarded_at desc, f.id desc limit 1) lf on true`;

// Sections in document order; within one, extraction order (page, then id) keeps added rows by their page.
const DOCUMENT_ORDER = "s.position nulls last, q.page nulls last, q.id";

// ---------------------------------------------------------------------------- reads

export async function listRfps(db: Db): Promise<Rfp[]> {
  const { rows } = await db.query<RfpRow>(`select ${RFP_COLUMNS} from rfp r order by r.received_at desc, r.id desc`);
  return rows.map(toRfp);
}

export async function getRfp(db: Db, rfpId: number): Promise<Rfp | null> {
  const { rows } = await db.query<RfpRow>(`select ${RFP_COLUMNS} from rfp r where r.id = $1`, [rfpId]);
  return rows[0] ? toRfp(rows[0]) : null;
}

export async function listSections(db: Db, rfpId: number): Promise<Section[]> {
  const { rows } = await db.query(
    `select id, ref, title, position, assignee_id from rfp_section where rfp_id = $1 order by position`, [rfpId],
  );
  return rows.map((r) => ({
    id: Number(r.id), ref: r.ref, title: r.title, position: r.position,
    assigneeId: r.assignee_id === null ? null : Number(r.assignee_id),
  }));
}

export async function listRequirements(db: Db, rfpId: number): Promise<Requirement[]> {
  const { rows } = await db.query<RequirementRow>(
    `select ${REQUIREMENT_COLUMNS} from ${REQUIREMENT_FROM}
     left join rfp_section s on s.id = q.section_id
     where q.rfp_id = $1 order by ${DOCUMENT_ORDER}`,
    [rfpId],
  );
  return rows.map(toRequirement);
}

/** Items waiting with one person on RFPs that have been sent out, in document order. */
export async function listAssignedRequirements(db: Db, personId: number): Promise<Requirement[]> {
  const { rows } = await db.query<RequirementRow>(
    `select ${REQUIREMENT_COLUMNS} from ${REQUIREMENT_FROM}
     join rfp r on r.id = q.rfp_id and r.sent_out_at is not null
     left join rfp_section s on s.id = q.section_id
     where q.assignee_id = $1 and (a.id is null or a.person_id = $1)
     order by r.sent_out_at desc, q.rfp_id, ${DOCUMENT_ORDER}`,
    [personId],
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

export async function getRequirement(db: Db, requirementId: number): Promise<Requirement> {
  const { rows } = await db.query<RequirementRow>(
    `select ${REQUIREMENT_COLUMNS} from ${REQUIREMENT_FROM} where q.id = $1`, [requirementId],
  );
  if (!rows[0]) throw new CheckpointError("This line item no longer exists.");
  return toRequirement(rows[0]);
}

// ---------------------------------------------------------------------------- changes

export async function addRequirement(
  db: Db, rfpId: number, input: RequirementInput, reviewer: string, reason?: string,
): Promise<Requirement> {
  const name = checkReviewer(reviewer);
  const row = checkInput(input);
  await lockOpenList(db, rfpId);
  await checkSection(db, rfpId, row.sectionId);
  const { rows } = await db.query(
    `insert into requirement (rfp_id, req_ref, rfp_section, section_id, text, type, mandatory, scored, page,
                              assignee_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             (select assignee_id from rfp_section where id = $4), 'reviewer') returning id`,
    [rfpId, await nextRef(db, rfpId), row.section, row.sectionId, row.text, row.type,
     row.priority === "mandatory", row.priority === "scored", row.page],
  );
  const added = await getRequirement(db, Number(rows[0].id));
  await logChange(db, rfpId, added.id, "add", null, snapshot(added), name, reason);
  return added;
}

/** Change some fields of one item. Returns the item; an edit that changes nothing is not logged. */
export async function editRequirement(
  db: Db, requirementId: number, changes: Partial<RequirementInput>, reviewer: string, reason?: string,
): Promise<Requirement> {
  const name = checkReviewer(reviewer);
  const current = await getRequirement(db, requirementId);
  const rfpId = await rfpOf(db, requirementId);
  await lockOpenList(db, rfpId);
  const row = checkInput({ ...inputOf(current), ...changes });
  if (sameInput(row, inputOf(current))) return current;
  await checkSection(db, rfpId, row.sectionId);

  await db.query(
    `update requirement set rfp_section = $2, section_id = $3, text = $4, type = $5, mandatory = $6, scored = $7,
            page = $8
     where id = $1`,
    [requirementId, row.section, row.sectionId, row.text, row.type,
     row.priority === "mandatory", row.priority === "scored", row.page],
  );
  const updated = await getRequirement(db, requirementId);
  await logChange(db, rfpId, requirementId, "edit", snapshot(current), snapshot(updated), name, reason);
  return { ...updated, edited: true };
}

/**
 * Merge two or more items of one RFP into the first of them in document order.
 * The other items are deleted; the log keeps every original. Answered items can't be merged.
 */
export async function mergeRequirements(
  db: Db, requirementIds: number[], merged: RequirementInput, reviewer: string, reason?: string,
): Promise<Requirement> {
  const name = checkReviewer(reviewer);
  const ids = [...new Set(requirementIds)];
  if (ids.length < 2) throw new CheckpointError("Pick at least two line items to merge.");
  const row = checkInput(merged);

  const { rows } = await db.query(
    `select q.id, q.rfp_id from requirement q left join rfp_section s on s.id = q.section_id
     where q.id = any($1) order by ${DOCUMENT_ORDER}`, [ids],
  );
  if (rows.length !== ids.length) throw new CheckpointError("Some of these line items no longer exist.");
  const rfpIds = new Set(rows.map((r) => Number(r.rfp_id)));
  if (rfpIds.size !== 1) throw new CheckpointError("Only line items from the same RFP can be merged.");
  const rfpId = [...rfpIds][0];
  await lockOpenList(db, rfpId);
  await checkSection(db, rfpId, row.sectionId);

  const originals = await Promise.all(rows.map((r) => getRequirement(db, Number(r.id))));
  if (originals.some((r) => r.response)) {
    throw new CheckpointError("Answered line items can't be merged.");
  }
  const [keep, ...rest] = originals;
  await db.query(`delete from requirement where id = any($1)`, [rest.map((r) => r.id)]);
  await db.query(
    `update requirement set rfp_section = $2, section_id = $3, text = $4, type = $5, mandatory = $6, scored = $7,
            page = $8
     where id = $1`,
    [keep.id, row.section, row.sectionId, row.text, row.type,
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
  if (current.response) throw new CheckpointError("Answered line items can't be deleted.");
  await db.query(`delete from requirement where id = $1`, [requirementId]);
  await logChange(db, rfpId, requirementId, "delete", snapshot(current), null, name, reason);
}

// ---------------------------------------------------------------------------- helpers

export function checkReviewer(reviewer: string): string {
  const name = (reviewer ?? "").trim();
  if (!name) throw new CheckpointError("Choose who you are before making changes.");
  if (["ai", "system"].includes(name.toLowerCase())) {
    throw new CheckpointError("Changes must be made by a named person.");
  }
  return name;
}

export function checkInput(input: RequirementInput): RequirementInput {
  const text = (input.text ?? "").trim();
  if (!text) throw new CheckpointError("The line item text can't be empty.");
  if (!ROW_TYPES.includes(input.type)) throw new CheckpointError(`Unknown type: ${input.type}`);
  if (!PRIORITIES.includes(input.priority)) throw new CheckpointError(`Unknown priority: ${input.priority}`);
  const page = input.page;
  if (page !== null && (!Number.isInteger(page) || page < 1)) {
    throw new CheckpointError("Page must be a whole number of 1 or more.");
  }
  return { section: input.section?.trim() || null, sectionId: input.sectionId ?? null, text, type: input.type,
           priority: input.priority, page };
}

/** The list can change until the RFP is sent out to experts. */
export async function lockOpenList(db: Db, rfpId: number): Promise<void> {
  const { rows } = await db.query(`select sent_out_at from rfp where id = $1 for update`, [rfpId]);
  if (!rows[0]) throw new CheckpointError("This RFP does not exist.");
  if (rows[0].sent_out_at) {
    throw new CheckpointError("This RFP has been sent to experts, so line items can't change. You can still reassign them.");
  }
}

async function checkSection(db: Db, rfpId: number, sectionId: number | null): Promise<void> {
  if (sectionId === null) throw new CheckpointError("Choose a section for this line item.");
  const { rows } = await db.query(`select 1 from rfp_section where id = $1 and rfp_id = $2`, [sectionId, rfpId]);
  if (!rows[0]) throw new CheckpointError("That section is not part of this RFP.");
}

export async function rfpOf(db: Db, requirementId: number): Promise<number> {
  const { rows } = await db.query(`select rfp_id from requirement where id = $1`, [requirementId]);
  if (!rows[0]) throw new CheckpointError("This line item no longer exists.");
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

export async function logChange(
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
  return { req_ref: r.reqRef, rfp_section: r.section, section_id: r.sectionId, text: r.text, type: r.type,
           priority: r.priority, page: r.page, created_by: r.createdBy };
}

function inputOf(r: Requirement): RequirementInput {
  return { section: r.section, sectionId: r.sectionId, text: r.text, type: r.type as RowType,
           priority: r.priority, page: r.page };
}

function sameInput(a: RequirementInput, b: RequirementInput): boolean {
  return a.section === b.section && a.sectionId === b.sectionId && a.text === b.text && a.type === b.type
    && a.priority === b.priority && a.page === b.page;
}

type RfpRow = {
  id: string; buyer: string; title: string; source_file: string; due_date: Date | null;
  extract_model: string | null; extract_prompt_version: string | null; extracted_at: Date | null;
  sent_out_by: string | null; sent_out_at: Date | null; responses_due_at: Date | null; row_count: string;
  received_at: Date; decision: "bid" | "no_bid" | null; recommendation: "bid" | "no_bid" | null;
  go_no_go_score: string | null; decided_by: string | null; decision_reason: string | null; decided_at: Date | null;
};

type RequirementRow = {
  id: string; rfp_id: string; req_ref: string; rfp_section: string | null; section_id: string | null; text: string; type: string;
  mandatory: boolean; scored: boolean; page: number | null; created_by: "ai" | "reviewer";
  assignee_id: string | null; edited: boolean;
  answer: Answer | null; note: string | null; answer_person_id: string | null; answer_person_name: string | null;
  answer_status: "draft" | "submitted" | null;
  suggestion_id: string | null; suggestion_answer: Answer | null; suggestion_reason: string | null;
  cited_ids: string[] | null; flags: string[] | null; sources: LibrarySource[];
  forward_count: string; forward_from: string | null; forward_note: string | null;
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
    sentOutBy: r.sent_out_by,
    sentOutAt: r.sent_out_at,
    responsesDueAt: r.responses_due_at,
    receivedAt: r.received_at,
    rowCount: Number(r.row_count),
    decision: r.decision === null ? null : {
      decision: r.decision, recommendation: r.recommendation!, score: Number(r.go_no_go_score),
      decidedBy: r.decided_by!, reason: r.decision_reason!, decidedAt: r.decided_at!,
    },
  };
}

function toRequirement(r: RequirementRow): Requirement {
  return {
    id: Number(r.id),
    rfpId: Number(r.rfp_id),
    reqRef: r.req_ref,
    section: r.rfp_section,
    sectionId: r.section_id === null ? null : Number(r.section_id),
    text: r.text,
    type: r.type,
    priority: r.mandatory ? "mandatory" : r.scored ? "scored" : "optional",
    page: r.page,
    createdBy: r.created_by,
    edited: r.edited,
    assigneeId: r.assignee_id === null ? null : Number(r.assignee_id),
    response: r.answer === null ? null : {
      answer: r.answer,
      note: r.note,
      personId: Number(r.answer_person_id),
      personName: r.answer_person_name ?? "",
      status: r.answer_status ?? "draft",
    },
    suggestion: r.suggestion_id === null ? null : {
      id: Number(r.suggestion_id),
      answer: r.suggestion_answer,
      reason: r.suggestion_reason ?? "",
      citedIds: r.cited_ids ?? [],
      sources: r.sources,
      flags: r.flags ?? [],
    },
    forwardCount: Number(r.forward_count),
    lastForward: r.forward_from === null ? null : { fromName: r.forward_from, note: r.forward_note },
  };
}
