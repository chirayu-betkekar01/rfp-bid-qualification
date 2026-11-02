import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PriorityTag } from "@/components/priority-tag";
import { DecisionBanner, DecisionForm, FactsPanel, RelationshipQuestion } from "@/components/report";
import { pool } from "@/lib/db";
import { ANSWER_TONES } from "@/lib/flags";
import { getReport } from "@/lib/report";
import { ANSWERS, type Requirement } from "@/lib/requirements";
import { getActor } from "@/lib/reviewer";
import type { Factor, Score } from "@/lib/scoring";
import { loadVendor } from "@/lib/vendor";

/** Go / no-go: the score code gives the answers and the RFP's facts, and the decision a person records. */
export default function ReportPage({ params }: PageProps<"/rfps/[id]/report">) {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">Working out the score…</p>}>
      <Report params={params} />
    </Suspense>
  );
}

const card = "rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
const heading = "border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800";

async function Report({ params }: Pick<PageProps<"/rfps/[id]/report">, "params">) {
  const rfpId = Number((await params).id);
  if (!Number.isInteger(rfpId)) notFound();
  const vendor = loadVendor();
  const [report, actor] = await Promise.all([getReport(pool(), rfpId, vendor), getActor()]);
  if (!report) notFound();
  const { rfp, rows, facts, score: s } = report;
  const canEdit = actor !== null && rfp.decision === null;
  const answered = rows.filter((r) => r.response?.status === "submitted");
  const nos = answered.filter((r) => r.response!.answer === "No");
  const maybes = answered.filter((r) => r.response!.answer === "Maybe");
  const byPriority = (a: Requirement, b: Requirement) => Number(b.priority === "mandatory") - Number(a.priority === "mandatory");

  return (
    <main className="w-full flex-1 space-y-4 px-4 py-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase dark:text-indigo-400">Go / no-go</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{rfp.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
          Code scores the experts&apos; answers and the facts read from the RFP, with fixed rules. The recommendation is only
          a starting point: you decide, and write down why.
        </p>
      </div>

      {rfp.decision && <DecisionBanner decision={rfp.decision} />}
      {!rfp.decision && (
        <RelationshipQuestion rfpId={rfp.id} current={facts.relationship?.value as string | null ?? null}
                              options={Object.keys(vendor.scorecard.relationship.options)} canEdit={canEdit} />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className={card}>
          <h2 className={heading}>Score</h2>
          <ScoreSummary s={s} />
          <FactorTable factors={s.factors} />
        </section>

        <section className={card}>
          <h2 className={heading}>
            What the RFP says <span className="font-normal text-zinc-500">· read by the AI, check and correct</span>
          </h2>
          <FactsPanel rfpId={rfp.id} facts={facts} canEdit={canEdit} options={{
            relationship: Object.keys(vendor.scorecard.relationship.options),
            incumbent: Object.keys(vendor.scorecard.competitive_position.incumbents),
            category: [...vendor.category, "other"],
          }} />
          {s.listPrice !== null && (
            <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
              List price for these users: ${s.listPrice.toLocaleString("en-US")} a year (from config/vendor.yaml).
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AnswerList rfpId={rfp.id} title="Answered No" rows={nos.sort(byPriority)} empty="No line item was answered No." />
        <AnswerList rfpId={rfp.id} title="Answered Maybe" rows={maybes.sort(byPriority)} empty="No line item was answered Maybe." />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WhoAnswered rows={answered} />
        <AiAgreement rows={answered} />
      </div>

      {!rfp.decision && (
        <section className={card}>
          <h2 className={heading}>Your decision</h2>
          <DecisionForm rfpId={rfp.id} recommendation={s.recommendation} canDecide={s.canDecide} canEdit={actor !== null}
                        blocked={s.canDecide ? null : s.complete
                          ? "Answer the relationship question above before deciding."
                          : `Waiting for ${s.items - s.answered} of ${s.items} answers. You can decide once every line item is submitted.`} />
        </section>
      )}
    </main>
  );
}

function ScoreSummary({ s }: { s: Score }) {
  const bid = s.recommendation === "bid";
  return (
    <div className="space-y-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p>
          <span className="text-4xl font-semibold tabular-nums">{Math.round(s.total)}</span>
          <span className="text-zinc-500"> / 100</span>
        </p>
        <p className={`rounded-md px-3 py-1 text-sm font-semibold ${bid
          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200"
          : "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-200"}`}>
          Recommend {bid ? "bid" : "no-bid"}
        </p>
        <p className="text-sm text-zinc-500">
          {s.hardFails.length > 0 ? "Hard fail" : `Bid at ${s.threshold} or above`}
        </p>
      </div>
      <div className="relative h-2 rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
        <div className={`h-2 rounded-full ${bid ? "bg-emerald-500" : "bg-red-400"}`} style={{ width: `${Math.min(100, s.total)}%` }} />
        <div className="absolute -top-1 h-4 w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${s.threshold}%` }} />
      </div>
      {!s.complete && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Provisional: {s.answered} of {s.items} line items have a submitted answer. Unanswered items don&apos;t count yet.
        </p>
      )}
      {s.hardFails.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Hard fail: no-bid whatever the points</p>
          <ul className="mt-1 list-disc pl-5">{s.hardFails.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function FactorTable({ factors }: { factors: Factor[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sr-only"><tr><th>Factor</th><th>Based on</th><th>Points</th></tr></thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {factors.map((f) => (
          <tr key={f.key} className="align-top">
            <td className="px-4 py-2.5">
              <p className="font-medium">{f.label}</p>
              <p className="text-xs text-zinc-500">{f.basis}</p>
              {f.flags.map((flag) => (
                <span key={flag} className="mt-1 mr-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                  {flag}
                </span>
              ))}
            </td>
            <td className="w-32 px-4 py-2.5 text-right">
              <p className="tabular-nums"><span className="font-semibold">{f.points}</span><span className="text-zinc-500"> / {f.max}</span></p>
              <div className="mt-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(f.points / f.max) * 100}%` }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AnswerList({ rfpId, title, rows, empty }: { rfpId: number; title: string; rows: Requirement[]; empty: string }) {
  return (
    <section className={card}>
      <h2 className={heading}>{title} <span className="font-normal text-zinc-500">({rows.length})</span></h2>
      {rows.length === 0 ? <p className="px-4 py-3 text-sm text-zinc-500">{empty}</p> : (
        <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1 px-4 py-2">
              <div className="flex items-start gap-2">
                <PriorityTag value={r.priority} />
                <Link href={`/rfps/${rfpId}/items#item-${r.id}`} className="min-w-0 hover:underline">
                  <span className="font-mono text-xs text-zinc-500">{r.reqRef}</span> {r.text.length > 160 ? `${r.text.slice(0, 160)}…` : r.text}
                </Link>
              </div>
              <p className="text-zinc-600 dark:text-zinc-300">
                <span className="font-medium">{r.response!.personName}:</span> {r.response!.note}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WhoAnswered({ rows }: { rows: Requirement[] }) {
  const people = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const counts = people.get(r.response!.personName) ?? { Yes: 0, No: 0, Maybe: 0 };
    counts[r.response!.answer]++;
    people.set(r.response!.personName, counts);
  }
  return (
    <section className={card}>
      <h2 className={heading}>Who answered</h2>
      {people.size === 0 ? <p className="px-4 py-3 text-sm text-zinc-500">No answers submitted yet.</p> : (
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {[...people].sort((a, b) => a[0].localeCompare(b[0])).map(([name, counts]) => (
            <li key={name} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="min-w-36 font-medium">{name}</span>
              {ANSWERS.map((a) => (
                <span key={a} className={`rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${ANSWER_TONES[a]}`}>{a} {counts[a]}</span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** How often people picked what the AI suggested: a high rate on hard items is worth a second look. */
function AiAgreement({ rows }: { rows: Requirement[] }) {
  const compared = rows.filter((r) => r.suggestion?.answer);
  const same = compared.filter((r) => r.suggestion!.answer === r.response!.answer);
  const pct = compared.length ? Math.round((same.length / compared.length) * 100) : 0;
  const differ = (a: string) => compared.filter((r) => r.suggestion!.answer === a && r.response!.answer !== a).length;
  return (
    <section className={card}>
      <h2 className={heading}>Answers vs. the AI suggestion</h2>
      <div className="space-y-1 px-4 py-3 text-sm">
        {compared.length === 0 ? <p className="text-zinc-500">No answered item had an AI suggestion yet.</p> : (
          <>
            <p><span className="text-2xl font-semibold tabular-nums">{pct}%</span> <span className="text-zinc-500">
              agreed ({same.length} of {compared.length} answered items with a suggestion)</span></p>
            <p className="text-zinc-600 dark:text-zinc-300">
              People changed {differ("Yes")} suggested Yes, {differ("Maybe")} suggested Maybe and {differ("No")} suggested No.
            </p>
          </>
        )}
        <p className="text-xs text-zinc-500">
          {rows.length - compared.length} answered items had no AI suggestion (nothing in the library covered them).
        </p>
      </div>
    </section>
  );
}
