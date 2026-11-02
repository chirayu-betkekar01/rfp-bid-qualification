"use client";

import { useState, useTransition } from "react";

import { checkHardFail, decideGoNoGo, setRfpFact, type ActionResult } from "@/app/actions";
import { inputClass } from "@/components/row-form";
import type { FactEntry, FactName, FactValue } from "@/lib/report";
import type { Decision } from "@/lib/requirements";
import { BUYER_LABELS, CATEGORY_LABELS, INCUMBENT_LABELS, RELATIONSHIP_LABELS } from "@/lib/scoring";

type Facts = Partial<Record<FactName, FactEntry>>;
type Options = { relationship: string[]; incumbent: string[]; category: string[] };

const FIELDS: { name: Exclude<FactName, "relationship">; label: string; kind: "text" | "money" | "count" | "date" | "select" }[] = [
  { name: "product_sought", label: "What they want", kind: "text" },
  { name: "category", label: "Category", kind: "select" },
  { name: "buyer_kind", label: "Buyer", kind: "select" },
  { name: "budget_per_year_usd", label: "Budget per year", kind: "money" },
  { name: "staff_users", label: "Staff users", kind: "count" },
  { name: "incumbent", label: "Current system", kind: "select" },
  { name: "issued_on", label: "RFP issued", kind: "date" },
];

const LABELS: Partial<Record<FactName, Record<string, string>>> = {
  category: CATEGORY_LABELS, buyer_kind: BUYER_LABELS, incumbent: INCUMBENT_LABELS, relationship: RELATIONSHIP_LABELS,
};

export function showFact(name: FactName, value: FactValue | undefined): string {
  if (value === null || value === undefined) return "Not stated in the RFP";
  if (name === "budget_per_year_usd") return `$${Number(value).toLocaleString("en-US")}`;
  if (name === "issued_on") return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
  return LABELS[name]?.[String(value)] ?? String(value);
}

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const act = (change: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await change();
      if (result.ok) after?.(); else setError(result.error);
    });
  };
  return { error, pending, act };
}

/** The one question only the team can answer. */
export function RelationshipQuestion({ rfpId, current, options, canEdit }: {
  rfpId: number; current: string | null; options: string[]; canEdit: boolean;
}) {
  const { error, pending, act } = useAction();
  return (
    <fieldset className={`rounded-lg border px-4 py-3 ${current === null
      ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
      <legend className="sr-only">Relationship with the buyer</legend>
      <p className="text-sm font-semibold">Did we talk to this buyer before the RFP came out?</p>
      <p className="text-xs text-zinc-500">Only you can answer this. It is worth up to 15 points.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" disabled={!canEdit || pending || current === o} aria-pressed={current === o}
                  onClick={() => act(() => setRfpFact(rfpId, "relationship", o, ""))}
                  className={`rounded-md border px-3 py-1.5 text-sm disabled:cursor-default ${current === o
                    ? "border-indigo-600 bg-indigo-600 font-medium text-white"
                    : "border-zinc-300 bg-white hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"}`}>
            {RELATIONSHIP_LABELS[o] ?? o}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </fieldset>
  );
}

/** What the AI read from the RFP, with its quote; the manager corrects anything wrong, with a reason. */
export function FactsPanel({ rfpId, facts, options, canEdit }: {
  rfpId: number; facts: Facts; options: Options; canEdit: boolean;
}) {
  const [editing, setEditing] = useState<FactName | null>(null);
  return (
    <dl className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {FIELDS.map((field) => {
        const fact = facts[field.name];
        return (
          <div key={field.name} className="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-zinc-500">{field.label}</dt>
            <dd className="min-w-0">
              {editing === field.name ? (
                <FactForm rfpId={rfpId} field={field} current={fact?.value ?? null} options={options}
                          onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium">{showFact(field.name, fact?.value)}</span>
                    {canEdit && (
                      <button onClick={() => setEditing(field.name)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                        Change
                      </button>
                    )}
                  </div>
                  <Source rfpId={rfpId} fact={fact} name={field.name} />
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Source({ rfpId, fact, name }: { rfpId: number; fact: FactEntry | undefined; name: FactName }) {
  if (!fact) return <p className="text-xs text-zinc-500">Not read yet. Run python -m src.extract.facts --rfp {rfpId}</p>;
  if (fact.source === "person") {
    return (
      <p className="text-xs text-zinc-500">
        Changed by {fact.setBy}: {fact.reason}
        {fact.aiValue !== undefined && <> · the AI read {showFact(name, fact.aiValue)}</>}
      </p>
    );
  }
  if (!fact.quote) return <p className="text-xs text-zinc-500">The AI found nothing on this in the RFP.</p>;
  return (
    <p className="text-xs text-zinc-500">
      “{fact.quote}”{" "}
      {fact.page && (
        <a href={`/rfps/${rfpId}/source#page=${fact.page}`} target="_blank" rel="noreferrer"
           className="text-indigo-600 hover:underline dark:text-indigo-400">p. {fact.page}</a>
      )}
    </p>
  );
}

