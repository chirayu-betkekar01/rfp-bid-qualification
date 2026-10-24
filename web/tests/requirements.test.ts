import { describe, expect, it } from "vitest";

import {
  CheckpointError, addRequirement, deleteRequirement, editRequirement, listChanges, listRequirements,
  mergeRequirements, type RequirementInput,
} from "../lib/requirements";
import { answerMyself } from "../lib/assignments";
import { db, item, person, rfp, section, sendOut, url, useRolledBackDb } from "./helpers";

const row = (sectionId: number): RequirementInput => ({
  section: "IV.A", sectionId, text: "Provide a CRM", type: "Functional", priority: "optional", page: 4,
});

describe.skipIf(!url)("line-item list", () => {
  useRolledBackDb();

  it("adds a person's row with the next reference, in its section, and logs it", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    await item(id, s, "R-007", 3, "Existing row");
    const added = await addRequirement(db, id, row(s), "Dana");
    expect(added).toMatchObject({ reqRef: "R-008", createdBy: "reviewer", priority: "optional", sectionId: s });
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "add", reviewer: "Dana", requirementId: added.id, before: null });
  });

  it("gives an added row to the section's owner", async () => {
    const id = await rfp();
    const s = await section(id, "Exhibit B");
    const elena = await person("Test Elena", "Legal");
    await db.query(`update rfp_section set assignee_id = $2 where id = $1`, [s, elena.id]);
    expect((await addRequirement(db, id, row(s), "Dana")).assigneeId).toBe(elena.id);
  });

  it("refuses a section from another RFP", async () => {
    const id = await rfp();
    const other = await section(await rfp(), "IV");
    await expect(addRequirement(db, id, row(other), "Dana")).rejects.toThrow("not part of this RFP");
  });

  it("stores mandatory and scored as separate flags", async () => {
    const id = await rfp();
    const added = await addRequirement(db, id, { ...row(await section(id, "IV")), priority: "scored" }, "Dana");
    const { rows } = await db.query(`select mandatory, scored from requirement where id = $1`, [added.id]);
    expect(rows[0]).toEqual({ mandatory: false, scored: true });
  });

  it("logs an edit with the row before and after, and marks the row edited", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "Exhibit B"), "R-001", 5, "Report breaches");
    const edited = await editRequirement(db, rowId, { priority: "mandatory" }, "Dana", "Section says shall");
    expect(edited).toMatchObject({ priority: "mandatory", edited: true, createdBy: "ai" });
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "edit", reason: "Section says shall",
                                   before: { priority: "optional" }, after: { priority: "mandatory" } });
  });

  it("does not log an edit that changes nothing", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "Exhibit B"), "R-001", 5, "Report breaches");
    await editRequirement(db, rowId, { text: "  Report breaches " }, "Dana");
    expect(await listChanges(db, id)).toHaveLength(0);
  });

  it("merges rows into the first one in document order and keeps every original in the log", async () => {
    const id = await rfp();
    const s = await section(id, "Exhibit B");
    const later = await item(id, s, "R-002", 9, "Name the data involved", { mandatory: true });
    const first = await item(id, s, "R-001", 8, "Name the kind of access");
    const merged = await mergeRequirements(
      db, [later, first],
      { section: "Exhibit B.6", sectionId: s, text: "Breach report contents", type: "Legal", priority: "mandatory", page: 8 },
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
    const rowA = await item(a, await section(a, "IV"), "R-001", 1, "One");
    const rowB = await item(b, await section(b, "IV"), "R-001", 1, "Two");
    await expect(mergeRequirements(db, [rowA], row(1), "Dana")).rejects.toThrow(CheckpointError);
    await expect(mergeRequirements(db, [rowA, rowB], row(1), "Dana")).rejects.toThrow("same RFP");
  });

  it("deletes a row and keeps what it said in the log", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "Packing Label"), "R-001", 2, "Packing label on every box");
    await deleteRequirement(db, rowId, "Dana", "Not a vendor obligation");
    expect(await listRequirements(db, id)).toHaveLength(0);
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "delete", requirementId: rowId,
                                   before: { text: "Packing label on every box" }, after: null });
  });

  it("will not merge or delete answered rows", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    const a = await item(id, s, "R-001", 1, "One");
    const b = await item(id, s, "R-002", 1, "Two");
    await answerMyself(db, a, await person("Test Morgan", "Proposal Manager"), "Yes", "");
    await expect(deleteRequirement(db, a, "Dana")).rejects.toThrow("Answered");
    await expect(mergeRequirements(db, [a, b], row(s), "Dana")).rejects.toThrow("Answered");
  });

  it("locks the list once the RFP is sent out to experts", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    const rowId = await item(id, s, "R-001", 2, "Row");
    const other = await item(id, s, "R-002", 3, "Other row");
    await sendOut(id);
    const locked = "sent to experts";
    await expect(addRequirement(db, id, row(s), "Dana")).rejects.toThrow(locked);
    await expect(editRequirement(db, rowId, { text: "New" }, "Dana")).rejects.toThrow(locked);
    await expect(deleteRequirement(db, rowId, "Dana")).rejects.toThrow(locked);
    await expect(mergeRequirements(db, [rowId, other], row(s), "Dana")).rejects.toThrow(locked);
  });

  it("only accepts changes from a named person", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    await expect(addRequirement(db, id, row(s), "")).rejects.toThrow("Choose who you are");
    await expect(addRequirement(db, id, row(s), "AI")).rejects.toThrow("named person");
  });

  it("rejects empty text, unknown types and bad page numbers", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    await expect(addRequirement(db, id, { ...row(s), text: "  " }, "Dana")).rejects.toThrow("empty");
    await expect(addRequirement(db, id, { ...row(s), type: "Other" as never }, "Dana")).rejects.toThrow("type");
    await expect(addRequirement(db, id, { ...row(s), page: 0 }, "Dana")).rejects.toThrow("Page");
  });
});
