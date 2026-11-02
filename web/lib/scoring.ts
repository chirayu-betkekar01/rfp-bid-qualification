/**
 * Go / no-go scoring. The AI reads facts from the RFP and people answer the line items;
 * this code turns both into points with the fixed rules in config/vendor.yaml, and a
 * person makes the decision. The same inputs always give the same score.
 *
 * Pure: no database, no file reads, so the client can import the labels and tests can
 * score the Tulsa answer key directly.
 */
import { GAP_NAMES } from "./flags";
import type { Answer, Priority } from "./requirements";

export type Vendor = {
  category: string[];
  pricing: {
    professional_per_user_month: number;
    professional_max_users: number;
    enterprise_per_user_month: number;
    public_sector_platform_fee_year: number;
    public_sector_per_staff_user_year: number;
  };
  hard_fail_gaps: Record<string, string[]>;
  scorecard: {
    bid_threshold: number;
    product_fit: { points: number; row_types: string[]; answer_values: Record<Answer, number>; no_answers_points: number };
    mandatory: { points: number; penalty_per_no: number; penalty_per_maybe: number; floor: number };
    relationship: { points: number; options: Record<string, number> };
    deal_size: {
      points: number; at_or_above_list: number; within_pct_below: number; within_pct_below_points: number;
      further_below_points: number; unknown_budget_points: number;
    };
    competitive_position: { points: number; incumbents: Record<string, number> };
    effort_vs_deadline: {
      points: number;
      full: { min_days: number; max_requirements: number; points: number };
      partial: { min_days: number; max_requirements: number; points: number };
      otherwise_points: number;
      unknown_due_points: number;
    };
  };
};

export type ScoreItem = {
  id: number;
  reqRef: string;
  text: string;
  type: string;
  priority: Priority;
  answer: Answer | null;           // submitted answers only; null until then
};

export type Facts = {
  productSought: string | null;
  category: string | null;
  buyerKind: string | null;        // public_sector | commercial
  budgetPerYearUsd: number | null;
  incumbent: string | null;
  staffUsers: number | null;
  issuedOn: string | null;         // YYYY-MM-DD
  relationship: string | null;     // answered by the proposal manager
};

export type ScoreInput = { items: ScoreItem[]; facts: Facts; dueDate: Date | null; receivedAt: Date };

export type FactorKey = "product_fit" | "mandatory" | "relationship" | "deal_size" | "competitive_position" | "effort_vs_deadline";

export type Factor = {
  key: FactorKey;
  label: string;
  points: number;
  max: number;
  basis: string;                   // the inputs, in plain words
  flags: string[];                 // something the manager should check
};

export type HardFail = { kind: "category" | "gap"; text: string; itemId?: number };

export type Score = {
  total: number;
  threshold: number;
  recommendation: "bid" | "no_bid";
  hardFails: HardFail[];
  factors: Factor[];
  items: number;
  answered: number;
  complete: boolean;               // every line item has a submitted answer
  missing: string[];               // inputs only a person can give
  canDecide: boolean;
  listPrice: number | null;
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  product_fit: "Product fit",
  mandatory: "Mandatory requirements",
  relationship: "Relationship",
  deal_size: "Deal size vs. budget",
  competitive_position: "Competitive position",
  effort_vs_deadline: "Effort vs. deadline",
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  spoke_with_buyer_before_rfp: "We spoke with the buyer before the RFP came out",
  pre_proposal_meeting_only: "Only the pre-proposal meeting",
  none: "No contact",
};

export const INCUMBENT_LABELS: Record<string, string> = {
  none: "No current system",
  legacy: "An old or home-grown system",
  hubspot: "HubSpot",
  zendesk: "Zendesk",
  salesforce: "Salesforce",
  microsoft_dynamics: "Microsoft Dynamics",
  other: "Another product",
  unknown: "Not stated",
};

export const CATEGORY_LABELS: Record<string, string> = {
  crm: "CRM",
  customer_service: "Customer service",
  constituent_service_311: "Constituent service / 311",
  other: "Something else",
};

export const BUYER_LABELS: Record<string, string> = { public_sector: "Public sector", commercial: "Commercial" };