function FactForm({ rfpId, field, current, options, onDone }: {
  rfpId: number; field: (typeof FIELDS)[number]; current: FactValue; options: Options; onDone: () => void;
}) {
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [reason, setReason] = useState("");
  const { error, pending, act } = useAction();
  const choices = field.name === "buyer_kind" ? Object.keys(BUYER_LABELS)
    : field.name === "category" ? options.category : field.name === "incumbent" ? options.incumbent : [];
  const toValue = (): FactValue =>
    value.trim() === "" ? null : field.kind === "money" || field.kind === "count" ? Number(value) : value.trim();

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act(() => setRfpFact(rfpId, field.name, toValue(), reason), onDone); }}>
      <div className="flex flex-wrap gap-2">
        {field.kind === "select" ? (
          <select aria-label={field.label} value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} required>
            {choices.map((c) => <option key={c} value={c}>{showFact(field.name, c)}</option>)}
          </select>
        ) : (
          <input aria-label={field.label} autoFocus value={value} onChange={(e) => setValue(e.target.value)}
                 type={field.kind === "date" ? "date" : field.kind === "text" ? "text" : "number"}
                 min={field.kind === "money" || field.kind === "count" ? 1 : undefined}
                 step={field.kind === "count" ? 1 : undefined}
                 placeholder={field.kind === "money" ? "Dollars a year; empty if unknown" : field.kind === "count" ? "Empty if unknown" : undefined}
                 className={`${inputClass} min-w-48`} />
        )}
        <input value={reason} onChange={(e) => setReason(e.target.value)} required
               placeholder="Why? e.g. Addendum 2 changed the budget" className={`${inputClass} min-w-56 flex-1`} />
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Save</button>
        <button type="button" onClick={onDone} className="px-1 text-xs text-zinc-500 hover:underline">Cancel</button>
        {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}

export type PossibleHardFail = { itemId: number; text: string; itemText: string; answeredBy: string | null; note: string | null };

/**
 * Keyword matches on a mandatory No can come from boilerplate, so each one waits for the manager:
 * confirm it (no-bid whatever the points) or dismiss it with a reason.
 */
export function HardFailChecks({ rfpId, possible, canEdit }: { rfpId: number; possible: PossibleHardFail[]; canEdit: boolean }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">Possible hard {possible.length === 1 ? "fail" : "fails"}: check {possible.length === 1 ? "it" : "each one"}</p>
      <p className="text-xs">A mandatory item answered No mentions one of Tallyhouse&apos;s known gaps. If the item really asks for it,
        it&apos;s a hard fail. If the words are only boilerplate, dismiss it and say why.</p>
      <ul className="mt-2 space-y-3">
        {possible.map((p) => <HardFailCheck key={p.itemId} rfpId={rfpId} fail={p} canEdit={canEdit} />)}
      </ul>
    </div>
  );
}

