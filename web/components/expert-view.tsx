"use client";

import { useState, useTransition } from "react";

import { forwardMyItems, saveMyAnswer, submitMyAnswers, type ActionResult } from "@/app/actions";
import { AnswerLine, QuickAnswer, SuggestionBox } from "@/components/answers";
import { Badge, SourcePanel } from "@/components/manager-view";
import { PriorityTag } from "@/components/priority-tag";
import { fieldClass } from "@/components/row-form";
import type { Person } from "@/lib/people";
import type { Requirement, Section } from "@/lib/requirements";

export type ExpertRfp = {
  id: number;
  buyer: string;
  title: string;
  dueAt: Date | null;
  sections: Section[];
  rows: Requirement[];
};

/** One expert's line items, opened from their personal link. */
export function ExpertView({ person, token, rfps, people }: {
  person: Person; token: string; rfps: ExpertRfp[]; people: Person[];
}) {
  const [active, setActive] = useState<{ rfpId: number; row: Requirement } | null>(
    rfps[0]?.rows[0] ? { rfpId: rfps[0].id, row: rfps[0].rows[0] } : null,
  );
  const open = rfps.flatMap((r) => r.rows).filter((r) => r.response?.status !== "submitted").length;

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
      <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase dark:text-indigo-400">Your line items</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{person.name} · {person.role}</h1>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
        For each line item, answer <strong>Can we meet this?</strong> with Yes, No or Maybe. No and Maybe need a short note
        for the proposal manager. If it isn&apos;t yours to answer, forward it to someone who can. The AI suggestion is only
        a starting point: check it against its source.
      </p>

      {rfps.length === 0 || open === 0 && rfps.every((r) => r.rows.every((x) => x.response?.status === "submitted")) ? (
        <p className="mt-6 rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {rfps.length === 0 ? "Nothing is waiting for you." : "You've submitted everything. Thank you."}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 space-y-6">
          {rfps.map((rfp) => (
            <RfpCard key={rfp.id} rfp={rfp} token={token} people={people.filter((p) => p.id !== person.id)}
                     activeId={active?.row.id ?? null} onActivate={(row) => setActive({ rfpId: rfp.id, row })} />
          ))}
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-4 h-[calc(100vh-2rem)]">
            {active && <SourcePanel rfpId={active.rfpId} row={active.row} />}
          </div>
        </aside>
      </div>
    </main>
  );
}

function RfpCard({ rfp, token, people, activeId, onActivate }: {
  rfp: ExpertRfp; token: string; people: Person[]; activeId: number | null; onActivate: (row: Requirement) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [forwardTo, setForwardTo] = useState<number | null>(null);
  const [forwardNote, setForwardNote] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const waiting = rfp.rows.filter((r) => r.response?.status !== "submitted");
  const done = rfp.rows.filter((r) => r.response?.status === "submitted");
  const answered = waiting.filter((r) => r.response).length;
  const live = new Set(waiting.map((r) => r.id));
  const picked = [...selected].filter((id) => live.has(id));
  const sectionOf = new Map(rfp.sections.map((s) => [s.id, s]));

  function act(change: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await change();
      if (result.ok) after?.(); else setError(result.error);
    });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{rfp.title}</h2>
          <p className="text-sm text-zinc-500">
            {rfp.buyer}
            {rfp.dueAt && <> · Answers due {rfp.dueAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</>}
            {" · "}{answered} of {waiting.length} answered
          </p>
        </div>
        {waiting.length > 0 && (
          <button disabled={pending || answered < waiting.length} onClick={() => act(() => submitMyAnswers(token, rfp.id))}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {answered < waiting.length ? `${waiting.length - answered} left to answer` : `Submit ${answered} ${answered === 1 ? "answer" : "answers"}`}
          </button>
        )}
      </header>

      {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

      {picked.length > 0 && (
        <form className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/50"
              onSubmit={(e) => {
                e.preventDefault();
                if (forwardTo !== null) act(() => forwardMyItems(token, picked, forwardTo, forwardNote),
                                            () => { setSelected(new Set()); setForwardNote(""); });
              }}>
          <span>Forward {picked.length} {picked.length === 1 ? "item" : "items"} to</span>
          <select aria-label="Forward to" value={forwardTo ?? ""} onChange={(e) => setForwardTo(Number(e.target.value) || null)}
                  className={fieldClass} required>
            <option value="">Choose a person</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
          </select>
          <input value={forwardNote} onChange={(e) => setForwardNote(e.target.value)} placeholder="Note for them, e.g. why it's theirs"
                 className={`${fieldClass} min-w-48 flex-1`} />
          <button disabled={pending || forwardTo === null} className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            Forward
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="px-2">Cancel</button>
        </form>
      )}

      <ul className="space-y-2 bg-zinc-100/70 p-2 dark:bg-zinc-950/40">
        {waiting.map((row) => {
          const section = row.sectionId ? sectionOf.get(row.sectionId) : undefined;
          const answeredRow = row.response !== null && editing !== row.id;
          return (
            <li key={row.id} className={`rounded-lg border bg-white p-3 shadow-sm dark:bg-zinc-900 ${row.id === activeId ? "border-indigo-400 ring-1 ring-indigo-400 dark:border-indigo-500 dark:ring-indigo-500" : "border-zinc-200 dark:border-zinc-700"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" aria-label={`Select ${row.reqRef} to forward`}
                       checked={selected.has(row.id)}
                       onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(row.id)) n.delete(row.id); else n.add(row.id); return n; })} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                  <PriorityTag value={row.priority} />
                  <button onClick={() => onActivate(row)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-mono text-zinc-500">{row.reqRef}</span>
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">{row.section}</span>
                      {section && <span className="text-zinc-400">{section.title}</span>}
                      <Badge>{row.type}</Badge>
                      {row.page && <span className="text-zinc-400">p. {row.page}</span>}
                    </div>
                    <p className="mt-1 text-sm leading-snug">{row.text}</p>
                  </button>
                  </div>
                  {row.lastForward && (
                    <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
                      Forwarded to you by {row.lastForward.fromName}{row.lastForward.note && <>: “{row.lastForward.note}”</>}
                    </p>
                  )}
                  {answeredRow ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <AnswerLine response={row.response!} />
                      <button onClick={() => setEditing(row.id)} className="mt-1.5 text-xs text-indigo-600 hover:underline dark:text-indigo-400">Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2">
                        <QuickAnswer pending={pending} initialNote={row.response?.note ?? ""}
                                     onCancel={row.response ? () => setEditing(null) : undefined}
                                     onAnswer={(answer, note) => act(
                                       () => saveMyAnswer(token, row.id, answer, note, row.suggestion?.id ?? null),
                                       () => setEditing(null))} />
                      </div>
                      <SuggestionBox suggestion={row.suggestion} />
                    </>
                  )}
                  {row.page && (
                    <a href={`/rfps/${rfp.id}/source#page=${row.page}`} target="_blank" rel="noreferrer"
                       className="mt-1 inline-block text-xs text-zinc-500 hover:underline lg:hidden">Open page {row.page} of the RFP</a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {done.length > 0 && (
        <details className="border-t border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300">Submitted answers ({done.length})</summary>
          <ul className="divide-y divide-zinc-100 px-4 pb-2 dark:divide-zinc-800">
            {done.map((row) => (
              <li key={row.id} className="py-2 text-sm">
                <span className="font-mono text-xs text-zinc-500">{row.reqRef}</span> {row.text}
                <AnswerLine response={row.response!} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