const round1 = (n: number) => Math.round(n * 10) / 10;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function score(input: ScoreInput, vendor: Vendor): Score {
  const card = vendor.scorecard;
  const listPrice = listPriceOf(input.facts, vendor);
  const factors = [
    productFit(input.items, card.product_fit),
    mandatory(input.items, card.mandatory),
    relationship(input.facts.relationship, card.relationship),
    dealSize(input.facts.budgetPerYearUsd, listPrice, card.deal_size),
    competitive(input.facts.incumbent, card.competitive_position),
    effort(input, card.effort_vs_deadline),
  ];
  const total = round1(factors.reduce((sum, f) => sum + f.points, 0));
  const hardFails = findHardFails(input, vendor);
  const answered = input.items.filter((i) => i.answer !== null).length;
  const complete = input.items.length > 0 && answered === input.items.length;
  const missing = input.facts.relationship === null ? ["relationship"] : [];
  return {
    total,
    threshold: card.bid_threshold,
    recommendation: hardFails.length === 0 && total >= card.bid_threshold ? "bid" : "no_bid",
    hardFails,
    factors,
    items: input.items.length,
    answered,
    complete,
    missing,
    // Wait for every answer, unless a hard fail already settles the recommendation.
    canDecide: hardFails.length > 0 || (complete && missing.length === 0),
    listPrice: listPrice?.price ?? null,
  };
}

function productFit(items: ScoreItem[], rule: Vendor["scorecard"]["product_fit"]): Factor {
  const product = items.filter((i) => rule.row_types.includes(i.type));
  const answered = product.filter((i) => i.answer !== null);
  const base = { key: "product_fit" as const, label: FACTOR_LABELS.product_fit, max: rule.points };
  if (answered.length === 0) {
    return {
      ...base, points: rule.no_answers_points,
      basis: product.length === 0 ? "No functional or integration items in the RFP" : `None of ${product.length} product items answered yet`,
      flags: [product.length === 0 ? "No product items to judge fit on: half points" : "No product answers yet: half points"],
    };
  }
  const mean = answered.reduce((sum, i) => sum + rule.answer_values[i.answer!], 0) / answered.length;
  return {
    ...base, points: round1(mean * rule.points),
    basis: `${plural(answered.length, "product item")} (${rule.row_types.join(", ").toLowerCase()}): ${counts(answered)}`,
    flags: [],
  };
}

function mandatory(items: ScoreItem[], rule: Vendor["scorecard"]["mandatory"]): Factor {
  const required = items.filter((i) => i.priority === "mandatory");
  const nos = required.filter((i) => i.answer === "No").length;
  const maybes = required.filter((i) => i.answer === "Maybe").length;
  const points = Math.max(rule.floor, rule.points - rule.penalty_per_no * nos - rule.penalty_per_maybe * maybes);
  return {
    key: "mandatory", label: FACTOR_LABELS.mandatory, max: rule.points, points,
    basis: `${plural(required.length, "mandatory item")}: ${plural(nos, "No", "Nos")} (−${rule.penalty_per_no} each), `
      + `${plural(maybes, "Maybe", "Maybes")} (−${rule.penalty_per_maybe} each)`,
    flags: nos > 0 ? [`${plural(nos, "mandatory item")} answered No`] : [],
  };
}

function relationship(value: string | null, rule: Vendor["scorecard"]["relationship"]): Factor {
  const base = { key: "relationship" as const, label: FACTOR_LABELS.relationship, max: rule.points };
  if (value === null) return { ...base, points: 0, basis: "Not answered yet", flags: ["Answer the relationship question"] };
  return { ...base, points: rule.options[value] ?? 0, basis: RELATIONSHIP_LABELS[value] ?? value, flags: [] };
}

/** Annual list price for the buyer's staff users, or null when the user count is unknown. */
export function listPriceOf(facts: Facts, vendor: Vendor): { price: number; basis: string } | null {
  const users = facts.staffUsers;
  if (!users) return null;
  const p = vendor.pricing;
  if (facts.buyerKind === "public_sector") {
    return {
      price: p.public_sector_platform_fee_year + users * p.public_sector_per_staff_user_year,
      basis: `Public Sector Edition: ${usd(p.public_sector_platform_fee_year)} platform fee + ${users} × ${usd(p.public_sector_per_staff_user_year)}`,
    };
  }
  const professional = users <= p.professional_max_users;
  const perMonth = professional ? p.professional_per_user_month : p.enterprise_per_user_month;
  return { price: users * perMonth * 12, basis: `${professional ? "Professional" : "Enterprise"}: ${users} × ${usd(perMonth)} × 12` };
}

