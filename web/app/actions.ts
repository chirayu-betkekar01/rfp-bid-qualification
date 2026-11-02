"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";

import { answerMyself, assignItem, assignItems, assignSection, assignSuggested } from "@/lib/assignments";
import { inTransaction, pool } from "@/lib/db";
import {
  forwardItems, nudge, reassignedMessage, saveDraft, sendOut, submitAnswers,
} from "@/lib/experts";
import {
  addContributor, findPersonByToken, getPerson, setContributorActive, updateContributor, type ContributorInput,
  type Person,
} from "@/lib/people";
import { decide, setFact, setGapCheck, type FactName, type FactValue } from "@/lib/report";
import { ACTOR_COOKIE, getActor } from "@/lib/reviewer";
import {
  CheckpointError, addRequirement, deleteRequirement, editRequirement, mergeRequirements, rfpOf,
  type Answer, type RequirementInput,
} from "@/lib/requirements";
import { deliver, type Message } from "@/lib/slack";
import { loadVendor } from "@/lib/vendor";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setActor(personId: number): Promise<ActionResult> {
  return run(async () => {
    const person = await getPerson(pool(), personId);
    (await cookies()).set(ACTOR_COOKIE, String(person.id), { httpOnly: true, sameSite: "lax", path: "/" });
  }, { needsActor: false });
}

export async function addRow(rfpId: number, input: RequirementInput, reason?: string) {
  return run((actor) => inTransaction((db) => addRequirement(db, rfpId, input, actor.name, reason)));
}

export async function editRow(requirementId: number, changes: Partial<RequirementInput>, reason?: string) {
  return run((actor) => inTransaction((db) => editRequirement(db, requirementId, changes, actor.name, reason)));
}

export async function mergeRows(requirementIds: number[], merged: RequirementInput, reason?: string) {
  return run((actor) => inTransaction((db) => mergeRequirements(db, requirementIds, merged, actor.name, reason)));
}

export async function deleteRow(requirementId: number, reason?: string) {
  return run((actor) => inTransaction((db) => deleteRequirement(db, requirementId, actor.name, reason)));
}

export async function assignSectionTo(sectionId: number, personId: number | null) {
  return run(async (actor) => {
    const { rfpId, messages } = await inTransaction(async (db) => {
      const moved = await assignSection(db, sectionId, personId, actor.name);
      const { rows } = await db.query(`select rfp_id from rfp_section where id = $1`, [sectionId]);
      const rfpId = Number(rows[0].rfp_id);
      return { rfpId, messages: await reassignedMessage(db, rfpId, personId, moved, actor) };
    });
    await send(rfpId, messages);
  });
}

export async function assignRowTo(requirementId: number, personId: number | null) {
  return run(async (actor) => {
    const { rfpId, messages } = await inTransaction(async (db) => {
      const moved = await assignItem(db, requirementId, personId, actor.name);
      const rfpId = await rfpOf(db, requirementId);
      return { rfpId, messages: await reassignedMessage(db, rfpId, personId, moved, actor) };
    });
    await send(rfpId, messages);
  });
}

export async function assignRowsTo(requirementIds: number[], personId: number | null) {
  return run(async (actor) => {
    const { rfpId, messages } = await inTransaction(async (db) => {
      const moved = await assignItems(db, requirementIds, personId, actor.name);
      const rfpId = await rfpOf(db, requirementIds[0]);
      return { rfpId, messages: await reassignedMessage(db, rfpId, personId, moved, actor) };
    });
    await send(rfpId, messages);
  });
}

export async function sendOutToExperts(rfpId: number, dueAt: string) {
  return run(async (actor) => {
    const messages = await inTransaction((db) => sendOut(db, rfpId, actor, new Date(dueAt)));
    await send(rfpId, messages);
  });
}

export async function nudgePerson(rfpId: number, personId: number) {
  return run(async (actor) => {
    const messages = await inTransaction((db) => nudge(db, rfpId, personId, actor));
    await send(rfpId, messages);
  });
}

export async function addTeamMember(input: ContributorInput) {
  return run(() => inTransaction((db) => addContributor(db, input)));
}

export async function updateTeamMember(personId: number, input: ContributorInput) {
  return run(() => inTransaction((db) => updateContributor(db, personId, input)));
}

export async function setTeamMemberActive(personId: number, active: boolean) {
  return run(() => inTransaction((db) => setContributorActive(db, personId, active)));
}

// Go / no-go: the manager corrects what the AI read, answers the relationship question, and decides.

export async function setRfpFact(rfpId: number, name: FactName, value: FactValue, reason: string) {
  return run((actor) => inTransaction((db) => setFact(db, rfpId, name, value, actor.name, reason, loadVendor())));
}

export async function checkHardFail(rfpId: number, requirementId: number, isHardFail: boolean, reason: string) {
  return run((actor) => inTransaction((db) => setGapCheck(db, rfpId, requirementId, isHardFail, actor.name, reason)));
}

export async function decideGoNoGo(rfpId: number, decision: "bid" | "no_bid", reason: string) {
  return run((actor) => inTransaction((db) => decide(db, rfpId, decision, reason, actor.name, loadVendor())));
}

// Experts act through their personal link: the token in the link says who they are.

export async function saveMyAnswer(token: string, requirementId: number, answer: Answer, note: string,
                                   suggestionId: number | null) {
  return runAs(token, (person) =>
    inTransaction((db) => saveDraft(db, requirementId, person, answer, note, suggestionId)));
}

export async function forwardMyItems(token: string, requirementIds: number[], toPersonId: number, note: string) {
  return runAs(token, async (person) => {
    const rfpId = await rfpOf(pool(), requirementIds[0]);
    const messages = await inTransaction((db) => forwardItems(db, requirementIds, person, toPersonId, note));
    await send(rfpId, messages);
  });
}

export async function submitMyAnswers(token: string, rfpId: number) {
  return runAs(token, async (person) => {
    const { messages } = await inTransaction((db) => submitAnswers(db, rfpId, person));
    await send(rfpId, messages);
  });
}

async function send(rfpId: number, messages: Message[]): Promise<void> {
  if (messages.length) await deliver(pool(), rfpId, messages);
}

async function runAs(token: string, change: (person: Person) => Promise<unknown>): Promise<ActionResult> {
  try {
    const person = await findPersonByToken(pool(), token);
    if (!person) throw new CheckpointError("This link is not valid.");
    await change(person);
  } catch (error) {
    if (error instanceof CheckpointError) return { ok: false, error: error.message };
    throw error;
  }
  refresh();
  return { ok: true };
}

export async function assignAllSuggested(rfpId: number) {
  return run((actor) => inTransaction((db) => assignSuggested(db, rfpId, actor.name)));
}

export async function answerRowMyself(requirementId: number, answer: Answer, note: string) {
  return run((actor) => inTransaction((db) => answerMyself(db, requirementId, actor, answer, note)));
}

/** Run a change as the person using the manager screen; rule breaks come back as messages. */
async function run(change: (actor: Person) => Promise<unknown>,
                   { needsActor = true }: { needsActor?: boolean } = {}): Promise<ActionResult> {
  try {
    const actor = await getActor();
    if (needsActor && !actor) throw new CheckpointError("Choose who you are before making changes.");
    await change(actor as Person);
  } catch (error) {
    if (error instanceof CheckpointError) return { ok: false, error: error.message };
    throw error;
  }
  refresh();
  return { ok: true };
}
