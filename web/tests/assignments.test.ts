import { describe, expect, it } from "vitest";

import { answerMyself, assignItem, assignItems, assignSection, assignSuggested } from "../lib/assignments";
import { getRequirement, listChanges } from "../lib/requirements";
import { assigneeOf, db, item, person, rfp, section, sendOut, url, useRolledBackDb } from "./helpers";

describe.skipIf(!url)("routing line items", () => {
  useRolledBackDb();

  it("giving a section to someone moves its unassigned items", async () => {
    const id = await rfp();
    const s = await section(id, "Exhibit B");
    const a = await item(id, s, "R-001", 1, "One");
    const b = await item(id, s, "R-002", 1, "Two");
    const elena = await person("Test Elena", "Legal");
    expect(await assignSection(db, s, elena.id, "Morgan")).toBe(2);
    expect([await assigneeOf(a), await assigneeOf(b)]).toEqual([elena.id, elena.id]);
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "assign", after: { section: "Exhibit B", person: "Test Elena", items: 2 } });
  });

  it("reassigning a section keeps items the manager gave to someone else, and answered items", async () => {
    const id = await rfp();
    const s = await section(id, "Exhibit B");
    const [elena, sam, morgan] = [await person("Test Elena", "Legal"), await person("Test Sam", "Security"),
                                  await person("Test Morgan", "Proposal Manager")];
    const follows = await item(id, s, "R-001", 1, "Follows the section");
    const override = await item(id, s, "R-002", 1, "Given to security");
    const answered = await item(id, s, "R-003", 1, "Answered by the manager");
    await assignSection(db, s, elena.id, "Morgan");
    await assignItem(db, override, sam.id, "Morgan");
    await answerMyself(db, answered, morgan, "Yes", "");

    const newLawyer = await person("Test Lawyer", "Legal");
    expect(await assignSection(db, s, newLawyer.id, "Morgan")).toBe(1);
    expect(await assigneeOf(follows)).toBe(newLawyer.id);
    expect(await assigneeOf(override)).toBe(sam.id);
    expect(await assigneeOf(answered)).toBe(morgan.id);
  });

  it("giving a section with no owner moves every unanswered item in it, even ones with an owner", async () => {
    const id = await rfp();
    const s = await section(id, "Exhibit B");
    const sam = await person("Test Sam", "Security");
    const elena = await person("Test Elena", "Legal");
    const a = await item(id, s, "R-001", 1, "Encrypt data");
    await assignItem(db, a, sam.id, "Morgan");
    expect(await assignSection(db, s, elena.id, "Morgan")).toBe(1);
    expect(await assigneeOf(a)).toBe(elena.id);
  });

  it("usual owners also sets the section owner when one person got all of a section", async () => {
    const id = await rfp();
    const legalOnly = await section(id, "Appendix A", 1);
    const mixed = await section(id, "Exhibit B", 2);
    await item(id, legalOnly, "R-001", 1, "Indemnity", { type: "Legal" });
    await item(id, legalOnly, "R-002", 1, "Liability", { type: "Legal" });
    await item(id, mixed, "R-003", 1, "Insurance", { type: "Legal" });
    await item(id, mixed, "R-004", 1, "Encryption", { type: "Security" });
    await assignSuggested(db, id, "Morgan");
    const { rows } = await db.query(`select ref, assignee_id from rfp_section where rfp_id = $1 order by position`, [id]);
    expect(rows[0].assignee_id).not.toBeNull();
    expect(rows[1].assignee_id).toBeNull();
  });

  it("gives unassigned items to the usual owner for their type", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    const security = await item(id, s, "R-001", 1, "Encrypt data", { type: "Security" });
    const legal = await item(id, s, "R-002", 1, "Insurance", { type: "Legal" });
    const taken = await item(id, s, "R-003", 1, "Already owned", { type: "Security" });
    const [sam, elena, other] = [await person("Test Sam", "Security"), await person("Test Elena", "Legal"),
                                 await person("Test Other", "Customer Support")];
    await assignItem(db, taken, other.id, "Morgan");
    // Seeded people with the same roles may exist; only check the role landed right.
    expect(await assignSuggested(db, id, "Morgan")).toBe(2);
    const roles = await db.query(
      `select q.id, p.role from requirement q join person p on p.id = q.assignee_id where q.id = any($1)`,
      [[security, legal]],
    );
    expect(Object.fromEntries(roles.rows.map((r) => [Number(r.id), r.role])))
      .toEqual({ [security]: sam.role, [legal]: elena.role });
    expect(await assigneeOf(taken)).toBe(other.id);
  });

  it("the manager can answer an item themselves; it counts as submitted", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "VII"), "R-001", 1, "Register as a vendor");
    const morgan = await person("Test Morgan", "Proposal Manager");
    await answerMyself(db, rowId, morgan, "Yes", "");
    const row = await getRequirement(db, rowId);
    expect(row).toMatchObject({ assigneeId: morgan.id,
                                response: { answer: "Yes", personName: "Test Morgan", status: "submitted" } });
    const [change] = await listChanges(db, id);
    expect(change).toMatchObject({ action: "answer", before: null, after: { answer: "Yes", person: "Test Morgan" } });
  });

  it("No and Maybe need a note", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "IV"), "R-001", 1, "FedRAMP Moderate");
    const morgan = await person("Test Morgan", "Proposal Manager");
    await expect(answerMyself(db, rowId, morgan, "No", "  ")).rejects.toThrow("note");
    await expect(answerMyself(db, rowId, morgan, "Maybe", "")).rejects.toThrow("note");
    await answerMyself(db, rowId, morgan, "No", "Not FedRAMP authorized");
    expect((await getRequirement(db, rowId)).response?.note).toBe("Not FedRAMP authorized");
  });

  it("assigning a selection moves the unanswered items and skips answered ones", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    const [a, b, done] = [await item(id, s, "R-001", 1, "One"), await item(id, s, "R-002", 1, "Two"),
                          await item(id, s, "R-003", 1, "Answered")];
    const morgan = await person("Test Morgan", "Proposal Manager");
    await answerMyself(db, done, morgan, "Yes", "");
    const sam = await person("Test Sam", "Security");
    expect(await assignItems(db, [a, b, done], sam.id, "Morgan")).toBe(2);
    expect([await assigneeOf(a), await assigneeOf(b), await assigneeOf(done)]).toEqual([sam.id, sam.id, morgan.id]);
  });

  it("an answered item can't be reassigned", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "IV"), "R-001", 1, "Row");
    await answerMyself(db, rowId, await person("Test Morgan", "Proposal Manager"), "Yes", "");
    await expect(assignItem(db, rowId, (await person("Test Sam", "Security")).id, "Morgan"))
      .rejects.toThrow("already answered");
  });

  it("items can still be reassigned after the RFP is sent out", async () => {
    const id = await rfp();
    const rowId = await item(id, await section(id, "IV"), "R-001", 1, "Row");
    await sendOut(id);
    const sam = await person("Test Sam", "Security");
    await assignItem(db, rowId, sam.id, "Morgan");
    expect(await assigneeOf(rowId)).toBe(sam.id);
  });
});
