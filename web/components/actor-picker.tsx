"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import { setActor } from "@/app/actions";
import type { Person } from "@/lib/people";

/** Who is using the manager screen. Their name is saved with every change they make. */
export function ActorPicker({ people, actorId }: { people: Person[]; actorId: number | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // On a personal link the link itself says who you are.
  if (usePathname().startsWith("/r/")) return null;

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-zinc-500">Acting as</span>
      <select
        value={actorId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const id = Number(e.target.value);
          startTransition(async () => {
            const result = await setActor(id);
            setError(result.ok ? null : result.error);
          });
        }}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
      >
        {actorId === null && <option value="">Choose who you are</option>}
        {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
      </select>
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}
