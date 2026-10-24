"use client";

import { useState, useTransition } from "react";

import { setReviewer } from "@/app/actions";

/** The reviewer's name, saved with every change they make. */
export function ReviewerName({ initial }: { initial: string }) {
  const [editing, setEditing] = useState(!initial);
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-500">Reviewing as</span>
        <span className="font-medium">{initial}</span>
        <button onClick={() => setEditing(true)} className="text-indigo-600 hover:underline dark:text-indigo-400">
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await setReviewer(name);
          if (result.ok) {
            setError(null);
            setEditing(false);
          } else setError(result.error);
        });
      }}
    >
      <label htmlFor="reviewer" className="text-zinc-500">Your name</label>
      <input
        id="reviewer"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Needed to make changes"
        className="w-40 rounded-md sm:w-48 border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1 font-medium text-white disabled:opacity-50">
        Save
      </button>
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </form>
  );
}
