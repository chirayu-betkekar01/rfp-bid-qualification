"use client";

import { PRIORITY_LABELS } from "@/components/row-form";
import { PRIORITIES, type Priority } from "@/lib/requirements";

const TONES: Record<Priority, string> = {
  mandatory: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800",
  scored: "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800",
  optional: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
};

const HINT = "Set by the AI from the RFP's wording";

/**
 * A line item's priority as a tag. With onChange it is a dropdown the manager can use to
 * correct the AI; without it, a plain label.
 */
export function PriorityTag({ value, onChange, disabled = false }: {
  value: Priority; onChange?: (p: Priority) => void; disabled?: boolean;
}) {
  const pill = `inline-flex shrink-0 items-center rounded-full text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${TONES[value]}`;
  if (!onChange) {
    return <span className={`${pill} px-2 py-0.5`} title={HINT}>{PRIORITY_LABELS[value]}</span>;
  }
  return (
    <span className={`relative ${pill}`}>
      <select aria-label="Priority" title={`${HINT}. Change it if it's wrong.`} value={value} disabled={disabled}
              onChange={(e) => onChange(e.target.value as Priority)}
              className="cursor-pointer appearance-none rounded-full bg-transparent py-0.5 pr-5 pl-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default">
        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
      </select>
      <svg aria-hidden="true" viewBox="0 0 10 10" className="pointer-events-none absolute top-1/2 right-1.5 size-2.5 -translate-y-1/2">
        <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  );
}
