import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CheckpointError, addRequirement, confirmRequirements, deleteRequirement, editRequirement,
  listChanges, listRequirements, mergeRequirements, reopenRequirements, type RequirementInput,
} from "../lib/requirements";

// Runs against the local test database (npx supabase start); every test is rolled back.
const url = process.env.TEST_DATABASE_URL;
const db = new Client({ connectionString: url });

const ROW: RequirementInput = { section: "IV.A", text: "Provide a CRM", type: "Functional",
                                priority: "optional", page: 4 };

async function rfp(): Promise<number> {
  const { rows } = await db.query(
    `insert into rfp (buyer, title, source_file) values ('Test buyer', 'Test RFP', 'x.pdf') returning id`,
  );
  return Number(rows[0].id);
}

async function aiRow(rfpId: number, ref: string, page: number, text: string, mandatory = false) {
  const { rows } = await db.query(
    `insert into requirement (rfp_id, req_ref, rfp_section, text, type, mandatory, page, created_by)
     values ($1, $2, 'Exhibit B.6', $3, 'Legal', $4, $5, 'ai') returning id`,
    [rfpId, ref, text, mandatory, page],
  );
  return Number(rows[0].id);
}

describe.skipIf(!url)("Checkpoint A requirement list", () => {
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  beforeEach(() => db.query("begin"));
  afterEach(() => db.query("rollback"));

  it("adds a reviewer row with the next reference and logs it", async () => {
    const id = await rfp();
    await aiRow(id, "R-007", 3, "Existing row");
    const added = await addRequirement(db, id, ROW, "Dana");
    expect(added).toMatchObject({ reqRef: "R-008", createdBy: "reviewer", priority: "optional" });
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "add", reviewer: "Dana", requirementId: added.id, before: null });
  });

  it("stores mandatory and scored as separate flags", async () => {
    const id = await rfp();
    const added = await addRequirement(db, id, { ...ROW, priority: "scored" }, "Dana");
    const { rows } = await db.query(`select mandatory, scored from requirement where id = $1`, [added.id]);
    expect(rows[0]).toEqual({ mandatory: false, scored: true });
  });

  it("logs an edit with the row before and after, and marks the row edited", async () => {
    const id = await rfp();
    const rowId = await aiRow(id, "R-001", 5, "Report breaches");
    const edited = await editRequirement(db, rowId, { priority: "mandatory" }, "Dana", "Section says shall");
    expect(edited).toMatchObject({ priority: "mandatory", edited: true, createdBy: "ai" });
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "edit", reason: "Section says shall",
                                   before: { priority: "optional" }, after: { priority: "mandatory" } });
  });

  it("does not log an edit that changes nothing", async () => {
    const id = await rfp();
    const rowId = await aiRow(id, "R-001", 5, "Report breaches");
    await editRequirement(db, rowId, { text: "  Report breaches " }, "Dana");
    expect(await listChanges(db, id)).toHaveLength(0);
  });

  it("merges rows into the first one in document order and keeps every original in the log", async () => {
    const id = await rfp();
    const later = await aiRow(id, "R-002", 9, "Name the data involved", true);
    const first = await aiRow(id, "R-001", 8, "Name the kind of access");
    const merged = await mergeRequirements(
      db, [later, first],
      { section: "Exhibit B.6", text: "Breach report contents", type: "Legal", priority: "mandatory", page: 8 },
      "Dana",
    );
    expect(merged).toMatchObject({ id: first, reqRef: "R-001", text: "Breach report contents" });
    expect((await listRequirements(db, id)).map((r) => r.id)).toEqual([first]);
    const [change] = await listChanges(db, id);
    expect(change.action).toBe("merge");
    expect((change.before as { req_ref: string }[]).map((r) => r.req_ref)).toEqual(["R-001", "R-002"]);
  });

  it("refuses to merge fewer than two rows or rows from different RFPs", async () => {
    const a = await rfp();
    const b = await rfp();
    const rowA = await aiRow(a, "R-001", 1, "One");
    const rowB = await aiRow(b, "R-001", 1, "Two");
    await expect(mergeRequirements(db, [rowA], ROW, "Dana")).rejects.toThrow(CheckpointError);
    await expect(mergeRequirements(db, [rowA, rowB], ROW, "Dana")).rejects.toThrow("same RFP");
  });

  it("deletes a row and keeps what it said in the log", async () => {
    const id = await rfp();
    const rowId = await aiRow(id, "R-001", 2, "Packing label on every box");
    await deleteRequirement(db, rowId, "Dana", "Not a vendor obligation");
    expect(await listRequirements(db, id)).toHaveLength(0);
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "delete", requirementId: rowId,
                                   before: { text: "Packing label on every box" }, after: null });
  });

  it("locks the list once it is confirmed", async () => {
    const id = await rfp();
    const rowId = await aiRow(id, "R-001", 2, "Row");
    const other = await aiRow(id, "R-002", 3, "Other row");
    await confirmRequirements(db, id, "Dana");
    const locked = "Reopen it";
    await expect(addRequirement(db, id, ROW, "Dana")).rejects.toThrow(locked);
    await expect(editRequirement(db, rowId, { text: "New" }, "Dana")).rejects.toThrow(locked);
    await expect(deleteRequirement(db, rowId, "Dana")).rejects.toThrow(locked);
    await expect(mergeRequirements(db, [rowId, other], ROW, "Dana")).rejects.toThrow(locked);
    await expect(confirmRequirements(db, id, "Dana")).rejects.toThrow(locked);
  });

  it("reopens a confirmed list only with a reason", async () => {
    const id = await rfp();
    const rowId = await aiRow(id, "R-001", 2, "Row");
    await confirmRequirements(db, id, "Dana");
    await expect(reopenRequirements(db, id, "Dana", " ")).rejects.toThrow("reason");
    await reopenRequirements(db, id, "Dana", "Missed an addendum");
    await editRequirement(db, rowId, { text: "Row, per addendum 1" }, "Dana");
    expect((await listChanges(db, id)).map((c) => c.action)).toEqual(["edit", "reopen", "confirm"]);
  });

  it("will not confirm an empty list", async () => {
    const id = await rfp();
    await expect(confirmRequirements(db, id, "Dana")).rejects.toThrow("no rows");
  });

  it("only accepts changes from a named person", async () => {
    const id = await rfp();
    await expect(addRequirement(db, id, ROW, "")).rejects.toThrow("Enter your name");
    await expect(addRequirement(db, id, ROW, "AI")).rejects.toThrow("named person");
    await expect(confirmRequirements(db, id, "system")).rejects.toThrow("named person");
  });

  it("rejects empty text, unknown types and bad page numbers", async () => {
    const id = await rfp();
    await expect(addRequirement(db, id, { ...ROW, text: "  " }, "Dana")).rejects.toThrow("empty");
    await expect(addRequirement(db, id, { ...ROW, type: "Other" as never }, "Dana")).rejects.toThrow("type");
    await expect(addRequirement(db, id, { ...ROW, page: 0 }, "Dana")).rejects.toThrow("Page");
  });
});
