/**
 * The round of expert answers: sending out, answering, forwarding, submitting and nudging.
 *
 * Functions return the Slack messages to send; callers deliver them after the
 * transaction commits (see lib/slack.ts). Callers run each mutation in a transaction.
 */
import { checkAnswer } from "./assignments";
import { getPerson, MANAGER_ROLE, type Person } from "./people";
import { CheckpointError, checkReviewer, getRequirement, logChange, type Answer, type Db } from "./requirements";
import { managerLink, personalLink, type Message } from "./slack";

export type PersonProgress = {
  person: Person;
  items: number;            // items they hold now
  answered: number;         // with an answer (draft or submitted)
  submitted: number;
  lastNudgedAt: Date | null;
};

type RfpInfo = { buyer: string; title: string; sentOutAt: Date | null; sentOutBy: string | null; dueAt: Date | null };

async function rfpInfo(db: Db, rfpId: number, lock = false): Promise<RfpInfo> {
  const { rows } = await db.query(
    `select buyer, title, sent_out_at, sent_out_by, responses_due_at from rfp where id = $1 ${lock ? "for update" : ""}`,
    [rfpId],
  );
  if (!rows[0]) throw new CheckpointError("This RFP does not exist.");
  return { buyer: rows[0].buyer, title: rows[0].title, sentOutAt: rows[0].sent_out_at,
           sentOutBy: rows[0].sent_out_by, dueAt: rows[0].responses_due_at };
}

const day = (d: Date | null) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "soon";
const items = (n: number) => `${n} line ${n === 1 ? "item" : "items"}`;
const rfpName = (r: RfpInfo) => `*${r.buyer}: ${r.title}*`;

/** Items each person holds that still need their answer. */
async function openItemsByPerson(db: Db, rfpId: number): Promise<Map<number, number>> {
  const { rows } = await db.query(
    `select q.assignee_id, count(*) as n from requirement q
     left join line_response a on a.requirement_id = q.id
     where q.rfp_id = $1 and q.assignee_id is not null and (a.id is null or a.status = 'draft')
     group by q.assignee_id`,
    [rfpId],
  );
  return new Map(rows.map((r) => [Number(r.assignee_id), Number(r.n)]));
}

/**
 * Lock the list and tell everyone who holds items. Every item must have an owner or an answer.
 */
export async function sendOut(db: Db, rfpId: number, actor: Person, dueAt: Date): Promise<Message[]> {
  const name = checkReviewer(actor.name);
  const rfp = await rfpInfo(db, rfpId, true);
  if (rfp.sentOutAt) throw new CheckpointError("This RFP has already been sent out.");
  if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() < Date.now() - 60_000) {
    throw new CheckpointError("Pick an answer deadline in the future.");
  }
  const { rows } = await db.query(
    `select count(*) filter (where q.assignee_id is null and a.id is null) as unassigned, count(*) as total
     from requirement q left join line_response a on a.requirement_id = q.id where q.rfp_id = $1`,
    [rfpId],
  );
  if (Number(rows[0].total) === 0) throw new CheckpointError("There are no line items to send out.");
  if (Number(rows[0].unassigned) > 0) {
    throw new CheckpointError(`${rows[0].unassigned} line items still need an owner or an answer.`);
  }

  await db.query(`update rfp set sent_out_at = now(), sent_out_by = $2, responses_due_at = $3 where id = $1`,
                 [rfpId, name, dueAt]);
  const open = await openItemsByPerson(db, rfpId);
  await logChange(db, rfpId, null, "send_out", null, { people: open.size, due: dueAt.toISOString() }, name);

  const sent = { ...rfp, dueAt };
  const messages: Message[] = [];
  for (const [personId, count] of open) {
    const person = await getPerson(db, personId);
    messages.push({
      personId, kind: "send_out",
      text: `*${person.name}* (${person.role}): ${name} needs your input on ${rfpName(sent)}. `
        + `${items(count)}, answers due ${day(dueAt)}. <${personalLink(person.linkToken)}|Open your items>`,
    });
  }
  return messages;
}

