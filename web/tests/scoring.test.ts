import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Answer, Priority } from "../lib/requirements";
import { gapsIn, listPriceOf, score, type Facts, type ScoreInput, type ScoreItem } from "../lib/scoring";
import { loadVendor } from "../lib/vendor";

const vendor = loadVendor();

// What rfp_facts_v1 read from the Tulsa RFP (rfp 171).
const TULSA: Facts = {
  productSought: "constituent relationship management (CRM) software", category: "constituent_service_311",
  buyerKind: "public_sector", budgetPerYearUsd: 20000, incumbent: "none", staffUsers: 25, issuedOn: "2025-08-12",
  relationship: "none",
};
const TULSA_DUE = new Date("2025-09-17T17:00:00Z");

let nextId = 1;
function item(answer: Answer | null, { type = "Functional", priority = "optional" as Priority, text = "Do the thing." } = {}): ScoreItem {
  const id = nextId++;
  return { id, reqRef: `R-${id}`, text, type, priority, answer };
}

function input(items: ScoreItem[], facts: Partial<Facts> = {}, dueDate: Date | null = TULSA_DUE): ScoreInput {
  return { items, facts: { ...TULSA, ...facts }, dueDate, receivedAt: new Date("2026-10-24T00:00:00Z") };
}

const factor = (s: ReturnType<typeof score>, key: string) => s.factors.find((f) => f.key === key)!;

/** The answer key, answered the way an expert would: Fully / Via integration / Admin Yes, Partial / Needs decision Maybe. */
function tulsaKey(): ScoreItem[] {
  const csv = readFileSync(path.resolve(process.cwd(), "..", "data", "tulsa_matrix.csv"), "utf8");
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => header.indexOf(name);
  const answers: Record<string, Answer> = {
    "Fully compliant": "Yes", "Via integration": "Yes", Admin: "Yes",
    "Partially compliant": "Maybe", "Needs decision": "Maybe", "Not compliant": "No",
  };
  return rows.filter((r) => r.length > 1).map((r, i) => ({
    id: i + 1, reqRef: r[col("req_id")], text: r[col("requirement")], type: r[col("type")],
    priority: r[col("mandatory")] === "Yes" ? "mandatory" : r[col("mandatory")] === "No (scored)" ? "scored" : "optional",
    answer: answers[r[col("expected_status")]],
  }));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { rows.at(-1)!.push(field); field = ""; }
    else if (c === "\n") { rows.at(-1)!.push(field.replace(/\r$/, "")); field = ""; rows.push([]); }
    else field += c;
  }
  if (field) rows.at(-1)!.push(field);
  return rows;
}

describe("the test documents", () => {
  it("Tulsa, answered as the key expects, scores well under 65: no-bid", () => {
    const items = tulsaKey();
    expect(items).toHaveLength(94);
    const s = score(input(items), vendor);
    expect(Object.fromEntries(s.factors.map((f) => [f.key, f.points]))).toEqual({
      product_fit: 25.9, mandatory: 5, relationship: 0, deal_size: 0, competitive_position: 10, effort_vs_deadline: 10,
    });
    expect(s.total).toBe(50.9);                                     // 1 No (−5), 27 Maybes (capped at −10)
    expect(s.recommendation).toBe("no_bid");
    expect(s.hardFails).toEqual([]);
    expect(factor(s, "deal_size").flags).toEqual(["Budget is 67% below list price"]);
  });

  it("UTEP is out of category: a hard fail before any answer is in", () => {
    const s = score(input([item(null), item(null)], {
      productSought: "course scheduling and room planning software", category: "other",
      budgetPerYearUsd: null, incumbent: "unknown", staffUsers: null, relationship: null,
    }), vendor);
    expect(s.hardFails.map((f) => f.kind)).toEqual(["category"]);
    expect(s.hardFails[0].text).toContain("course scheduling and room planning software");
    expect(s.recommendation).toBe("no_bid");
    expect(s.canDecide).toBe(true);
  });
});

