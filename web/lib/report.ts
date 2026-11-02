/**
 * The go / no-go report: the facts read from the RFP, the experts' answers, the score
 * code gives them, and the decision a person records.
 *
 * Facts are kept as a history in rfp_fact: the AI's reading first, then every correction
 * with who made it and why. The latest row for each fact is the one scored.
 * Callers run each mutation in a transaction.
 */
import {
  CheckpointError, checkReviewer, getRfp, listRequirements, type Db, type Requirement, type Rfp,
} from "./requirements";
import { score, type Facts, type GapCheck, type Score, type ScoreItem, type Vendor } from "./scoring";

export const FACT_NAMES = [
  "relationship", "product_sought", "category", "buyer_kind", "budget_per_year_usd", "incumbent", "staff_users", "issued_on",
] as const;
export type FactName = (typeof FACT_NAMES)[number];
export type FactValue = string | number | null;

export type FactEntry = {
  name: FactName;
  value: FactValue;
  quote: string | null;
  page: number | null;
  source: "ai" | "person";
  setBy: string | null;
  reason: string | null;
  createdAt: Date;
  aiValue: FactValue | undefined;   // what the AI read, when a person has since changed it
};

export type Report = {
  rfp: Rfp;
  rows: Requirement[];
  facts: Partial<Record<FactName, FactEntry>>;
  score: Score;
};

const FACT_KEYS: Record<FactName, keyof Facts> = {
  relationship: "relationship", product_sought: "productSought", category: "category", buyer_kind: "buyerKind",
  budget_per_year_usd: "budgetPerYearUsd", incumbent: "incumbent", staff_users: "staffUsers", issued_on: "issuedOn",
};

export async function listFacts(db: Db, rfpId: number): Promise<Partial<Record<FactName, FactEntry>>> {
  const { rows } = await db.query(
    `select distinct on (name) name, value, quote, page, source, set_by, reason, created_at,
            (select f2.value from rfp_fact f2 where f2.rfp_id = f.rfp_id and f2.name = f.name and f2.source = 'ai'
             order by f2.created_at desc, f2.id desc limit 1) as ai_value,
            exists (select 1 from rfp_fact f3 where f3.rfp_id = f.rfp_id and f3.name = f.name and f3.source = 'ai') as has_ai
     from rfp_fact f where rfp_id = $1 order by name, created_at desc, id desc`,
    [rfpId],
  );
  return Object.fromEntries(rows.map((r) => [r.name, {
    name: r.name, value: r.value, quote: r.quote, page: r.page, source: r.source, setBy: r.set_by,
    reason: r.reason, createdAt: r.created_at, aiValue: r.source === "person" && r.has_ai ? r.ai_value : undefined,
  }]));
}

export function factsOf(entries: Partial<Record<FactName, FactEntry>>): Facts {
  const facts = Object.fromEntries(Object.values(FACT_KEYS).map((k) => [k, null])) as Facts;
  for (const name of FACT_NAMES) {
    const value = entries[name]?.value;
    if (value !== undefined && value !== null) (facts as Record<string, unknown>)[FACT_KEYS[name]] = value;
  }
  return facts;
}

/** Only submitted answers count: a draft can still change. */
export function scoreItems(rows: Requirement[]): ScoreItem[] {
  return rows.map((r) => ({
    id: r.id, reqRef: r.reqRef, text: r.text, type: r.type, priority: r.priority,
    answer: r.response?.status === "submitted" ? r.response.answer : null,
  }));
}

export async function getReport(db: Db, rfpId: number, vendor: Vendor): Promise<Report | null> {
  // One after another: db may be a single client inside a transaction.
  const rfp = await getRfp(db, rfpId);
  if (!rfp) return null;
  const rows = await listRequirements(db, rfpId);
  const facts = await listFacts(db, rfpId);
  const gapChecks = await listGapChecks(db, rfpId);
  const result = score({
    items: scoreItems(rows), facts: factsOf(facts), dueDate: rfp.dueDate, receivedAt: rfp.receivedAt, gapChecks,
  }, vendor);
  return { rfp, rows, facts, score: result };
}

/** The latest call on each possible hard fail, by line item id. */
export async function listGapChecks(db: Db, rfpId: number): Promise<Record<number, GapCheck>> {
  const { rows } = await db.query(
    `select distinct on (requirement_id) requirement_id, is_hard_fail, set_by, reason
     from gap_check where rfp_id = $1 order by requirement_id, created_at desc, id desc`,
    [rfpId],
  );
  return Object.fromEntries(rows.map((r) => [Number(r.requirement_id), { isHardFail: r.is_hard_fail, setBy: r.set_by, reason: r.reason }]));
}