/** Save an answer the expert can still change until they submit. */
export async function saveDraft(
  db: Db, requirementId: number, person: Person, answer: Answer, note: string, suggestionId: number | null,
): Promise<void> {
  const trimmed = checkAnswer(answer, note);
  const item = await getRequirement(db, requirementId);
  await checkHolder(db, item.rfpId, item.assigneeId, person);
  if (item.response?.status === "submitted") throw new CheckpointError(`${item.reqRef} is already submitted.`);
  await db.query(
    `insert into line_response (requirement_id, person_id, answer, note, suggestion_id, status)
     values ($1, $2, $3, $4, $5, 'draft')
     on conflict (requirement_id) do update set person_id = excluded.person_id, answer = excluded.answer,
       note = excluded.note, suggestion_id = excluded.suggestion_id, updated_at = now()`,
    [requirementId, person.id, answer, trimmed, suggestionId],
  );
}

/** Pass items to someone who can answer them. Any draft answer of the sender is dropped. */
export async function forwardItems(
  db: Db, requirementIds: number[], from: Person, toPersonId: number, note: string,
): Promise<Message[]> {
  const ids = [...new Set(requirementIds)];
  if (ids.length === 0) throw new CheckpointError("Pick the line items to forward.");
  const to = await getPerson(db, toPersonId);
  if (to.id === from.id) throw new CheckpointError("Forward to someone else.");
  const trimmed = note.trim() || null;
  let rfpId: number | null = null;
  const refs: string[] = [];
  for (const id of ids) {
    const item = await getRequirement(db, id);
    if (rfpId !== null && item.rfpId !== rfpId) throw new CheckpointError("Forward items from one RFP at a time.");
    rfpId = item.rfpId;
    await checkHolder(db, item.rfpId, item.assigneeId, from);
    if (item.response?.status === "submitted") throw new CheckpointError(`${item.reqRef} is already submitted.`);
    await db.query(`delete from line_response where requirement_id = $1`, [id]);
    await db.query(`update requirement set assignee_id = $2 where id = $1`, [id, to.id]);
    await db.query(`insert into forward (requirement_id, from_person_id, to_person_id, note) values ($1, $2, $3, $4)`,
                   [id, from.id, to.id, trimmed]);
    await logChange(db, item.rfpId, id, "forward", { req_ref: item.reqRef, person: from.name },
                    { req_ref: item.reqRef, person: to.name }, from.name, trimmed ?? undefined);
    refs.push(item.reqRef);
  }
  const rfp = await rfpInfo(db, rfpId!);
  return [{
    personId: to.id, kind: "forwarded",
    text: `*${to.name}* (${to.role}): ${from.name} forwarded you ${items(ids.length)} on ${rfpName(rfp)}`
      + `${trimmed ? `: "${trimmed}"` : ""}. Answers due ${day(rfp.dueAt)}. <${personalLink(to.linkToken)}|Open your items>`,
  }];
}

/**
 * Submit every answer the person has for one RFP. All their items there must be answered.
 * When this was the last open item, the manager is told the round is complete.
 */
export async function submitAnswers(db: Db, rfpId: number, person: Person): Promise<{ submitted: number; messages: Message[] }> {
  const rfp = await rfpInfo(db, rfpId, true);
  if (!rfp.sentOutAt) throw new CheckpointError("This RFP has not been sent out yet.");
  const { rows } = await db.query(
    `select count(*) filter (where a.id is null) as open, count(*) filter (where a.status = 'draft') as drafts
     from requirement q left join line_response a on a.requirement_id = q.id
     where q.rfp_id = $1 and q.assignee_id = $2`,
    [rfpId, person.id],
  );
  if (Number(rows[0].open) > 0) {
    throw new CheckpointError(`Answer or forward the ${items(Number(rows[0].open))} left before submitting.`);
  }
  const done = await db.query(
    `update line_response a set status = 'submitted', submitted_at = now(), updated_at = now()
     from requirement q where q.id = a.requirement_id and q.rfp_id = $1 and a.person_id = $2 and a.status = 'draft'
     returning a.requirement_id`,
    [rfpId, person.id],
  );
  const submitted = done.rowCount ?? 0;
  if (submitted === 0) return { submitted, messages: [] };
  await logChange(db, rfpId, null, "answer", null, { submitted, person: person.name }, person.name);
  return { submitted, messages: await allDoneMessage(db, rfpId, rfp) };
}

