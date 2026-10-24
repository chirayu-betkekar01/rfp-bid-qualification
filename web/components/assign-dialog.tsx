"use client";

import { useEffect, useRef, useState } from "react";

import type { Person } from "@/lib/people";

/** Initials in a circle, so owners are easy to scan down the list. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span aria-hidden="true"
          className={`inline-flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200 ${size === "sm" ? "size-5 text-[10px]" : "size-7 text-xs"}`}>
      {initials}
    </span>
  );
}

/** Who holds something now, as a small chip. */
export function OwnerChip({ person }: { person: Person | null }) {
  if (!person) return <span className="text-xs text-zinc-500">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200">
      <Avatar name={person.name} /> {person.name}
    </span>
  );
}

/**
 * A popup for choosing who gets a line item, a section, or a selection of items.
 * The usual owner for the item's type is listed first.
 */
export function AssignDialog({ open, title, note, people, current, suggested, onAssign, onClose }: {
  open: boolean; title: string; note?: string; people: Person[]; current: number | null;
  suggested?: Person | null; onAssign: (personId: number | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const q = query.trim().toLowerCase();
  const pinned = suggested && !q ? suggested : null;     // shown once, at the top
  const matches = people.filter((p) => p.id !== pinned?.id
    && (!q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)));
  const roles = [...new Set(matches.map((p) => p.role))];
  const pick = (id: number | null) => { onAssign(id); setQuery(""); };

  return (
    <dialog ref={ref} onClose={() => { setQuery(""); onClose(); }}
            onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
            className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or role"
               className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
      </div>
      <div className="max-h-[55vh] overflow-y-auto py-1">
        {pinned && <PersonButton person={pinned} hint="Usual owner" current={current === pinned.id} onPick={pick} />}
        {roles.map((role) => (
          <div key={role}>
            <p className="px-4 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{role}</p>
            {matches.filter((p) => p.role === role).map((p) => (
              <PersonButton key={p.id} person={p} current={current === p.id} onPick={pick} />
            ))}
          </div>
        ))}
        {matches.length === 0 && !pinned && <p className="px-4 py-3 text-sm text-zinc-500">No one matches “{query}”.</p>}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
        {current !== null
          ? <button onClick={() => pick(null)} className="text-sm text-zinc-600 hover:text-red-700 hover:underline dark:text-zinc-300">Remove owner</button>
          : <span />}
        <button onClick={() => ref.current?.close()} className="rounded-md px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
      </div>
    </dialog>
  );
}

function PersonButton({ person, hint, current, onPick }: {
  person: Person; hint?: string; current: boolean; onPick: (id: number) => void;
}) {
  return (
    <button onClick={() => onPick(person.id)} disabled={current}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-indigo-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-indigo-950/40">
      <Avatar name={person.name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{person.name}</span>
        <span className="block text-xs text-zinc-500">{person.role}</span>
      </span>
      {hint && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">{hint}</span>}
      {current && <span className="text-xs text-emerald-700 dark:text-emerald-400">Current owner</span>}
    </button>
  );
}
