"use client";

import { useState } from "react";

import { inputClass } from "@/components/row-form";
import { ANSWER_TONES, flagLabel } from "@/lib/flags";
import { ANSWERS, type Answer, type Requirement, type Suggestion } from "@/lib/requirements";

/** The AI's suggestion for an item: shown for checking, never selected for anyone. */
export function SuggestionBox({ suggestion }: { suggestion: Suggestion | null }) {
  if (!suggestion) return null;
  return (
    <div className="mt-1.5 rounded-md border border-dashed border-zinc-300 px-2.5 py-1.5 text-xs dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-zinc-500">AI suggestion</span>
        {suggestion.answer
          ? <span className={`rounded px-1.5 py-0.5 font-semibold ${ANSWER_TONES[suggestion.answer]}`}>{suggestion.answer}</span>
          : <span className="text-zinc-500">none, no library source</span>}
        {suggestion.flags.map((f) => {
          const { text, tone } = flagLabel(f);
          return <span key={f} className={`rounded px-1.5 py-0.5 ${tone}`}>{text}</span>;
        })}
      </div>
      <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{suggestion.reason}</p>
      {suggestion.sources.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400">
            Check the source{suggestion.sources.length > 1 ? "s" : ""}: {suggestion.citedIds.join(", ")}
          </summary>
          <ul className="mt-1 space-y-1.5">
            {suggestion.sources.map((s) => (
              <li key={s.id} className="rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
                <span className="font-mono font-medium">{s.id}</span>
                {s.status === "Stale" && <span className="ml-1 text-amber-700 dark:text-amber-400">(stale)</span>}
                <span className="text-zinc-500"> · {s.question}</span>
                <p className="text-zinc-700 dark:text-zinc-300">{s.answer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function AnswerLine({ response }: { response: NonNullable<Requirement["response"]> }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${ANSWER_TONES[response.answer]}`}>{response.answer}</span>
      <span className="text-xs text-zinc-500">{response.personName}{response.status === "draft" && " · not submitted yet"}</span>
      {response.note && <span className="text-zinc-600 dark:text-zinc-400">{response.note}</span>}
    </div>
  );
}

/** Yes / No / Maybe with a note. Nothing is selected until the person chooses, whatever the AI suggested. */
export function AnswerForm({ initial, suggestion, pending, onSubmit, onCancel, submitLabel = "Save answer" }: {
  initial: Requirement["response"]; suggestion?: Suggestion | null; pending: boolean; submitLabel?: string;
  onSubmit: (answer: Answer, note: string) => void; onCancel?: () => void;
}) {
  const [answer, setAnswer] = useState<Answer | null>(initial?.answer ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const needsNote = answer !== null && answer !== "Yes";
  return (
    <form className="mt-3 grid gap-2 rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30"
          onSubmit={(e) => { e.preventDefault(); if (answer) onSubmit(answer, note); }}>
      {suggestion && <SuggestionBox suggestion={suggestion} />}
      <div role="radiogroup" aria-label="Can we meet this?" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-600 dark:text-zinc-300">Can we meet this?</span>
        {ANSWERS.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={answer === a} onClick={() => setAnswer(a)}
                  className={`rounded-md border px-3 py-1 font-medium ${answer === a
                    ? `${ANSWER_TONES[a]} border-transparent`
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {a}
          </button>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder={needsNote ? `Why ${answer}? (required)` : "Note for the proposal manager (optional)"}
                className={inputClass} required={needsNote} />
      <div className="flex gap-2">
        <button disabled={pending || !answer} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {submitLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="px-2 text-sm">Cancel</button>}
      </div>
    </form>
  );
}
