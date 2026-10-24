"use client";

import { useState } from "react";

import {
  PRIORITIES, ROW_TYPES, type Priority, type RequirementInput, type RowType, type Section,
} from "@/lib/requirements";

export const PRIORITY_LABELS: Record<Priority, string> = {
  mandatory: "Mandatory",
  scored: "Good to Have",       // stored as "scored": earns points with the buyer but isn't pass/fail
  optional: "Optional",
};

export const fieldClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";
export const inputClass = `w-full ${fieldClass}`;

/** Fields shared by add, edit and merge. */
export function RowForm({
  initial, sections, submitLabel, reasonLabel = "Reason (optional)", pending, onSubmit, onCancel,
}: {
  initial: RequirementInput;
  sections: Section[];
  submitLabel: string;
  reasonLabel?: string;
  pending: boolean;
  onSubmit: (input: RequirementInput, reason: string) => void;
  onCancel: () => void;
}) {
  const [section, setSection] = useState(initial.section ?? "");
  const [sectionId, setSectionId] = useState(initial.sectionId ?? sections[0]?.id ?? null);
  const [text, setText] = useState(initial.text);
  const [type, setType] = useState<RowType>(initial.type);
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [page, setPage] = useState(initial.page?.toString() ?? "");
  const [reason, setReason] = useState("");

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ section: section || null, sectionId, text, type, priority, page: page ? Number(page) : null }, reason);
      }}
    >
      <label className="grid gap-1 text-xs font-medium text-zinc-500">
        Requirement
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(8, text.split("\n").length + 2)}
                  className={inputClass} autoFocus required />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="col-span-2 grid gap-1 text-xs font-medium text-zinc-500 sm:col-span-1">
          Section
          <select value={sectionId ?? ""} onChange={(e) => setSectionId(Number(e.target.value))} className={inputClass}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.title}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-500">
          RFP reference
          <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. IV.A" className={inputClass} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-500">
          Page
          <input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" pattern="[0-9]*" className={inputClass} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-500">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as RowType)} className={inputClass}>
            {ROW_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-500">
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs font-medium text-zinc-500">
        {reasonLabel}
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
      </label>
      <div className="flex gap-2">
        <button disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </form>
  );
}
