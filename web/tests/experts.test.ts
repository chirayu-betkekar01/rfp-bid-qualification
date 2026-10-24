import { describe, expect, it } from "vitest";

import { answerMyself, assignItem } from "../lib/assignments";
import {
  forwardItems, listProgress, nudge, reassignedMessage, saveDraft, sendOut, submitAnswers,
} from "../lib/experts";
import { getRequirement, listChanges } from "../lib/requirements";
import { deliver } from "../lib/slack";
import { assigneeOf, db, item, person, rfp, section, url, useRolledBackDb } from "./helpers";

const soon = () => new Date(Date.now() + 5 * 24 * 3600 * 1000);

/** An RFP with two items for Sam (Security) and one for Elena (Legal), managed by Morgan. */
async function round() {
  const id = await rfp();
  const s = await section(id, "Exhibit B");
  const [morgan, sam, elena] = [await person("Test Morgan", "Proposal Manager"), await person("Test Sam", "Security"),
                                await person("Test Elena", "Legal")];
  const enc = await item(id, s, "R-001", 1, "Encrypt data");
  const logs = await item(id, s, "R-002", 1, "Keep logs 180 days");
  const ins = await item(id, s, "R-003", 1, "Cyber insurance $5M");
  for (const [row, p] of [[enc, sam], [logs, sam], [ins, elena]] as const) await assignItem(db, row, p.id, "Test Morgan");
  return { id, morgan, sam, elena, enc, logs, ins };
}

describe.skipIf(!url)("expert round", () => {
  useRolledBackDb();

  it("send out needs every item to have an owner or an answer", async () => {
    const { id, morgan, ins } = await round();
    await assignItem(db, ins, null, "Test Morgan");
    await expect(sendOut(db, id, morgan, soon())).rejects.toThrow("1 line items still need an owner");
  });

  it("send out locks the list and writes one message per person, with their own link", async () => {
    const { id, morgan, sam, elena } = await round();
    const messages = await sendOut(db, id, morgan, soon());
    expect(messages.map((m) => m.personId).sort()).toEqual([sam.id, elena.id].sort());
    const toSam = messages.find((m) => m.personId === sam.id)!;
    expect(toSam.text).toContain("2 line items");
    expect(toSam.text).toContain(`/r/${sam.linkToken}`);
    await expect(sendOut(db, id, morgan, soon())).rejects.toThrow("already been sent out");
  });

  it("the manager's own answered items need no message", async () => {
    const { id, morgan, ins } = await round();
    await answerMyself(db, ins, morgan, "Yes", "");
    const messages = await sendOut(db, id, morgan, soon());
    expect(messages).toHaveLength(1);
  });

  it("an answer deadline in the past is refused", async () => {
    const { id, morgan } = await round();
    await expect(sendOut(db, id, morgan, new Date("2020-01-01"))).rejects.toThrow("future");
  });

  it("experts can only answer items they hold, on sent-out RFPs", async () => {
    const { id, morgan, sam, elena, enc } = await round();
    await expect(saveDraft(db, enc, sam, "Yes", "", null)).rejects.toThrow("not been sent out");
    await sendOut(db, id, morgan, soon());
    await expect(saveDraft(db, enc, elena, "Yes", "", null)).rejects.toThrow("no longer with you");
    await expect(saveDraft(db, enc, sam, "Maybe", " ", null)).rejects.toThrow("note");
    await saveDraft(db, enc, sam, "Yes", "", null);
    expect((await getRequirement(db, enc)).response).toMatchObject({ answer: "Yes", status: "draft" });
  });

  it("forwarding moves the item, keeps the chain, drops the sender's draft and tells the new person", async () => {
    const { id, morgan, sam, elena, enc } = await round();
    await sendOut(db, id, morgan, soon());
    await saveDraft(db, enc, sam, "Maybe", "Not sure this is mine", null);
    const [message] = await forwardItems(db, [enc], sam, elena.id, "Legal owns the Rider");
    expect(await assigneeOf(enc)).toBe(elena.id);
    const row = await getRequirement(db, enc);
    expect(row).toMatchObject({ response: null, forwardCount: 1,
                                lastForward: { fromName: "Test Sam", note: "Legal owns the Rider" } });
    expect(message).toMatchObject({ personId: elena.id, kind: "forwarded" });
    expect(message.text).toContain("Legal owns the Rider");
    expect((await listChanges(db, id))[0]).toMatchObject({ action: "forward", reviewer: "Test Sam" });
    await expect(forwardItems(db, [enc], sam, morgan.id, "")).rejects.toThrow("no longer with you");
  });

  it("submitting needs every item answered; the last submission tells the manager", async () => {
    const { id, morgan, sam, elena, enc, logs, ins } = await round();
    await sendOut(db, id, morgan, soon());
    await saveDraft(db, enc, sam, "Yes", "", null);
    await expect(submitAnswers(db, id, sam)).rejects.toThrow("1 line item left");
    await saveDraft(db, logs, sam, "No", "We keep 90 days", null);
    expect(await submitAnswers(db, id, sam)).toEqual({ submitted: 2, messages: [] });
    await expect(saveDraft(db, enc, sam, "No", "changed my mind", null)).rejects.toThrow("already submitted");

    await saveDraft(db, ins, elena, "Yes", "", null);
    const { messages } = await submitAnswers(db, id, elena);
    expect(messages).toEqual([expect.objectContaining({ kind: "all_done", personId: morgan.id })]);
  });

  it("progress counts what each person holds, answered and submitted", async () => {
    const { id, morgan, sam, enc } = await round();
    await sendOut(db, id, morgan, soon());
    await saveDraft(db, enc, sam, "Yes", "", null);
    const samRow = (await listProgress(db, id)).find((p) => p.person.id === sam.id);
    expect(samRow).toMatchObject({ items: 2, answered: 1, submitted: 0 });
  });

  it("nudges only people with open items; reassigning after send out tells the new owner", async () => {
    const { id, morgan, sam, elena, enc, logs } = await round();
    await sendOut(db, id, morgan, soon());
    expect((await nudge(db, id, sam.id, morgan))[0].text).toContain("2 line items");
    for (const row of [enc, logs]) await saveDraft(db, row, sam, "Yes", "", null);
    await submitAnswers(db, id, sam);
    await expect(nudge(db, id, sam.id, morgan)).rejects.toThrow("nothing left");
    expect(await reassignedMessage(db, id, elena.id, 1, morgan)).toHaveLength(1);
    expect(await reassignedMessage(db, id, elena.id, 0, morgan)).toHaveLength(0);
  });

  it("every Slack attempt is logged, sent or not", async () => {
    const { id, morgan } = await round();
    const messages = await sendOut(db, id, morgan, soon());
    let calls = 0;
    const sent = await deliver(db, id, messages, async () => (++calls === 1 ? { ok: true } : { ok: false, error: "down" }));
    expect(sent).toBe(1);
    const { rows } = await db.query(`select ok, error from notification where rfp_id = $1 order by id`, [id]);
    expect(rows).toEqual([{ ok: true, error: null }, { ok: false, error: "down" }]);
  });
});
