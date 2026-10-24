import type { Change } from "@/lib/requirements";

type Snapshot = { req_ref: string; rfp_section: string | null; text: string; type: string;
                  priority: string; page: number | null };

const FIELDS: [keyof Snapshot, string][] = [
  ["rfp_section", "section"], ["page", "page"], ["type", "type"], ["priority", "priority"],
];

/** Every change to the list, newest first, so the confirmed list can be traced back to the extraction. */
export function ChangeLog({ changes }: { changes: Change[] }) {
  return (
    <details className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Change history <span className="text-zinc-500">({changes.length})</span>
      </summary>
      {changes.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-zinc-500">No changes yet. The list is exactly what the AI extracted.</p>
      ) : (
        <ol className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
          {changes.map((c) => (
            <li key={c.id} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{describe(c)}</span>
                <span className="text-xs text-zinc-500">
                  {c.reviewer} · {c.changedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
              {c.reason && <div className="text-zinc-600 italic dark:text-zinc-400">“{c.reason}”</div>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function describe(c: Change): string {
  const before = c.before as Snapshot | Snapshot[] | null;
  const after = c.after as Snapshot | null;
  switch (c.action) {
    case "add":
      return `Added ${after?.req_ref}`;
    case "delete":
      return `Deleted ${(before as Snapshot).req_ref}`;
    case "merge":
      return `Merged ${(before as Snapshot[]).map((r) => r.req_ref).join(", ")} into ${after?.req_ref}`;
    case "edit": {
      const old = before as Snapshot;
      const parts = FIELDS.filter(([key]) => old[key] !== after?.[key])
        .map(([key, label]) => `${label} ${old[key] ?? "none"} → ${after?.[key] ?? "none"}`);
      if (old.text !== after?.text) parts.push("text changed");
      return `Edited ${old.req_ref}: ${parts.join("; ")}`;
    }
    case "confirm":
      return `Confirmed the list (${(c.after as { rows: number }).rows} rows)`;
    case "reopen":
      return "Reopened the list";
  }
}
