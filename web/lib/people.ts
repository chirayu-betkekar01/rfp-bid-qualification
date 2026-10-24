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

function toPerson(r: Record<string, unknown>): Person {
  return { id: Number(r.id), name: String(r.name), role: String(r.role), linkToken: String(r.link_token) };
}
