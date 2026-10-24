/**
 * Routing line items to the people who answer them.
 *
 * A section has an owner. Giving a section without an owner to someone moves all of
 * its unanswered items to them. Giving a section that already has an owner to someone
 * else moves only the items that were following it (unassigned, or with the previous
 * owner), so items the manager gave to someone else stay put. Answered items never move.
 * Callers run each mutation in a transaction.
 */
import { getPerson, listPeople, suggestedOwner, type Person } from "./people";
import {
  ANSWERS, CheckpointError, checkReviewer, getRequirement, logChange, rfpOf, type Answer, type Db,
} from "./requirements";

/** Give a whole section to one person (or nobody). Returns how many items moved with it. */
export async function assignSection(
  db: Db, sectionId: number, personId: number | null, actor: string,
): Promise<number> {
  const name = checkReviewer(actor);
  const { rows } = await db.query(
    `select rfp_id, ref, assignee_id from rfp_section where id = $1 for update`, [sectionId],
  );
  if (!rows[0]) throw new CheckpointError("This section no longer exists.");
  const { rfp_id: rfpId, ref } = rows[0];
  const previous = rows[0].assignee_id === null ? null : Number(rows[0].assignee_id);
  const next = personId === null ? null : await getPerson(db, personId);
  if (previous === (next?.id ?? null)) return 0;

  const moved = await db.query(
    `update requirement q set assignee_id = $2
     where q.section_id = $1 and ($3::bigint is null or q.assignee_id is null or q.assignee_id = $3)
       and not exists (select 1 from line_response a where a.requirement_id = q.id)
     returning q.id`,
    [sectionId, next?.id ?? null, previous],
  );
  await db.query(`update rfp_section set assignee_id = $2 where id = $1`, [sectionId, next?.id ?? null]);
  await logChange(db, Number(rfpId), null, "assign",
                  { section: ref, person: previous === null ? null : (await getPerson(db, previous)).name },
                  { section: ref, person: next?.name ?? null, items: moved.rowCount }, name);
  return moved.rowCount ?? 0;
}

/** Give one item to one person (or nobody), overriding the section owner. Returns 1 if it moved. */
export async function assignItem(
  db: Db, requirementId: number, personId: number | null, actor: string,
): Promise<number> {
  const name = checkReviewer(actor);
  const item = await getRequirement(db, requirementId);
  if (item.response) {
    throw new CheckpointError(`${item.reqRef} is already answered by ${item.response.personName}.`);
  }
  const next = personId === null ? null : await getPerson(db, personId);
  if (item.assigneeId === (next?.id ?? null)) return 0;
  const previous = item.assigneeId === null ? null : await getPerson(db, item.assigneeId);
  await db.query(`update requirement set assignee_id = $2 where id = $1`, [requirementId, next?.id ?? null]);
  await logChange(db, await rfpOf(db, requirementId), requirementId, "assign",
                  { req_ref: item.reqRef, person: previous?.name ?? null },
                  { req_ref: item.reqRef, person: next?.name ?? null }, name);
  return 1;
}

/** Give every unassigned, unanswered item to the usual owner for its type. Returns how many moved. */
export async function assignSuggested(db: Db, rfpId: number, actor: string): Promise<number> {
  const name = checkReviewer(actor);
  const people = await listPeople(db);
  const { rows } = await db.query(
    `select q.id, q.type from requirement q
     where q.rfp_id = $1 and q.assignee_id is null
       and not exists (select 1 from line_response a where a.requirement_id = q.id)`,
    [rfpId],
  );
  let moved = 0;
  for (const row of rows) {
    const owner = suggestedOwner(row.type, people);
    if (!owner) continue;
    await db.query(`update requirement set assignee_id = $2 where id = $1`, [row.id, owner.id]);
    moved += 1;
  }
  if (moved) {
    // A section whose items all went to one person now has that person as its owner.
    await db.query(
      `update rfp_section s set assignee_id = owners.assignee_id
       from (select section_id, min(assignee_id) as assignee_id from requirement
             where rfp_id = $1 and section_id is not null group by section_id
             having count(distinct assignee_id) = 1 and count(*) = count(assignee_id)) owners
       where s.id = owners.section_id and s.assignee_id is null`,
      [rfpId],
    );
    await logChange(db, rfpId, null, "assign", null, { suggested: true, items: moved }, name);
  }
  return moved;
}

/**
 * The manager answers an item themselves instead of sending it out. The item becomes
 * theirs and the answer counts as submitted straight away.
 */
export async function answerMyself(
  db: Db, requirementId: number, manager: Person, answer: Answer, note: string,
): Promise<void> {
  const name = checkReviewer(manager.name);
  const trimmed = checkAnswer(answer, note);
  const item = await getRequirement(db, requirementId);
  await db.query(`update requirement set assignee_id = $2 where id = $1`, [requirementId, manager.id]);
  await db.query(
    `insert into line_response (requirement_id, person_id, answer, note, status, submitted_at)
     values ($1, $2, $3, $4, 'submitted', now())
     on conflict (requirement_id) do update set person_id = excluded.person_id, answer = excluded.answer,
       note = excluded.note, status = 'submitted', updated_at = now(), submitted_at = now()`,
    [requirementId, manager.id, answer, trimmed],
  );
  await logChange(db, await rfpOf(db, requirementId), requirementId, "answer",
                  item.response ? { req_ref: item.reqRef, answer: item.response.answer, note: item.response.note,
                                    person: item.response.personName } : null,
                  { req_ref: item.reqRef, answer, note: trimmed, person: manager.name }, name);
}

/** Yes needs nothing more; No and Maybe need a note saying why. Returns the trimmed note. */
export function checkAnswer(answer: Answer, note: string | null | undefined): string | null {
  if (!ANSWERS.includes(answer)) throw new CheckpointError(`Unknown answer: ${answer}`);
  const trimmed = (note ?? "").trim() || null;
  if (answer !== "Yes" && !trimmed) throw new CheckpointError(`Add a note explaining the ${answer}.`);
  return trimmed;
}
