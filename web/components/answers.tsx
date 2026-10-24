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

const QUICK_TONES: Record<Answer, string> = {
  Yes: "hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300",
  No: "hover:border-red-400 hover:bg-red-50 hover:text-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300",
  Maybe: "hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40 dark:hover:text-amber-300",
};

/**
 * Yes / No / Maybe right on the item. Yes saves at once; No and Maybe ask for a note first.
 * Nothing is selected until the person chooses, whatever the AI suggested.
 */
export function QuickAnswer({ pending, onAnswer, initialNote = "", onCancel }: {
  pending: boolean; onAnswer: (answer: Answer, note: string) => void; initialNote?: string; onCancel?: () => void;
}) {
  const [picked, setPicked] = useState<Answer | null>(null);
  const [note, setNote] = useState(initialNote);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-zinc-500">Can we meet this?</span>
        {ANSWERS.map((a) => (
          <button key={a} type="button" disabled={pending} aria-pressed={picked === a}
                  onClick={() => (a === "Yes" ? onAnswer("Yes", note) : setPicked(a))}
                  className={`rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${picked === a
                    ? `${ANSWER_TONES[a]} border-transparent`
                    : `border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 ${QUICK_TONES[a]}`}`}>
            {a}
          </button>
        ))}
        {onCancel && <button type="button" onClick={onCancel} className="px-1 text-xs text-zinc-500 hover:underline">Cancel</button>}
      </div>
      {picked && picked !== "Yes" && (
        <form className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); onAnswer(picked, note); }}>
          <input autoFocus required value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder={`Why ${picked}? A short note for the proposal manager`}
                 className={`${inputClass} min-w-56 flex-1`} />
          <button disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            Save {picked}
          </button>
          <button type="button" onClick={() => setPicked(null)} className="px-1 text-xs text-zinc-500 hover:underline">Back</button>
        </form>
      )}
    </div>
  );
}
