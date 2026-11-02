import { describe, expect, it } from "vitest";

import { decide, getReport, listFacts, setFact } from "../lib/report";
import { loadVendor } from "../lib/vendor";
import { db, item, person, rfp, section, url, useRolledBackDb } from "./helpers";

const vendor = loadVendor();

async function aiFact(rfpId: number, name: string, value: unknown, quote: string | null = null) {
  await db.query(
    `insert into rfp_fact (rfp_id, name, value, quote, page, source, model, prompt_version)
     values ($1, $2, $3, $4, 3, 'ai', 'test-model', 'rfp_facts_v1')`,
    [rfpId, name, JSON.stringify(value), quote],
  );
}

async function submitted(requirementId: number, personId: number, answer: "Yes" | "No" | "Maybe", note: string | null = null) {
  await db.query(
    `insert into line_response (requirement_id, person_id, answer, note, status, submitted_at)
     values ($1, $2, $3, $4, 'submitted', now())`,
    [requirementId, personId, answer, note],
  );
}

/** An RFP with two items, both answered Yes by one expert. */
async function answeredRfp() {
  const rfpId = await rfp();
  const sectionId = await section(rfpId, "IV");
  const expert = await person("Report Expert", "Solutions Engineering");
  const a = await item(rfpId, sectionId, "R-001", 4, "Track constituent requests.", { type: "Functional", mandatory: true });
  const b = await item(rfpId, sectionId, "R-002", 5, "Provide training.", { type: "Implementation" });
  for (const [name, value] of [["category", "crm"], ["buyer_kind", "commercial"], ["incumbent", "none"]] as const) {
    await aiFact(rfpId, name, value);
  }
  return { rfpId, expert, a, b };
}

describe.skipIf(!url)("go / no-go report", () => {
  useRolledBackDb();

  describe("facts", () => {
    it("a correction needs a reason and keeps what the AI read", async () => {
      const { rfpId } = await answeredRfp();
      await aiFact(rfpId, "budget_per_year_usd", 20000, "not to exceed $20,000");
      await expect(setFact(db, rfpId, "budget_per_year_usd", 60000, "Morgan Lee", " ", vendor)).rejects.toThrow(/reason/);
      await setFact(db, rfpId, "budget_per_year_usd", 60000, "Morgan Lee", "Addendum 2 raised the cap", vendor);
      const budget = (await listFacts(db, rfpId)).budget_per_year_usd!;
      expect([budget.value, budget.source, budget.setBy, budget.aiValue]).toEqual([60000, "person", "Morgan Lee", 20000]);
    });

    it("the relationship question needs no reason, only one of the options", async () => {
      const { rfpId } = await answeredRfp();
      await expect(setFact(db, rfpId, "relationship", "we golfed", "Morgan Lee", "", vendor)).rejects.toThrow(/options/);
      await setFact(db, rfpId, "relationship", "pre_proposal_meeting_only", "Morgan Lee", "", vendor);
      expect((await listFacts(db, rfpId)).relationship?.aiValue).toBeUndefined();
    });

    it("checks numbers and dates", async () => {
      const { rfpId } = await answeredRfp();
      await expect(setFact(db, rfpId, "staff_users", 2.5, "Morgan Lee", "x", vendor)).rejects.toThrow(/whole number/);
      await expect(setFact(db, rfpId, "issued_on", "next week", "Morgan Lee", "x", vendor)).rejects.toThrow(/date/);
      await setFact(db, rfpId, "staff_users", null, "Morgan Lee", "The RFP gives no user count", vendor);
    });
  });

  describe("the decision", () => {
    it("waits for every answer, then for the relationship question", async () => {
      const { rfpId, expert, a, b } = await answeredRfp();
      await submitted(a, expert.id, "Yes");
      await expect(decide(db, rfpId, "bid", "Strong fit", "Morgan Lee", vendor)).rejects.toThrow(/1 of 2 line items/);
      await submitted(b, expert.id, "Yes");
      await expect(decide(db, rfpId, "bid", "Strong fit", "Morgan Lee", vendor)).rejects.toThrow(/relationship/);
    });

    it("is stored once, with the score and inputs it was made on", async () => {
      const { rfpId, expert, a, b } = await answeredRfp();
      await submitted(a, expert.id, "Yes");
      await submitted(b, expert.id, "Yes");
      await setFact(db, rfpId, "relationship", "none", "Morgan Lee", "", vendor);
      await expect(decide(db, rfpId, "bid", "  ", "Morgan Lee", vendor)).rejects.toThrow(/reason/);

      const s = await decide(db, rfpId, "no_bid", "Budget unknown and no relationship", "Morgan Lee", vendor);
      const { rows } = await db.query(`select go_no_go_score, recommendation, decision, decided_by, score_breakdown from rfp where id = $1`, [rfpId]);
      expect([Number(rows[0].go_no_go_score), rows[0].recommendation, rows[0].decision, rows[0].decided_by])
        .toEqual([s.total, s.recommendation, "no_bid", "Morgan Lee"]);
      expect(rows[0].score_breakdown.facts.relationship).toBe("none");
      expect(rows[0].score_breakdown.factors).toHaveLength(6);

      await expect(decide(db, rfpId, "bid", "Changed my mind", "Morgan Lee", vendor)).rejects.toThrow(/already recorded/);
      await expect(setFact(db, rfpId, "incumbent", "salesforce", "Morgan Lee", "Late news", vendor)).rejects.toThrow(/already recorded/);
      expect((await getReport(db, rfpId, vendor))!.rfp.decision?.reason).toBe("Budget unknown and no relationship");
    });

    it("a hard fail can be decided before the answers are in", async () => {
      const { rfpId } = await answeredRfp();
      await aiFact(rfpId, "category", "other");
      await aiFact(rfpId, "product_sought", "course scheduling software");
      const report = (await getReport(db, rfpId, vendor))!;
      expect([report.score.answered, report.score.hardFails.length, report.score.canDecide]).toEqual([0, 1, true]);
      await decide(db, rfpId, "no_bid", "Out of category", "Morgan Lee", vendor);
    });

    it("only submitted answers count; drafts can still change", async () => {
      const { rfpId, expert, a } = await answeredRfp();
      await db.query(`insert into line_response (requirement_id, person_id, answer, note) values ($1, $2, 'No', 'Not yet sure')`,
                     [a, expert.id]);
      expect((await getReport(db, rfpId, vendor))!.score.answered).toBe(0);
    });
  });
});
