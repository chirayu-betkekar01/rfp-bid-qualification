"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";

import { answerMyself, assignItem, assignSection, assignSuggested } from "@/lib/assignments";
import { inTransaction, pool } from "@/lib/db";
import { getPerson, type Person } from "@/lib/people";
import { ACTOR_COOKIE, getActor } from "@/lib/reviewer";
import {
  CheckpointError, addRequirement, deleteRequirement, editRequirement, mergeRequirements,
  type Answer, type RequirementInput,
} from "@/lib/requirements";

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
  return run((actor) => inTransaction((db) => assignSection(db, sectionId, personId, actor.name)));
}

export async function assignRowTo(requirementId: number, personId: number | null) {
  return run((actor) => inTransaction((db) => assignItem(db, requirementId, personId, actor.name)));
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