function HardFailCheck({ rfpId, fail, canEdit }: { rfpId: number; fail: PossibleHardFail; canEdit: boolean }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const { error, pending, act } = useAction();
  return (
    <li className="rounded-md bg-white/70 px-3 py-2 dark:bg-zinc-900/60">
      <p className="font-medium">{fail.text}</p>
      <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">“{fail.itemText.length > 220 ? `${fail.itemText.slice(0, 220)}…` : fail.itemText}”</p>
      {fail.answeredBy && <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{fail.answeredBy}: {fail.note}</p>}
      {canEdit && (dismissing ? (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act(() => checkHardFail(rfpId, fail.itemId, false, reason)); }}>
          <input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Why not? e.g. CJIS only applies if we handle criminal justice data, which we won't"
                 className={`${inputClass} min-w-64 flex-1`} />
          <button disabled={pending} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            Dismiss
          </button>
          <button type="button" onClick={() => setDismissing(false)} className="px-1 text-xs text-zinc-500 hover:underline">Back</button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={pending} onClick={() => act(() => checkHardFail(rfpId, fail.itemId, true, ""))}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            Yes, it&apos;s a hard fail
          </button>
          <button disabled={pending} onClick={() => setDismissing(true)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900">
            Not a hard fail
          </button>
        </div>
      ))}
      {error && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
    </li>
  );
}

/** Go or no-go, with a written reason. Recorded once, with the score it was made on. */
export function DecisionForm({ rfpId, recommendation, canDecide, blocked, canEdit }: {
  rfpId: number; recommendation: "bid" | "no_bid"; canDecide: boolean; blocked: string | null; canEdit: boolean;
}) {
  const [choice, setChoice] = useState<"bid" | "no_bid" | null>(null);
  const [reason, setReason] = useState("");
  const { error, pending, act } = useAction();
  const disabled = !canDecide || !canEdit;
  return (
    <form className="space-y-3 px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (choice) act(() => decideGoNoGo(rfpId, choice, reason)); }}>
      {blocked && <p className="text-sm text-zinc-600 dark:text-zinc-300">{blocked}</p>}
      {!canEdit && <p className="text-sm text-zinc-600 dark:text-zinc-300">Choose who you are (top right) to record the decision.</p>}
      <div className="flex flex-wrap gap-2">
        {(["bid", "no_bid"] as const).map((d) => (
          <button key={d} type="button" disabled={disabled} aria-pressed={choice === d} onClick={() => setChoice(d)}
                  className={`rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-40 ${choice === d
                    ? d === "bid" ? "border-emerald-600 bg-emerald-600 text-white" : "border-red-600 bg-red-600 text-white"
                    : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"}`}>
            {d === "bid" ? "Bid" : "No-bid"}
          </button>
        ))}
      </div>
      {choice && choice !== recommendation && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          This goes against the recommendation. That&apos;s your call to make; your reason is kept with the decision.
        </p>
      )}
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled} required rows={3}
                placeholder="Why? For example: budget is a third of list price and we have no relationship with the buyer."
                className={`${inputClass} w-full disabled:opacity-50`} />
      <div className="flex items-center gap-3">
        <button disabled={disabled || pending || !choice || !reason.trim()}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
          Record decision
        </button>
        {error && <span role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}

export function DecisionBanner({ decision }: { decision: Decision }) {
  const bid = decision.decision === "bid";
  return (
    <section className={`rounded-lg border px-4 py-3 ${bid
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"}`}>
      <p className="text-lg font-semibold">{bid ? "Decision: bid" : "Decision: no-bid"}</p>
      <p className="mt-0.5 text-sm">
        By {decision.decidedBy}, {decision.decidedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
        Score at the time {Math.round(decision.score)}; the recommendation was {decision.recommendation === "bid" ? "bid" : "no-bid"}
        {decision.recommendation !== decision.decision && " (overridden)"}.
      </p>
      <p className="mt-1 text-sm">“{decision.reason}”</p>
    </section>
  );
}
