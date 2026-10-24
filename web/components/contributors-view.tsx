"use client";

import { useState, useTransition } from "react";

import { addTeamMember, setTeamMemberActive, updateTeamMember, type ActionResult } from "@/app/actions";
import { fieldClass } from "@/components/row-form";
import type { Contributor } from "@/lib/people";

/** The team: who can own and answer line items. Shared by every RFP. */
export function ContributorsView({ contributors, roles, canEdit }: {
  contributors: Contributor[]; roles: string[]; canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = contributors.filter((c) => c.active);
  const removed = contributors.filter((c) => !c.active);

  function act(change: () => Promise<ActionResult>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await change();
      if (result.ok) done?.(); else setError(result.error);
    });
  }

  return (
    <main className="w-full max-w-5xl flex-1 space-y-4 px-4 py-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase dark:text-indigo-400">Contributors</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Who can be given line items</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
          The team is shared by every RFP, so changes here update every owner dropdown. The role decides who gets
          &quot;usual owner&quot; items: Security items go to the Security role, Legal items to Legal, and so on.
        </p>
      </div>

      {!canEdit && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose who you are at the top of the page to change the team.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <datalist id="roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>

      {canEdit && <AddForm pending={pending} onAdd={(input, done) => act(() => addTeamMember(input), done)} />}

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 border-b border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-500 sm:grid dark:border-zinc-800">
          <span>Name</span><span>Role</span><span>On this RFP</span><span className="w-40 text-right">Actions</span>
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {active.map((c) => (
            <Row key={c.id} contributor={c} canEdit={canEdit} pending={pending}
                 onSave={(input, done) => act(() => updateTeamMember(c.id, input), done)}
                 onRemove={() => act(() => setTeamMemberActive(c.id, false))} />
          ))}
        </ul>
      </section>

      {removed.length > 0 && (
        <details className="rounded-lg border border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer px-4 py-2 text-zinc-600 dark:text-zinc-300">Removed ({removed.length})</summary>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {removed.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1">{c.name} <span className="text-zinc-500">· {c.role}</span></span>
                {canEdit && (
                  <button disabled={pending} onClick={() => act(() => setTeamMemberActive(c.id, true))}
                          className="text-xs text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400">Bring back</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

type Input = { name: string; role: string };

function AddForm({ pending, onAdd }: { pending: boolean; onAdd: (input: Input, done: () => void) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          onSubmit={(e) => { e.preventDefault(); onAdd({ name, role }, () => { setName(""); setRole(""); }); }}>
      <label className="grid gap-1 text-xs font-medium text-zinc-500">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Alex Morgan"
               className={`${fieldClass} w-56`} />
      </label>
      <label className="grid gap-1 text-xs font-medium text-zinc-500">
        Role
        <input value={role} onChange={(e) => setRole(e.target.value)} required list="roles" placeholder="e.g. Security"
               className={`${fieldClass} w-56`} />
      </label>
      <button disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
        Add contributor
      </button>
    </form>
  );
}

function Row({ contributor: c, canEdit, pending, onSave, onRemove }: {
  contributor: Contributor; canEdit: boolean; pending: boolean;
  onSave: (input: Input, done: () => void) => void; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [role, setRole] = useState(c.role);

  if (editing) {
    return (
      <li className="px-4 py-2">
        <form className="flex flex-wrap items-center gap-2 text-sm"
              onSubmit={(e) => { e.preventDefault(); onSave({ name, role }, () => setEditing(false)); }}>
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} required className={`${fieldClass} w-56`} />
          <input aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} required list="roles" className={`${fieldClass} w-56`} />
          <button disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setEditing(false); setName(c.name); setRole(c.role); }} className="px-2">Cancel</button>
        </form>
      </li>
    );
  }

  return (
    <li className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <span className="font-medium">{c.name}</span>
      <span className="text-zinc-600 dark:text-zinc-300">{c.role}</span>
      <span className="text-zinc-500">
        {c.heldHere === 0 ? "No items" : `${c.heldHere} ${c.heldHere === 1 ? "item" : "items"}, ${c.answeredHere} answered`}
      </span>
      <span className="flex w-40 gap-3 text-xs sm:justify-end">
        <a href={`/r/${c.linkToken}`} target="_blank" rel="noreferrer" className="text-zinc-500 hover:underline">Their link</a>
        {canEdit && (
          <>
            <button onClick={() => setEditing(true)} className="text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">Edit</button>
            <button disabled={pending} onClick={onRemove}
                    title={c.openAnywhere ? "Reassign their unanswered items first" : "Hide from the owner dropdowns"}
                    className="text-zinc-500 hover:text-red-700 hover:underline disabled:opacity-50 dark:hover:text-red-400">Remove</button>
          </>
        )}
      </span>
    </li>
  );
}
