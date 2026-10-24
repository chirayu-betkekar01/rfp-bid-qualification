import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PriorityTag } from "@/components/priority-tag";
import { Progress } from "@/components/progress";
import { pool } from "@/lib/db";
import { listNotifications, listProgress } from "@/lib/experts";
import { ANSWER_TONES, flagLabel, isGap } from "@/lib/flags";
import { getActor } from "@/lib/reviewer";
import {
  ANSWERS, PRIORITIES, getRfp, listRequirements, listSections, type Requirement, type Rfp,
} from "@/lib/requirements";

/** Overview: the RFP's basic details, where it is in the flow, and what the answers say so far. */
export default function OverviewPage({ params }: PageProps<"/rfps/[id]">) {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">Loading overview…</p>}>
      <Overview params={params} />
    </Suspense>
  );
}

const when = (d: Date | null) => d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Not set";
const card = "rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

async function Overview({ params }: Pick<PageProps<"/rfps/[id]">, "params">) {
  const rfpId = Number((await params).id);
  if (!Number.isInteger(rfpId)) notFound();
  const db = pool();
  const [rfp, sections, rows, progress, notifications, actor] = await Promise.all([
    getRfp(db, rfpId), listSections(db, rfpId), listRequirements(db, rfpId), listProgress(db, rfpId),
    listNotifications(db, rfpId), getActor(),
  ]);
  if (!rfp) notFound();

  const unassigned = rows.filter((r) => !r.response && r.assigneeId === null).length;
  const submitted = rows.filter((r) => r.response?.status === "submitted").length;
  const types = countBy(rows.map((r) => r.type));
  const gaps = rows.filter((r) => r.suggestion?.flags.some(isGap));
  const mandatoryNos = rows.filter((r) => r.priority === "mandatory" && r.response?.answer === "No");

  return (
    <main className="w-full flex-1 space-y-4 px-4 py-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase dark:text-indigo-400">Overview</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{rfp.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">{rfp.buyer}</p>
      </div>

      <Steps rfp={rfp} total={rows.length} unassigned={unassigned} submitted={submitted} />

      <div className="grid gap-4 xl:grid-cols-2">
        <section className={card}>
          <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">Details</h2>
          <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <Item label="Buyer">{rfp.buyer}</Item>
            <Item label="RFP">{rfp.title}</Item>
            <Item label="Proposal due">{when(rfp.dueDate)}</Item>
            <Item label="Answers due">{rfp.sentOutAt ? when(rfp.responsesDueAt) : "Set when you send out"}</Item>
            <Item label="Source file">
              <a href={`/rfps/${rfp.id}/source`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {rfp.sourceFile}
              </a>
            </Item>
            <Item label="Shredded by">
              {rfp.extractModel ? `${rfp.extractModel} (${rfp.extractPromptVersion}), ${when(rfp.extractedAt)}` : "Not recorded"}
            </Item>
            <Item label="Sent out">{rfp.sentOutAt ? `${when(rfp.sentOutAt)} by ${rfp.sentOutBy}` : "Not yet"}</Item>
          </dl>
        </section>

        <section className={card}>
          <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">Line items</h2>
          <div className="space-y-3 px-4 py-3 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{rows.length}</span>{" "}
              <span className="text-zinc-500">line items in {sections.length} sections</span>
            </p>
            <div className="flex flex-wrap gap-3">
              {PRIORITIES.map((p) => (
                <span key={p} className="flex items-center gap-1.5">
                  <PriorityTag value={p} />
                  <span className="tabular-nums">{rows.filter((r) => r.priority === p).length}</span>
                </span>
              ))}
            </div>
            <p className="text-zinc-600 dark:text-zinc-300">
              {types.map(([type, n]) => `${type} ${n}`).join(" · ")}
            </p>
            <Link href={`/rfps/${rfp.id}/items`} className="inline-block text-indigo-600 hover:underline dark:text-indigo-400">
              Open line items →
            </Link>
          </div>
        </section>

        <section className={card}>
          <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">
            Answers so far <span className="font-normal text-zinc-500">({submitted} of {rows.length} submitted)</span>
          </h2>
          <div className="space-y-3 px-4 py-3 text-sm">
            <AnswerCounts label="People" rows={rows} pick={(r) => r.response?.answer ?? null} />
            <AnswerCounts label="AI suggestions" rows={rows} pick={(r) => r.suggestion?.answer ?? null}
                          none={rows.filter((r) => r.suggestion && !r.suggestion.answer).length} />
            {mandatoryNos.length > 0 && (
              <div>
                <p className="font-medium text-red-800 dark:text-red-300">Mandatory items answered No</p>
                <ul className="mt-1 space-y-1">
                  {mandatoryNos.map((r) => (
                    <li key={r.id}>
                      <ItemLink rfpId={rfp.id} row={r} /> {r.response?.note && <span className="text-zinc-500">· {r.response.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">
            Known gaps the RFP touches <span className="font-normal text-zinc-500">({gaps.length})</span>
          </h2>
          {gaps.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-500">No line item mentions one of Tallyhouse&apos;s known gaps.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {gaps.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PriorityTag value={r.priority} />
                    {r.suggestion!.flags.filter(isGap).map((f) => {
                      const { text, tone } = flagLabel(f);
                      return <span key={f} className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{text}</span>;
                    })}
                  </div>
                  <ItemLink rfpId={rfp.id} row={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {rfp.sentOutAt && (
        <Progress rfpId={rfp.id} progress={progress} notifications={notifications} canNudge={actor !== null} />
      )}
    </main>
  );
}

const STEPS = ["Shredded", "Owners set", "Sent to experts", "All answered", "Go / no-go"] as const;

function Steps({ rfp, total, unassigned, submitted }: { rfp: Rfp; total: number; unassigned: number; submitted: number }) {
  const done = [true, unassigned === 0 && total > 0, rfp.sentOutAt !== null, total > 0 && submitted === total, false];
  const current = done.indexOf(false);
  const next = [
    "",
    `${unassigned} line ${unassigned === 1 ? "item needs" : "items need"} an owner.`,
    "Every item has an owner. Send the RFP out to the experts.",
    `Waiting for ${total - submitted} of ${total} answers.`,
    "Every item is answered. Scoring and the go/no-go decision come next.",
  ][current];
  const href = current <= 2 ? `/rfps/${rfp.id}/items` : null;
  return (
    <section className={`${card} px-4 py-3`}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${done[i]
              ? "bg-emerald-600 text-white"
              : i === current ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
              {done[i] ? "✓" : i + 1}
            </span>
            <span className={i === current ? "font-semibold" : done[i] ? "" : "text-zinc-500"}>{step}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">—</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        <strong className="text-zinc-900 dark:text-zinc-100">Next:</strong> {next}{" "}
        {href && <Link href={href} className="text-indigo-600 hover:underline dark:text-indigo-400">Go to line items →</Link>}
      </p>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function AnswerCounts({ label, rows, pick, none }: {
  label: string; rows: Requirement[]; pick: (r: Requirement) => string | null; none?: number;
}) {
  const counts = countBy(rows.map(pick).filter((a): a is string => a !== null));
  const of = (a: string) => counts.find(([k]) => k === a)?.[1] ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 text-zinc-500">{label}</span>
      {ANSWERS.map((a) => (
        <span key={a} className={`rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${ANSWER_TONES[a]}`}>{a} {of(a)}</span>
      ))}
      {none !== undefined && <span className="text-xs text-zinc-500">No library source {none}</span>}
    </div>
  );
}

function ItemLink({ rfpId, row }: { rfpId: number; row: Requirement }) {
  return (
    <Link href={`/rfps/${rfpId}/items#item-${row.id}`} className="hover:underline">
      <span className="font-mono text-xs text-zinc-500">{row.reqRef}</span> {row.text.length > 140 ? `${row.text.slice(0, 140)}…` : row.text}
    </Link>
  );
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