describe("factor rules", () => {
  it("product fit averages Yes 1, Maybe 0.5, No 0 over functional and integration items", () => {
    const s = score(input([item("Yes"), item("Maybe", { type: "Integration" }), item("No"), item("No", { type: "Legal" })]), vendor);
    expect(factor(s, "product_fit").points).toBe(15);              // (1 + 0.5 + 0) / 3 × 30
  });

  it("product fit gives half points and a flag when no product item is answered", () => {
    const f = factor(score(input([item(null), item("Yes", { type: "Legal" })]), vendor), "product_fit");
    expect([f.points, f.flags.length]).toEqual([15, 1]);
  });

  it("mandatory loses 5 per No and 1 per Maybe (at most 10 for Maybes), never below 0", () => {
    const m = (answers: Answer[]) => factor(score(input(answers.map((a) => item(a, { priority: "mandatory" }))), vendor), "mandatory").points;
    expect(m(["Yes", "No", "Maybe", "Maybe"])).toBe(13);
    expect(m(Array<Answer>(30).fill("Maybe"))).toBe(10);
    expect(m(["No", ...Array<Answer>(30).fill("Maybe")])).toBe(5);
    expect(m(["No", "No", "No", "No", "No"])).toBe(0);
    expect(factor(score(input([item("No", { priority: "scored" })]), vendor), "mandatory").points).toBe(20);
  });

  it("relationship comes only from the manager's answer", () => {
    expect(factor(score(input([], { relationship: "spoke_with_buyer_before_rfp" }), vendor), "relationship").points).toBe(15);
    expect(factor(score(input([], { relationship: "pre_proposal_meeting_only" }), vendor), "relationship").points).toBe(8);
    const unanswered = score(input([item("Yes")], { relationship: null }), vendor);
    expect([factor(unanswered, "relationship").points, unanswered.missing, unanswered.canDecide]).toEqual([0, ["relationship"], false]);
  });

  it("deal size compares the budget with the list price for the buyer's users", () => {
    const d = (budget: number | null, users: number | null = 25) =>
      factor(score(input([], { budgetPerYearUsd: budget, staffUsers: users }), vendor), "deal_size");
    expect(listPriceOf(TULSA, vendor)?.price).toBe(60000);           // $30,000 platform + 25 × $1,200
    expect(d(60000).points).toBe(15);
    expect(d(45000).points).toBe(8);                                 // 25% below
    expect(d(44999).points).toBe(0);
    expect([d(null).points, d(null).flags]).toEqual([8, ["Budget unknown"]]);
    expect(d(20000, null).points).toBe(8);
  });

  it("commercial buyers are priced on Professional up to 250 users, Enterprise above", () => {
    expect(listPriceOf({ ...TULSA, buyerKind: "commercial", staffUsers: 100 }, vendor)?.price).toBe(108000);
    expect(listPriceOf({ ...TULSA, buyerKind: "commercial", staffUsers: 300 }, vendor)?.price).toBe(540000);
  });

  it("competitive position follows the incumbent", () => {
    const c = (incumbent: string | null) => factor(score(input([], { incumbent }), vendor), "competitive_position").points;
    expect([c("none"), c("legacy"), c("hubspot"), c("salesforce"), c("other"), c("unknown"), c(null)]).toEqual([10, 10, 6, 3, 5, 5, 5]);
  });

  it("effort counts days from issue to due date and the number of line items", () => {
    const e = (issuedOn: string | null, n: number) =>
      factor(score(input(Array.from({ length: n }, () => item("Yes")), { issuedOn }), vendor), "effort_vs_deadline").points;
    expect(e("2025-08-12", 149)).toBe(10);                          // 36 days
    expect(e("2025-08-12", 150)).toBe(5);
    expect(e("2025-09-08", 20)).toBe(5);                            // 9 days
    expect(e("2025-09-12", 20)).toBe(0);                            // 5 days
    expect(e("2025-08-12", 301)).toBe(0);
    const noDue = score(input([item("Yes")], {}, null), vendor);
    expect([factor(noDue, "effort_vs_deadline").points, factor(noDue, "effort_vs_deadline").flags]).toEqual([5, ["Due date unknown"]]);
  });
});

describe("hard fails and the recommendation", () => {
  it("a mandatory No on a known gap is a possible hard fail; a Maybe or an optional No is not", () => {
    const fedramp = item("No", { priority: "mandatory", text: "The vendor must hold a FedRAMP Moderate authorization." });
    const s = score(input([
      fedramp,
      item("Maybe", { priority: "mandatory", text: "Sign a HIPAA business associate agreement." }),
      item("No", { priority: "optional", text: "CJIS compliance is preferred." }),
    ]), vendor);
    expect([s.hardFails.length, s.possibleHardFails.length]).toEqual([0, 1]);
    expect(s.possibleHardFails[0]).toMatchObject({ itemId: fedramp.id });
    expect(s.possibleHardFails[0].text).toMatch(/is mandatory, was answered No, and mentions FedRAMP, a known gap/);
  });

  it("a possible hard fail blocks the decision until the manager confirms or dismisses it", () => {
    const cjis = item("No", { priority: "mandatory", text: "Comply with all applicable laws, including CJIS." });
    const items = [cjis, item("Yes")];
    const pending = score(input(items), vendor);
    expect([pending.missing, pending.canDecide]).toEqual([["hard_fail_checks"], false]);

    const yes = score({ ...input(items), gapChecks: { [cjis.id]: { isHardFail: true, setBy: "Morgan Lee", reason: null } } }, vendor);
    expect([yes.hardFails.length, yes.recommendation, yes.canDecide]).toEqual([1, "no_bid", true]);

    const no = score({ ...input(items), gapChecks: { [cjis.id]: { isHardFail: false, setBy: "Morgan Lee", reason: "Boilerplate" } } }, vendor);
    expect([no.hardFails.length, no.dismissedHardFails.length, no.missing, no.canDecide]).toEqual([0, 1, [], true]);
  });

  it("gap phrases match whole words only", () => {
    expect(gapsIn("Must be hosted on-premises.", vendor)).toEqual(["on_premises_or_private_cloud"]);
    expect(gapsIn("Babaa encryption", vendor)).toEqual([]);
  });

  it("recommends a bid at 65 or above, and waits for every answer before a decision", () => {
    const strong = { relationship: "spoke_with_buyer_before_rfp", budgetPerYearUsd: 90000 };
    const all = score(input([item("Yes", { priority: "mandatory" }), item("Yes")], strong), vendor);
    expect([all.total, all.recommendation, all.complete, all.canDecide]).toEqual([100, "bid", true, true]);
    const waiting = score(input([item("Yes"), item(null)], strong), vendor);
    expect([waiting.answered, waiting.complete, waiting.canDecide]).toEqual([1, false, false]);
  });

  it("the same inputs always give the same score", () => {
    const items = tulsaKey();
    expect(score(input(items), vendor)).toEqual(score(input(items), vendor));
  });
});
