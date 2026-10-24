import { CheckpointError, type Db } from "./requirements";

export type Person = {
  id: number;
  name: string;
  role: string;
  linkToken: string;      // the personal link: /r/<token>
};

export const MANAGER_ROLE = "Proposal Manager";

// Who usually answers each kind of line item. Only a starting point: the manager can change any of it.
export const ROLE_FOR_TYPE: Record<string, string> = {
  Functional: "Solutions Engineering",
  Integration: "Solutions Engineering",
  "Response question": "Solutions Engineering",
  Security: "Security",
  Legal: "Legal",
  Commercial: "Deal Desk",
  Implementation: "Professional Services",
  Support: "Customer Support",
  Submission: MANAGER_ROLE,
};

const COLUMNS = "id, name, role, link_token";

export async function listPeople(db: Db): Promise<Person[]> {
  const { rows } = await db.query(
    `select ${COLUMNS} from person where active
     order by role = '${MANAGER_ROLE}' desc, role, name`,
  );
  return rows.map(toPerson);
}

export async function getPerson(db: Db, personId: number): Promise<Person> {
  const { rows } = await db.query(`select ${COLUMNS} from person where id = $1 and active`, [personId]);
  if (!rows[0]) throw new CheckpointError("That person is not on the team.");
  return toPerson(rows[0]);
}

export async function findPersonByToken(db: Db, token: string): Promise<Person | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const { rows } = await db.query(`select ${COLUMNS} from person where link_token = $1 and active`, [token]);
  return rows[0] ? toPerson(rows[0]) : null;
}

/** The person who would normally answer this type of item, if the team has one. */
export function suggestedOwner(type: string, people: Person[]): Person | null {
  const role = ROLE_FOR_TYPE[type];
  return people.find((p) => p.role === role) ?? null;
}

// ---------------------------------------------------------------------------- the team
// One team for every RFP: changes here show up in every owner dropdown.

export const KNOWN_ROLES = [...new Set([MANAGER_ROLE, ...Object.values(ROLE_FOR_TYPE),
                                        "Product Marketing", "Public Sector Team"])];

export type Contributor = Person & {
  active: boolean;
  slackUserId: string | null;
  heldHere: number;         // items they hold on this RFP
  answeredHere: number;     // of those, answered
  openAnywhere: number;     // unanswered items they hold on any RFP
};

export async function listContributors(db: Db, rfpId: number): Promise<Contributor[]> {
  const { rows } = await db.query(
    `select p.id, p.name, p.role, p.link_token, p.active, p.slack_user_id,
            count(q.id) filter (where q.rfp_id = $1) as held_here,
            count(a.id) filter (where q.rfp_id = $1) as answered_here,
            count(q.id) filter (where a.id is null or a.status = 'draft') as open_anywhere
     from person p
     left join requirement q on q.assignee_id = p.id
     left join line_response a on a.requirement_id = q.id
     group by p.id
     order by p.active desc, p.role = '${MANAGER_ROLE}' desc, p.role, p.name`,
    [rfpId],
  );
  return rows.map((r) => ({
    ...toPerson(r), active: r.active, slackUserId: r.slack_user_id,
    heldHere: Number(r.held_here), answeredHere: Number(r.answered_here), openAnywhere: Number(r.open_anywhere),
  }));
}

export type ContributorInput = { name: string; role: string; slackUserId?: string | null };

export async function addContributor(db: Db, input: ContributorInput): Promise<Person> {
  const { name, role, slackUserId } = checkContributor(input);
  await checkNameFree(db, name, null);
  const { rows } = await db.query(
    `insert into person (name, role, slack_user_id) values ($1, $2, $3) returning ${COLUMNS}`,
    [name, role, slackUserId],
  );
  return toPerson(rows[0]);
}

export async function updateContributor(db: Db, personId: number, input: ContributorInput): Promise<void> {
  const { name, role, slackUserId } = checkContributor(input);
  await checkNameFree(db, name, personId);
  const { rowCount } = await db.query(
    `update person set name = $2, role = $3, slack_user_id = $4 where id = $1`, [personId, name, role, slackUserId],
  );
  if (!rowCount) throw new CheckpointError("That person is not on the team.");
}

/** Remove someone from the dropdowns, or bring them back. Their past answers stay. */
export async function setContributorActive(db: Db, personId: number, active: boolean): Promise<void> {
  if (!active) {
    const { rows } = await db.query(
      `select count(*) as n from requirement q left join line_response a on a.requirement_id = q.id
       where q.assignee_id = $1 and (a.id is null or a.status = 'draft')`, [personId],
    );
    const open = Number(rows[0].n);
    if (open > 0) {
      throw new CheckpointError(`They still hold ${open} unanswered line ${open === 1 ? "item" : "items"}. Reassign them first.`);
    }
  }
  const { rowCount } = await db.query(`update person set active = $2 where id = $1`, [personId, active]);
  if (!rowCount) throw new CheckpointError("That person is not on the team.");
}

function checkContributor(input: ContributorInput) {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  const role = (input.role ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new CheckpointError("Enter a name.");
  if (["ai", "system"].includes(name.toLowerCase())) throw new CheckpointError("Contributors must be people.");
  if (!role) throw new CheckpointError("Enter a role, for example Security or Legal.");
  return { name, role, slackUserId: input.slackUserId?.trim() || null };
}

async function checkNameFree(db: Db, name: string, personId: number | null): Promise<void> {
  const { rows } = await db.query(
    `select 1 from person where lower(name) = lower($1) and ($2::bigint is null or id <> $2)`, [name, personId],
  );
  if (rows[0]) throw new CheckpointError(`${name} is already on the team.`);
}

function toPerson(r: Record<string, unknown>): Person {
  return { id: Number(r.id), name: String(r.name), role: String(r.role), linkToken: String(r.link_token) };
}