function dealSize(budget: number | null, list: { price: number; basis: string } | null,
                  rule: Vendor["scorecard"]["deal_size"]): Factor {
  const base = { key: "deal_size" as const, label: FACTOR_LABELS.deal_size, max: rule.points };
  if (budget === null) {
    return { ...base, points: rule.unknown_budget_points, basis: "The RFP states no budget", flags: ["Budget unknown"] };
  }
  if (list === null) {
    return { ...base, points: rule.unknown_budget_points, basis: `Budget ${usd(budget)} a year; number of users unknown`,
             flags: ["No list price without a user count"] };
  }
  const below = 1 - budget / list.price;
  const basis = `Budget ${usd(budget)} a year vs. list ${usd(list.price)} (${list.basis})`;
  if (below <= 0) return { ...base, points: rule.at_or_above_list, basis, flags: [] };
  if (below <= rule.within_pct_below) return { ...base, points: rule.within_pct_below_points, basis, flags: [] };
  return { ...base, points: rule.further_below_points, basis,
           flags: [`Budget is ${Math.round(below * 100)}% below list price`] };
}

function competitive(incumbent: string | null, rule: Vendor["scorecard"]["competitive_position"]): Factor {
  const key = incumbent ?? "unknown";
  return {
    key: "competitive_position", label: FACTOR_LABELS.competitive_position, max: rule.points,
    points: rule.incumbents[key] ?? rule.incumbents.unknown,
    basis: `Current system: ${INCUMBENT_LABELS[key] ?? key}`,
    flags: key === "unknown" ? ["Current system not stated"] : [],
  };
}

function effort(input: ScoreInput, rule: Vendor["scorecard"]["effort_vs_deadline"]): Factor {
  const base = { key: "effort_vs_deadline" as const, label: FACTOR_LABELS.effort_vs_deadline, max: rule.points };
  const count = input.items.length;
  if (!input.dueDate) {
    return { ...base, points: rule.unknown_due_points, basis: `${plural(count, "line item")}; no due date`, flags: ["Due date unknown"] };
  }
  // Days from issue (or from when we received it) to the due date.
  const start = input.facts.issuedOn ? new Date(`${input.facts.issuedOn}T00:00:00Z`) : input.receivedAt;
  const days = Math.floor((input.dueDate.getTime() - start.getTime()) / 86_400_000);
  const from = input.facts.issuedOn ? "issue" : "receipt";
  const basis = `${plural(days, "day")} from ${from} to due date, ${plural(count, "line item")}`;
  if (days >= rule.full.min_days && count <= rule.full.max_requirements) return { ...base, points: rule.full.points, basis, flags: [] };
  if (days >= rule.partial.min_days && count <= rule.partial.max_requirements) return { ...base, points: rule.partial.points, basis, flags: [] };
  return { ...base, points: rule.otherwise_points, basis, flags: days < rule.partial.min_days ? ["Very little time to respond"] : [] };
}

/** Pass 1: an RFP outside the vendor's categories, or a mandatory item answered No that needs a known hard-fail gap. */
function findHardFails(input: ScoreInput, vendor: Vendor): HardFail[] {
  const fails: HardFail[] = [];
  const { category, productSought } = input.facts;
  if (category !== null && !vendor.category.includes(category)) {
    const sells = vendor.category.map((c) => CATEGORY_LABELS[c] ?? c).join(", ");
    fails.push({ kind: "category", text: `Out of category: the buyer wants ${productSought ?? "something else"}; Tallyhouse sells ${sells}.` });
  }
  for (const item of input.items) {
    if (item.priority !== "mandatory" || item.answer !== "No") continue;
    const gaps = gapsIn(item.text, vendor).map((g) => GAP_NAMES[g] ?? g.replaceAll("_", " "));
    if (gaps.length > 0) {
      fails.push({ kind: "gap", itemId: item.id,
                   text: `${item.reqRef} is mandatory, was answered No, and asks for ${gaps.join(" and ")}, a known gap.` });
    }
  }
  return fails;
}

/** Hard-fail gaps whose phrases appear in the text, as whole words (same rule as the Python suggestions). */
export function gapsIn(text: string, vendor: Vendor): string[] {
  return Object.entries(vendor.hard_fail_gaps)
    .filter(([, phrases]) => phrases.some((p) => new RegExp(`(?<!\\w)${escape(p)}(?!\\w)`, "i").test(text)))
    .map(([name]) => name);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function counts(items: ScoreItem[]): string {
  const of = (a: Answer) => items.filter((i) => i.answer === a).length;
  return `${of("Yes")} Yes, ${of("Maybe")} Maybe, ${of("No")} No`;
}
