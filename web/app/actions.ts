"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";

import { inTransaction } from "@/lib/db";
import { REVIEWER_COOKIE, getReviewer } from "@/lib/reviewer";
import {
  CheckpointError, addRequirement, checkReviewer, confirmRequirements, deleteRequirement,
  editRequirement, mergeRequirements, reopenRequirements, type RequirementInput,
} from "@/lib/requirements";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setReviewer(name: string): Promise<ActionResult> {
  return run(async () => {
    (await cookies()).set(REVIEWER_COOKIE, checkReviewer(name), { httpOnly: true, sameSite: "lax", path: "/" });
  });
}

export async function addRow(rfpId: number, input: RequirementInput, reason?: string) {
  return run(async (reviewer) => inTransaction((db) => addRequirement(db, rfpId, input, reviewer, reason)));
}

export async function editRow(requirementId: number, changes: Partial<RequirementInput>, reason?: string) {
  return run(async (reviewer) =>
    inTransaction((db) => editRequirement(db, requirementId, changes, reviewer, reason)));
}

export async function mergeRows(requirementIds: number[], merged: RequirementInput, reason?: string) {
  return run(async (reviewer) =>
    inTransaction((db) => mergeRequirements(db, requirementIds, merged, reviewer, reason)));
}

export async function deleteRow(requirementId: number, reason?: string) {
  return run(async (reviewer) => inTransaction((db) => deleteRequirement(db, requirementId, reviewer, reason)));
}

export async function confirmList(rfpId: number) {
  return run(async (reviewer) => inTransaction((db) => confirmRequirements(db, rfpId, reviewer)));
}

export async function reopenList(rfpId: number, reason: string) {
  return run(async (reviewer) => inTransaction((db) => reopenRequirements(db, rfpId, reviewer, reason)));
}

/** Run a change as the current reviewer; rule breaks come back as messages, anything else is thrown. */
async function run(change: (reviewer: string) => Promise<unknown>): Promise<ActionResult> {
  try {
    await change(await getReviewer());
  } catch (error) {
    if (error instanceof CheckpointError) return { ok: false, error: error.message };
    throw error;
  }
  refresh();
  return { ok: true };
}
