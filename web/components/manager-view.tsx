"use client";

import { useMemo, useState, useTransition } from "react";

import {
  addRow, answerRowMyself, assignAllSuggested, assignRowTo, assignSectionTo, deleteRow, editRow, mergeRows,
  type ActionResult,
} from "@/app/actions";
import { AnswerForm, AnswerLine, SuggestionBox } from "@/components/answers";
import { ChangeLog } from "@/components/change-log";
import { PRIORITY_LABELS, RowForm, fieldClass, inputClass } from "@/components/row-form";
import { suggestedOwner, type Person } from "@/lib/people";
import {
  PRIORITIES, type Change, type Priority, type Requirement, type RequirementInput, type Rfp,
  type RowType, type Section,
} from "@/lib/requirements";

type Mode =
  | { kind: "add" } | { kind: "merge" }
  | { kind: "edit"; id: number } | { kind: "delete"; id: number } | { kind: "answer"; id: number } | null;

type Status = "all" | "unassigned" | "waiting" | "answered";
type Group = { section: Section | null; rows: Requirement[] };
type Act = (change: () => Promise<ActionResult>, done?: () => void) => void;

/** The proposal manager's screen: fix the shredded list, then route every line item or answer it. */
export function ManagerView({ rfp, sections, rows, changes, people, actor }: {
  rfp: Rfp; sections: Section[]; rows: Requirement[]; changes: Change[]; people: Person[]; actor: Person | null;
}) {
  const locked = rfp.sentOutAt !== null;
  const canEdit = !locked && actor !== null;
  const canAssign = actor !== null;

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(rows[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const picked = rows.filter((r) => selected.has(r.id));            // document order, live rows only
  const active = rows.find((r) => r.id === activeId) ?? null;
  const visible = rows.filter((r) => matches(r, query, typeFilter, priorityFilter, ownerFilter, status));
  const groups = groupRows(visible, sections);
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const counts = countStatus(rows);
  const suggestable = rows.filter((r) => r.assigneeId === null && !r.response && suggestedOwner(r.type, people)).length;

  const act: Act = (change, done) => {
    setError(null);
    startTransition(async () => {
      const result = await change();
      if (result.ok) {
        setMode(null);
        done?.();
      } else setError(result.error);
    });
  };

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
      <Header rfp={rfp} rows={rows} counts={counts} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <section className="min-w-0 space-y-3">
          <Guide rfp={rfp} actor={actor} counts={counts} suggestable={suggestable} pending={pending}
                 onSuggest={() => act(() => assignAllSuggested(rfp.id))} />
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search text or reference"
                   className={`${fieldClass} w-full sm:w-56`} />
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={fieldClass}>
              <option value="all">All line items</option>
              <option value="unassigned">No owner yet</option>
              <option value="waiting">Waiting for an answer</option>
              <option value="answered">Answered</option>
            </select>
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className={fieldClass}>
              <option value="all">Anyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={fieldClass}>
              <option value="all">All types</option>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")}
                    className={fieldClass}>
              <option value="all">Any priority</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
            <button onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.section?.id ?? 0)))}
                    className="rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {collapsed.size ? "Expand all" : "Collapse all"}
            </button>
            <span className="text-sm text-zinc-500">{visible.length} of {rows.length} shown</span>
            {canEdit && (
              <button onClick={() => setMode({ kind: "add" })}
                      className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
                Add a line item
              </button>
            )}
          </div>

          {mode?.kind === "add" && (
            <Panel title="Add a line item the AI missed">
              <RowForm
                sections={sections}
                initial={{ section: active?.section ?? "", sectionId: active?.sectionId ?? sections[0]?.id ?? null,
                           text: "", type: "Functional", priority: "mandatory", page: active?.page ?? null }}
                submitLabel="Add line item" pending={pending} onCancel={() => setMode(null)}
                onSubmit={(input, reason) => act(() => addRow(rfp.id, input, reason))}
              />
            </Panel>
          )}

          {mode?.kind === "merge" && picked.length >= 2 && (
            <Panel title={`Merge ${picked.length} line items into ${picked[0].reqRef}`}>
              <ul className="mb-3 space-y-1 text-xs text-zinc-500">
                {picked.map((r) => <li key={r.id}><span className="font-mono">{r.reqRef}</span> {r.text}</li>)}
              </ul>
              <RowForm
                sections={sections} initial={mergedDraft(picked)} submitLabel="Merge line items" pending={pending}
                onCancel={() => setMode(null)}
                onSubmit={(input, reason) => act(() => mergeRows(picked.map((r) => r.id), input, reason),
                                                 () => { setSelected(new Set()); setActiveId(picked[0].id); })}
              />
            </Panel>
          )}

          <div className="space-y-3">
            {groups.length === 0 && (
              <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                No line items match these filters.
              </p>
            )}
            {groups.map((group) => {
              const key = group.section?.id ?? 0;
              const answered = group.rows.filter((r) => r.response).length;
              return (
                <div key={key} className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-zinc-100/80 px-3 py-2 dark:bg-zinc-800/60">
                    {canEdit && (
                      <input type="checkbox" aria-label={`Select every line item in ${group.section?.ref ?? "this group"}`}
                             checked={group.rows.every((r) => selected.has(r.id))} onChange={() => toggleGroup(group)} />
                    )}
                    <button onClick={() => setCollapsed((c) => flip(c, key))}
                            className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left text-sm">
                      <span className="font-semibold">{group.section?.ref ?? "No section"}</span>
                      {group.section && <span className="truncate text-zinc-600 dark:text-zinc-300">{group.section.title}</span>}
                      <span className="text-zinc-500">
                        {group.rows.length} {group.rows.length === 1 ? "item" : "items"} · {answered} answered
                      </span>
                    </button>
                    {group.section && (
                      <OwnerSelect label={`Owner of section ${group.section.ref}`} people={people}
                                   value={group.section.assigneeId} disabled={!canAssign || pending}
                                   emptyLabel="No section owner"
                                   onChange={(id) => act(() => assignSectionTo(group.section!.id, id))} />
                    )}
                  </div>
                  {!collapsed.has(key) && (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {group.rows.map((row) => (
                        <RowItem key={row.id} row={row} rfpId={rfp.id} sections={sections} people={people} byId={byId}
                                 canEdit={canEdit} canAssign={canAssign} actor={actor} pending={pending}
                                 active={row.id === activeId} selected={selected.has(row.id)} mode={mode}
                                 onActivate={() => setActiveId(row.id)} onToggle={() => toggle(row.id)}
                                 setMode={setMode} act={act} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
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
              Merge into one line item
            </button>
            <button onClick={() => setSelected(new Set())} className="opacity-75 hover:opacity-100">Clear</button>
          </div>
        </div>
      )}
    </main>
  );
}

type Counts = { total: number; unassigned: number; waiting: number; answered: number; mandatory: number };

function countStatus(rows: Requirement[]): Counts {
  return {
    total: rows.length,
    unassigned: rows.filter((r) => !r.response && r.assigneeId === null).length,
    waiting: rows.filter((r) => !r.response && r.assigneeId !== null).length,
    answered: rows.filter((r) => r.response).length,
    mandatory: rows.filter((r) => r.priority === "mandatory").length,
  };
}

function Header({ rfp, rows, counts }: { rfp: Rfp; rows: Requirement[]; counts: Counts }) {
  const stats: [string, number, string][] = [
    ["Line items", counts.total, ""],
    ["Mandatory", counts.mandatory, ""],
    ["No owner yet", counts.unassigned, counts.unassigned ? "text-amber-700 dark:text-amber-400" : ""],
    ["Waiting for an answer", counts.waiting, ""],
    ["Answered", counts.answered, counts.answered === rows.length && rows.length ? "text-emerald-700 dark:text-emerald-400" : ""],
  ];
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase dark:text-indigo-400">
        Proposal manager · Shred and assign
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{rfp.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {rfp.buyer}
        {rfp.dueDate && <> · Due {rfp.dueDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</>}
        {rfp.extractModel && <> · Shredded by {rfp.extractModel} ({rfp.extractPromptVersion})</>}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Guide({ rfp, actor, counts, suggestable, pending, onSuggest }: {
  rfp: Rfp; actor: Person | null; counts: Counts; suggestable: number; pending: boolean; onSuggest: () => void;
}) {
  const box = "rounded-lg border px-4 py-3 text-sm";
  if (!actor) {
    return (
      <div className={`${box} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200`}>
        Choose who you are at the top of the page to make changes. Every change is saved with your name.
      </div>
    );
  }
  if (rfp.sentOutAt) {
    return (
      <div className={`${box} border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200`}>
        Sent to experts by <strong>{rfp.sentOutBy}</strong> on{" "}
        {rfp.sentOutAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. The list is locked; you can
        still reassign items or answer them yourself.
      </div>
    );
  }
  const ready = counts.unassigned === 0;
  return (
    <div className={`${box} space-y-2 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900`}>
      <p className="text-zinc-600 dark:text-zinc-300">
        <strong className="text-zinc-900 dark:text-zinc-100">1. Fix the list:</strong> merge items that are one
        obligation, delete what isn&apos;t one, add anything missed.{" "}
        <strong className="text-zinc-900 dark:text-zinc-100">2. Route it:</strong> give each section an owner, change
        single items where needed, or answer items yourself.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {suggestable > 0 && (
          <button disabled={pending} onClick={onSuggest}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            Give {suggestable} unassigned {suggestable === 1 ? "item" : "items"} to their usual owners
          </button>
        )}
        <span className={ready ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
          {ready
            ? "Every line item has an owner or an answer. Sending out to experts comes next."
            : `${counts.unassigned} ${counts.unassigned === 1 ? "item still needs" : "items still need"} an owner.`}
        </span>
      </div>
    </div>
  );
}

function RowItem({ row, rfpId, sections, people, byId, canEdit, canAssign, actor, pending, active, selected, mode,
                   onActivate, onToggle, setMode, act }: {
  row: Requirement; rfpId: number; sections: Section[]; people: Person[]; byId: Map<number, Person>;
  canEdit: boolean; canAssign: boolean; actor: Person | null; pending: boolean; active: boolean; selected: boolean;
  mode: Mode; onActivate: () => void; onToggle: () => void; setMode: (m: Mode) => void; act: Act;
}) {
  const [reason, setReason] = useState("");
  const editing = mode?.kind === "edit" && mode.id === row.id;
  const deleting = mode?.kind === "delete" && mode.id === row.id;
  const answering = mode?.kind === "answer" && mode.id === row.id;
  const suggested = row.assigneeId === null ? suggestedOwner(row.type, people) : null;

  return (
    <li className={`border-l-2 px-3 py-2.5 ${active ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30" : "border-transparent"}`}>
      <div className="flex items-start gap-3">
        {canEdit && (
          <input type="checkbox" className="mt-1" aria-label={`Select ${row.reqRef}`} checked={selected} onChange={onToggle} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div className="min-w-0 flex-1">
          <button onClick={onActivate} className="w-full text-left">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-mono text-zinc-500">{row.reqRef}</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{row.section ?? "No reference"}</span>
              <Badge>{row.type}</Badge>
              {row.createdBy === "reviewer" && <Badge tone="indigo">Added by a person</Badge>}
              {row.edited && <Badge tone="indigo">Edited</Badge>}
              {row.page && <span className="hidden text-zinc-400 lg:inline">p. {row.page}</span>}
            </div>
            <p className="mt-1 text-sm leading-snug">{row.text}</p>
          </button>
            {row.response && <AnswerLine response={row.response} />}
            {!row.response && <SuggestionBox suggestion={row.suggestion} />}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
            <PriorityToggle value={row.priority} disabled={!canEdit || pending}
                            onChange={(p) => act(() => editRow(row.id, { priority: p }))} />
            {!row.response && (
              <div className="flex flex-col items-start gap-0.5 sm:items-end">
                <OwnerSelect label={`Owner of ${row.reqRef}`} people={people} value={row.assigneeId}
                             disabled={!canAssign || pending} emptyLabel="No owner yet"
                             onChange={(id) => act(() => assignRowTo(row.id, id))} />
                {suggested && <span className="text-xs text-zinc-400">Usually {suggested.name} ({suggested.role})</span>}
                {row.assigneeId !== null && !byId.has(row.assigneeId) && (
                  <span className="text-xs text-amber-600">Owner is no longer on the team</span>
                )}
              </div>
            )}
            <div className="flex gap-2 text-xs">
              {row.page && (
                <a href={`/rfps/${rfpId}/source#page=${row.page}`} target="_blank" rel="noreferrer"
                   className="text-zinc-500 hover:underline lg:hidden">p. {row.page}</a>
              )}
              {actor && (
                <button onClick={() => setMode({ kind: "answer", id: row.id })}
                        className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {row.response ? "Change answer" : "Answer myself"}
                </button>
              )}
              {canEdit && !row.response && (
                <>
                  <button onClick={() => setMode({ kind: "edit", id: row.id })} className="text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">Edit</button>
                  <button onClick={() => setMode({ kind: "delete", id: row.id })} className="text-zinc-500 hover:text-red-700 hover:underline dark:hover:text-red-400">Delete</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {answering && actor && (
        <AnswerForm initial={row.response} pending={pending} onCancel={() => setMode(null)}
                    onSubmit={(answer, note) => act(() => answerRowMyself(row.id, answer, note))} />
      )}
      {editing && (
        <div className="mt-3">
          <RowForm sections={sections}
                   initial={{ section: row.section, sectionId: row.sectionId, text: row.text, type: row.type as RowType,
                              priority: row.priority, page: row.page }}
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

function OwnerSelect({ label, people, value, disabled, emptyLabel, onChange }: {
  label: string; people: Person[]; value: number | null; disabled: boolean; emptyLabel: string;
  onChange: (id: number | null) => void;
}) {
  return (
    <select aria-label={label} value={value ?? ""} disabled={disabled}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
            className={`${fieldClass} max-w-[14rem] py-1 text-xs ${value === null ? "text-zinc-500" : ""}`}>
      <option value="">{emptyLabel}</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
    </select>
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

export function SourcePanel({ rfpId, row }: { rfpId: number; row: Pick<Requirement, "page" | "reqRef"> | null }) {
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
        <p className="p-4 text-sm text-zinc-500">Pick a line item to see the page it came from.</p>
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

export function Badge({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "indigo" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
  };
  return <span className={`rounded px-1.5 py-0.5 ${tones[tone]}`}>{children}</span>;
}

/** Rows grouped by section, in section order; rows without a section come last. */
function groupRows(rows: Requirement[], sections: Section[]): Group[] {
  const bySection = new Map<number, Requirement[]>();
  const loose: Requirement[] = [];
  for (const row of rows) {
    if (row.sectionId === null) loose.push(row);
    else bySection.set(row.sectionId, [...(bySection.get(row.sectionId) ?? []), row]);
  }
  const groups: Group[] = sections.filter((s) => bySection.has(s.id))
    .map((s) => ({ section: s, rows: bySection.get(s.id)! }));
  return loose.length ? [...groups, { section: null, rows: loose }] : groups;
}

function matches(row: Requirement, query: string, type: string, priority: Priority | "all", owner: string,
                 status: Status): boolean {
  const q = query.trim().toLowerCase();
  const holder = row.response?.personId ?? row.assigneeId;
  return (type === "all" || row.type === type)
    && (priority === "all" || row.priority === priority)
    && (owner === "all" || holder === Number(owner))
    && (status === "all"
        || (status === "unassigned" && !row.response && row.assigneeId === null)
        || (status === "waiting" && !row.response && row.assigneeId !== null)
        || (status === "answered" && row.response !== null))
    && (!q || row.text.toLowerCase().includes(q) || (row.section ?? "").toLowerCase().includes(q)
        || row.reqRef.toLowerCase() === q);
}

/** Starting point for a merge: the first item's section and type, the strictest priority, all the text. */
function mergedDraft(rows: Requirement[]): RequirementInput {
  const pages = rows.map((r) => r.page).filter((p): p is number => p !== null);
  const priority = PRIORITIES.find((p) => rows.some((r) => r.priority === p)) ?? "optional";
  return {
    section: rows[0].section,
    sectionId: rows[0].sectionId,
    text: rows.map((r) => r.text).join("\n"),
    type: rows[0].type as RowType,
    priority,
    page: pages.length ? Math.min(...pages) : null,
  };
}

function flip<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