/** Confirm a possible hard fail, or dismiss it with a reason. */
export async function setGapCheck(
  db: Db, rfpId: number, requirementId: number, isHardFail: boolean, person: string, reason: string,
): Promise<void> {
  const setBy = checkReviewer(person);
  if (!isHardFail && !reason.trim()) throw new CheckpointError("Say why this is not a hard fail.");
  await lockUndecided(db, rfpId);
  const { rows } = await db.query(`select 1 from requirement where id = $1 and rfp_id = $2`, [requirementId, rfpId]);
  if (!rows[0]) throw new CheckpointError("This line item is not part of this RFP.");
  await db.query(
    `insert into gap_check (rfp_id, requirement_id, is_hard_fail, set_by, reason) values ($1, $2, $3, $4, $5)`,
    [rfpId, requirementId, isHardFail, setBy, reason.trim() || null],
  );
}

/** Check a value a person gives for a fact. Returns it in the stored form. */
export function checkFact(name: FactName, value: FactValue, vendor: Vendor): FactValue {
  const oneOf = (options: string[]) => {
    if (typeof value !== "string" || !options.includes(value)) throw new CheckpointError("Choose one of the options.");
    return value;
  };
  switch (name) {
    case "relationship": return oneOf(Object.keys(vendor.scorecard.relationship.options));
    case "incumbent": return oneOf(Object.keys(vendor.scorecard.competitive_position.incumbents));
    case "category": return oneOf([...vendor.category, "other"]);
    case "buyer_kind": return oneOf(["public_sector", "commercial"]);
    case "product_sought": {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) throw new CheckpointError("Say what the buyer wants to buy.");
      return text.slice(0, 120);
    }
    case "budget_per_year_usd":
    case "staff_users": {
      if (value === null || value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || (name === "staff_users" && !Number.isInteger(n))) {
        throw new CheckpointError(name === "staff_users" ? "Enter a whole number of users." : "Enter an amount in dollars.");
      }
      return n;
    }
    case "issued_on": {
      if (value === null || value === "") return null;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new CheckpointError("Enter a date.");
      }
      return value;
    }
  }
}

/** Correct a fact, or answer the relationship question. Corrections need a reason; nothing changes after the decision. */
export async function setFact(
  db: Db, rfpId: number, name: FactName, value: FactValue, person: string, reason: string, vendor: Vendor,
): Promise<void> {
  const setBy = checkReviewer(person);
  if (!FACT_NAMES.includes(name)) throw new CheckpointError("Unknown fact.");
  const checked = checkFact(name, value, vendor);
  if (name !== "relationship" && !reason.trim()) throw new CheckpointError("Give a reason for the correction.");
  await lockUndecided(db, rfpId);
  await db.query(
    `insert into rfp_fact (rfp_id, name, value, source, set_by, reason) values ($1, $2, $3, 'person', $4, $5)`,
    [rfpId, name, JSON.stringify(checked), setBy, reason.trim() || null],
  );
}

/**
 * Record go or no-go with a written reason. The score is worked out again here, so the
 * decision is stored with exactly the inputs it was made on.
 */
export async function decide(
  db: Db, rfpId: number, decision: "bid" | "no_bid", reason: string, person: string, vendor: Vendor,
): Promise<Score> {
  const name = checkReviewer(person);
  if (decision !== "bid" && decision !== "no_bid") throw new CheckpointError("Choose bid or no-bid.");
  if (!reason.trim()) throw new CheckpointError("Write the reason for the decision.");
  await lockUndecided(db, rfpId);
  const report = await getReport(db, rfpId, vendor);
  if (!report) throw new CheckpointError("This RFP does not exist.");
  const s = report.score;
  if (!s.canDecide) {
    throw new CheckpointError(!s.complete
      ? `Wait for every answer: ${s.items - s.answered} of ${s.items} line items are not submitted yet.`
      : s.missing.includes("relationship") ? "Answer the relationship question first."
      : "Confirm or dismiss each possible hard fail first.");
  }
  const breakdown = { ...s, facts: factsOf(report.facts), scoredAt: new Date().toISOString() };   // includes the hard-fail calls
  await db.query(
    `update rfp set go_no_go_score = $2, score_breakdown = $3, recommendation = $4, decision = $5,
            decided_by = $6, decision_reason = $7, decided_at = now()
     where id = $1`,
    [rfpId, s.total, JSON.stringify(breakdown), s.recommendation, decision, name, reason.trim()],
  );
  return s;
}

async function lockUndecided(db: Db, rfpId: number): Promise<void> {
  const { rows } = await db.query(`select decision from rfp where id = $1 for update`, [rfpId]);
  if (!rows[0]) throw new CheckpointError("This RFP does not exist.");
  if (rows[0].decision) throw new CheckpointError("The go / no-go decision is already recorded.");
}
