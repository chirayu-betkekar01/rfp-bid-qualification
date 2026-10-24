"use client";

import { useMemo, useState, useTransition } from "react";

import {
  addRow, confirmList, deleteRow, editRow, mergeRows, reopenList, type ActionResult,
} from "@/app/actions";
import { ChangeLog } from "@/components/change-log";
import { PRIORITY_LABELS, RowForm, fieldClass, inputClass } from "@/components/row-form";
import {
  PRIORITIES, type Change, type Priority, type Requirement, type RequirementInput, type Rfp, type RowType,
} from "@/lib/requirements";

// A section that produced this many rows is often one obligation split sentence by sentence.
const SPLIT_HINT = 5;

type Mode =
  | { kind: "add" } | { kind: "merge" } | { kind: "confirm" } | { kind: "reopen" }
  | { kind: "edit"; id: number } | { kind: "delete"; id: number } | null;

type Group = { key: string; rows: Requirement[] };

/** Checkpoint A: the reviewer checks the extracted requirement list against the RFP and confirms it. */
export function CheckpointA({ rfp, rows, changes, reviewer }: {
  rfp: Rfp; rows: Requirement[]; changes: Change[]; reviewer: string;
}) {
  const locked = rfp.confirmedAt !== null;
  const canEdit = !locked && reviewer !== "";

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(rows[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const picked = rows.filter((r) => selected.has(r.id));            // document order, live rows only
  const active = rows.find((r) => r.id === activeId) ?? null;
  const visible = rows.filter((r) => matches(r, query, typeFilter, priorityFilter));
  const groups = groupRows(visible);
  const types = [...new Set(rows.map((r) => r.type))].sort();

  function act(change: () => Promise<ActionResult>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await change();
      if (result.ok) {
        setMode(null);
        done?.();
      } else setError(result.error);
    });
  }

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set([...s].filter((x) => ids.has(x)));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: Group) {
    setSelected((s) => {
      const next = new Set([...s].filter((x) => ids.has(x)));
      const all = group.rows.every((r) => next.has(r.id));
      group.rows.forEach((r) => (all ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
      <Header rfp={rfp} rows={rows} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <section className="min-w-0 space-y-3">
          <StatusBanner rfp={rfp} rows={rows} reviewer={reviewer} mode={mode} pending={pending}
                        setMode={setMode} act={act} />
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search text or section"
                   className={`${fieldClass} w-full sm:w-64`} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={fieldClass}>
              <option value="all">All types</option>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")}
                    className={fieldClass}>
              <option value="all">Any priority</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
            <button onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.key)))}
                    className="rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {collapsed.size ? "Expand all" : "Collapse all"}
            </button>
            <span className="text-sm text-zinc-500">{visible.length} of {rows.length} shown</span>
            {canEdit && (
              <button onClick={() => setMode({ kind: "add" })}
                      className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
                Add a row
              </button>
            )}
          </div>

          {mode?.kind === "add" && (
            <Panel title="Add a requirement the AI missed">
              <RowForm
                initial={{ section: active?.section ?? "", text: "", type: "Functional", priority: "mandatory",
                           page: active?.page ?? null }}
                submitLabel="Add row" pending={pending} onCancel={() => setMode(null)}
                onSubmit={(input, reason) => act(() => addRow(rfp.id, input, reason))}
              />
            </Panel>
          )}

          {mode?.kind === "merge" && picked.length >= 2 && (
            <Panel title={`Merge ${picked.length} rows into ${picked[0].reqRef}`}>
              <ul className="mb-3 space-y-1 text-xs text-zinc-500">
                {picked.map((r) => <li key={r.id}><span className="font-mono">{r.reqRef}</span> {r.text}</li>)}
              </ul>
              <RowForm
                initial={mergedDraft(picked)} submitLabel="Merge rows" pending={pending}
                onCancel={() => setMode(null)}
                onSubmit={(input, reason) => act(() => mergeRows(picked.map((r) => r.id), input, reason),
                                                 () => { setSelected(new Set()); setActiveId(picked[0].id); })}
              />
            </Panel>
          )}

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {groups.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">No rows match these filters.</p>}
            {groups.map((group) => (
              <div key={group.key} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
                <div className="flex items-center gap-3 bg-zinc-100/80 px-3 py-2 dark:bg-zinc-800/60">
                  {canEdit && (
                    <input type="checkbox" aria-label={`Select every row in ${group.key}`}
                           checked={group.rows.every((r) => selected.has(r.id))} onChange={() => toggleGroup(group)} />
                  )}
                  <button onClick={() => setCollapsed((c) => flip(c, group.key))}
                          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left text-sm">
                    <span className="font-semibold">{group.key}</span>
                    <span className="text-zinc-500">{group.rows.length} {group.rows.length === 1 ? "row" : "rows"}</span>
                    {group.rows.length >= SPLIT_HINT && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        Many rows from one section. Check whether some should be merged.
                      </span>
                    )}
                  </button>
                  <span className="text-xs text-zinc-400">{collapsed.has(group.key) ? "Show" : "Hide"}</span>
                </div>
                {!collapsed.has(group.key) && (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {group.rows.map((row) => (
                      <RowItem key={row.id} row={row} rfpId={rfp.id} canEdit={canEdit} pending={pending}
                               active={row.id === activeId} selected={selected.has(row.id)} mode={mode}
                               onActivate={() => setActiveId(row.id)} onToggle={() => toggle(row.id)}
                               setMode={setMode} act={act} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <ChangeLog changes={changes} />
        </section>

        <aside className="hidden lg:block">
          <div className="sticky top-4 h-[calc(100vh-2rem)]">
            <SourcePanel rfpId={rfp.id} row={active} />
          </div>
        </aside>
      </div>

      {canEdit && picked.length > 0 && mode?.kind !== "merge" && (
        <div className="fixed inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
            <span>{picked.length} selected</span>
            <button disabled={picked.length < 2} onClick={() => setMode({ kind: "merge" })}
                    className="rounded-full bg-indigo-500 px-3 py-1 font-medium text-white disabled:opacity-40">
              Merge into one row
            </button>
            <button onClick={() => setSelected(new Set())} className="opacity-75 hover:opacity-100">Clear</button>
          </div>
        </div>
      )}
    </main>
  );
}

function Header({ rfp, rows }: { rfp: Rfp; rows: Requirement[] }) {
  const count = (p: Priority) => rows.filter((r) => r.priority === p).length;
  const changed = rows.filter((r) => r.createdBy === "reviewer" || r.edited).length;
  const stats: [string, number][] = [
    ["Requirements", rows.length], ["Mandatory", count("mandatory")], ["Scored", count("scored")],
    ["Optional", count("optional")], ["Added or edited by a reviewer", changed],
  ];
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase dark:text-indigo-400">
        Checkpoint A · Requirement list
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{rfp.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {rfp.buyer}
        {rfp.dueDate && <> · Due {rfp.dueDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</>}
        {rfp.extractModel && <> · Extracted by {rfp.extractModel} ({rfp.extractPromptVersion})</>}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatusBanner({ rfp, rows, reviewer, mode, pending, setMode, act }: {
  rfp: Rfp; rows: Requirement[]; reviewer: string; mode: Mode; pending: boolean;
  setMode: (m: Mode) => void; act: (change: () => Promise<ActionResult>) => void;
}) {
  const [reason, setReason] = useState("");
  const box = "rounded-lg border px-4 py-3 text-sm";

  if (rfp.confirmedAt) {
    return (
      <div className={`${box} border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200`}>
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Confirmed by <strong>{rfp.confirmedBy}</strong> on{" "}
            {rfp.confirmedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. The list is locked
            and ready for drafting.
          </span>
          {reviewer && mode?.kind !== "reopen" && (
            <button onClick={() => setMode({ kind: "reopen" })} className="ml-auto underline">Reopen the list</button>
          )}
        </div>
        {mode?.kind === "reopen" && (
          <form className="mt-3 flex flex-wrap gap-2"
                onSubmit={(e) => { e.preventDefault(); act(() => reopenList(rfp.id, reason)); }}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does the list need to change?"
                   className={`${inputClass} max-w-md`} required />
            <button disabled={pending} className="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">Reopen</button>
            <button type="button" onClick={() => setMode(null)} className="px-2">Cancel</button>
          </form>
        )}
      </div>
    );
  }

  if (!reviewer) {
    return (
      <div className={`${box} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200`}>
        Enter your name at the top of the page to make changes. Every change is saved with the name of the person who made it.
      </div>
    );
  }

  return (
    <div className={`${box} border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-zinc-600 dark:text-zinc-300">
          Check each row against the RFP: merge rows that are one obligation, delete rows that aren&apos;t
          requirements, add anything missed, and fix the priority.
        </span>
        {mode?.kind !== "confirm" && (
          <button onClick={() => setMode({ kind: "confirm" })}
                  className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white">
            Confirm list
          </button>
        )}
      </div>
      {mode?.kind === "confirm" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 dark:bg-indigo-950/40">
          <span>I checked this list against the RFP. Drafting will use these <strong>{rows.length}</strong> rows.</span>
          <button disabled={pending} onClick={() => act(() => confirmList(rfp.id))}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            Confirm as {reviewer}
          </button>
          <button onClick={() => setMode(null)} className="px-2">Cancel</button>
        </div>
      )}
    </div>
  );
}

function RowItem({ row, rfpId, canEdit, pending, active, selected, mode, onActivate, onToggle, setMode, act }: {
  row: Requirement; rfpId: number; canEdit: boolean; pending: boolean; active: boolean; selected: boolean;
  mode: Mode; onActivate: () => void; onToggle: () => void; setMode: (m: Mode) => void;
  act: (change: () => Promise<ActionResult>) => void;
}) {
  const [reason, setReason] = useState("");
  const editing = mode?.kind === "edit" && mode.id === row.id;
  const deleting = mode?.kind === "delete" && mode.id === row.id;

  return (
    <li className={`border-l-2 px-3 py-2.5 ${active ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30" : "border-transparent"}`}>
      <div className="flex items-start gap-3">
        {canEdit && (
          <input type="checkbox" className="mt-1" aria-label={`Select ${row.reqRef}`} checked={selected} onChange={onToggle} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <button onClick={onActivate} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-zinc-500">{row.reqRef}</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{row.section ?? "No section"}</span>
            <Badge>{row.type}</Badge>
            {row.createdBy === "reviewer" && <Badge tone="indigo">Added by reviewer</Badge>}
            {row.edited && <Badge tone="indigo">Edited</Badge>}
            {row.page && <span className="hidden text-zinc-400 lg:inline">p. {row.page}</span>}
          </div>
          <p className="mt-1 text-sm leading-snug">{row.text}</p>
        </button>
        <div className="flex shrink-0 flex-row-reverse items-center justify-end gap-3 sm:flex-col sm:items-end sm:gap-1.5">
          <PriorityToggle value={row.priority} disabled={!canEdit || pending}
                          onChange={(p) => act(() => editRow(row.id, { priority: p }))} />
          <div className="flex gap-2 text-xs">
            {row.page && (
              <a href={`/rfps/${rfpId}/source#page=${row.page}`} target="_blank" rel="noreferrer"
                 className="text-zinc-500 hover:underline lg:hidden">p. {row.page}</a>
            )}
            {canEdit && (
              <>
                <button onClick={() => setMode({ kind: "edit", id: row.id })} className="text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">Edit</button>
                <button onClick={() => setMode({ kind: "delete", id: row.id })} className="text-zinc-500 hover:text-red-700 hover:underline dark:hover:text-red-400">Delete</button>
              </>
            )}
          </div>
        </div>
        </div>
      </div>

      {editing && (
        <div className="mt-3">
          <RowForm initial={{ section: row.section, text: row.text, type: row.type as RowType, priority: row.priority, page: row.page }}
                   submitLabel="Save changes" pending={pending} onCancel={() => setMode(null)}
                   onSubmit={(input, reason) => act(() => editRow(row.id, input, reason))} />
        </div>
      )}
      {deleting && (
        <form className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm dark:bg-red-950/30"
              onSubmit={(e) => { e.preventDefault(); act(() => deleteRow(row.id, reason)); }}>
          <span>Delete {row.reqRef}?</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional), e.g. not a vendor obligation"
                 className={`${inputClass} max-w-sm`} autoFocus />
          <button disabled={pending} className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Delete</button>
          <button type="button" onClick={() => setMode(null)} className="px-2">Cancel</button>
        </form>
      )}
    </li>
  );
}

function PriorityToggle({ value, disabled, onChange }: {
  value: Priority; disabled: boolean; onChange: (p: Priority) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Priority" className="inline-flex rounded-md border border-zinc-200 p-0.5 text-xs dark:border-zinc-700">
      {PRIORITIES.map((p) => (
        <button key={p} role="radio" aria-checked={value === p} disabled={disabled || value === p}
                onClick={() => onChange(p)}
                className={`rounded px-2 py-0.5 ${value === p
                  ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800"}`}>
          {PRIORITY_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function SourcePanel({ rfpId, row }: { rfpId: number; row: Requirement | null }) {
  const url = `/rfps/${rfpId}/source`;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <span className="font-medium">
          RFP source{row?.page ? <span className="font-normal text-zinc-500"> · page {row.page} · {row.reqRef}</span> : null}
        </span>
        <a href={row?.page ? `${url}#page=${row.page}` : url} target="_blank" rel="noreferrer"
           className="text-indigo-600 hover:underline dark:text-indigo-400">Open in new tab</a>
      </div>
      {row?.page ? (
        <iframe key={row.page} src={`${url}#page=${row.page}`} title={`RFP page ${row.page}`} className="w-full flex-1" />
      ) : (
        <p className="p-4 text-sm text-zinc-500">Pick a row to see the page it came from.</p>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-4 dark:border-indigo-900 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Badge({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "indigo" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
  };
  return <span className={`rounded px-1.5 py-0.5 ${tones[tone]}`}>{children}</span>;
}

/** Group by the first two levels of the section ("Exhibit B.6.A.1" goes under "Exhibit B.6"). */
function groupRows(rows: Requirement[]): Group[] {
  const groups = new Map<string, Requirement[]>();
  for (const row of rows) {
    const key = row.section ? row.section.split(".").slice(0, 2).join(".") : "No section";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, rows]) => ({ key, rows }));
}

function matches(row: Requirement, query: string, type: string, priority: Priority | "all"): boolean {
  const q = query.trim().toLowerCase();
  return (type === "all" || row.type === type)
    && (priority === "all" || row.priority === priority)
    && (!q || row.text.toLowerCase().includes(q) || (row.section ?? "").toLowerCase().includes(q)
        || row.reqRef.toLowerCase() === q);
}

/** Starting point for a merge: the first row's section and type, the strictest priority, all the text. */
function mergedDraft(rows: Requirement[]): RequirementInput {
  const pages = rows.map((r) => r.page).filter((p): p is number => p !== null);
  const priority = PRIORITIES.find((p) => rows.some((r) => r.priority === p)) ?? "optional";
  return {
    section: rows[0].section,
    text: rows.map((r) => r.text).join("\n"),
    type: rows[0].type as RowType,
    priority,
    page: pages.length ? Math.min(...pages) : null,
  };
}

function flip(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