/** A reminder for one person who still has items open. */
export async function nudge(db: Db, rfpId: number, personId: number, actor: Person): Promise<Message[]> {
  checkReviewer(actor.name);
  const rfp = await rfpInfo(db, rfpId);
  if (!rfp.sentOutAt) throw new CheckpointError("Send the RFP out before nudging anyone.");
  const open = (await openItemsByPerson(db, rfpId)).get(personId) ?? 0;
  const person = await getPerson(db, personId);
  if (open === 0) throw new CheckpointError(`${person.name} has nothing left to answer.`);
  return [{
    personId, kind: "nudge",
    text: `*${person.name}*: a reminder from ${actor.name}. ${items(open)} on ${rfpName(rfp)} still need your answer, `
      + `due ${day(rfp.dueAt)}. <${personalLink(person.linkToken)}|Open your items>`,
  }];
}

/** After the manager reassigns items on a sent-out RFP, tell the new owner. */
export async function reassignedMessage(db: Db, rfpId: number, personId: number | null, count: number,
                                        actor: Person): Promise<Message[]> {
  if (personId === null || count === 0) return [];
  const rfp = await rfpInfo(db, rfpId);
  if (!rfp.sentOutAt) return [];
  const person = await getPerson(db, personId);
  return [{
    personId, kind: "reassigned",
    text: `*${person.name}* (${person.role}): ${actor.name} gave you ${items(count)} on ${rfpName(rfp)}. `
      + `Answers due ${day(rfp.dueAt)}. <${personalLink(person.linkToken)}|Open your items>`,
  }];
}

/** Who holds what on one RFP, for the manager's progress view. */
export async function listProgress(db: Db, rfpId: number): Promise<PersonProgress[]> {
  const { rows } = await db.query(
    `select p.id, p.name, p.role, p.link_token,
            count(q.id) as items, count(a.id) as answered,
            count(a.id) filter (where a.status = 'submitted') as submitted,
            (select max(n.sent_at) from notification n
             where n.rfp_id = $1 and n.person_id = p.id and n.kind = 'nudge') as last_nudged_at
     from person p
     join requirement q on q.assignee_id = p.id and q.rfp_id = $1
     left join line_response a on a.requirement_id = q.id
     group by p.id order by p.role = '${MANAGER_ROLE}' desc, p.name`,
    [rfpId],
  );
  return rows.map((r) => ({
    person: { id: Number(r.id), name: r.name, role: r.role, linkToken: r.link_token },
    items: Number(r.items), answered: Number(r.answered), submitted: Number(r.submitted),
    lastNudgedAt: r.last_nudged_at,
  }));
}

export type NotificationRow = {
  id: number;
  personName: string | null;
  kind: string;
  ok: boolean;
  error: string | null;
  sentAt: Date;
};

export async function listNotifications(db: Db, rfpId: number, limit = 30): Promise<NotificationRow[]> {
  const { rows } = await db.query(
    `select n.id, p.name, n.kind, n.ok, n.error, n.sent_at from notification n
     left join person p on p.id = n.person_id where n.rfp_id = $1 order by n.sent_at desc, n.id desc limit $2`,
    [rfpId, limit],
  );
  return rows.map((r) => ({ id: Number(r.id), personName: r.name, kind: r.kind, ok: r.ok, error: r.error,
                            sentAt: r.sent_at }));
}

async function allDoneMessage(db: Db, rfpId: number, rfp: RfpInfo): Promise<Message[]> {
  const { rows } = await db.query(
    `select count(*) filter (where a.status is distinct from 'submitted') as open from requirement q
     left join line_response a on a.requirement_id = q.id where q.rfp_id = $1`,
    [rfpId],
  );
  if (Number(rows[0].open) > 0) return [];
  const manager = rfp.sentOutBy
    ? (await db.query(`select id from person where name = $1`, [rfp.sentOutBy])).rows[0]
    : undefined;
  return [{
    personId: manager ? Number(manager.id) : null, kind: "all_done",
    text: `*${rfp.sentOutBy ?? "Proposal manager"}*: every line item on ${rfpName(rfp)} has an answer. `
      + `<${managerLink(rfpId)}|See the answers>`,
  }];
}

async function checkHolder(db: Db, rfpId: number, assigneeId: number | null, person: Person): Promise<void> {
  const rfp = await rfpInfo(db, rfpId);
  if (!rfp.sentOutAt) throw new CheckpointError("This RFP has not been sent out yet.");
  if (assigneeId !== person.id) throw new CheckpointError("This line item is no longer with you.");
}
