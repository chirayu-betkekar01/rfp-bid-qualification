"use client";

import { useState, useTransition } from "react";

import { nudgePerson } from "@/app/actions";
import type { NotificationRow, PersonProgress } from "@/lib/experts";

const KIND_LABELS: Record<string, string> = {
  send_out: "Sent out", forwarded: "Forwarded", reassigned: "Reassigned", nudge: "Nudge", all_done: "All answered",
};

/** After sending out: who has answered, nudges, and every Slack message. */
export function Progress({ rfpId, progress, notifications, canNudge }: {
  rfpId: number; progress: PersonProgress[]; notifications: NotificationRow[]; canNudge: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const onNudge = (personId: number) => startTransition(async () => {
    const result = await nudgePerson(rfpId, personId);
    setError(result.ok ? null : result.error);
  });
  const notSent = notifications.filter((n) => !n.ok);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="border-b border-zinc-200 px-4 py-2 font-semibold dark:border-zinc-800">Who has answered</h2>
      {error && <p role="alert" className="px-4 py-2 text-red-700 dark:text-red-400">{error}</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {progress.map(({ person, items, answered, submitted, lastNudgedAt }) => {
          const done = submitted === items;
          return (
            <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="min-w-40 font-medium">{person.name}<span className="font-normal text-zinc-500"> · {person.role}</span></span>
              <span className={done ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600 dark:text-zinc-300"}>
                {done
                  ? `Submitted all ${items}`
                  : `${submitted} of ${items} submitted${answered > submitted ? `, ${answered - submitted} answered but not submitted` : ""}`}
              </span>
              <span className="ml-auto flex items-center gap-3 text-xs">
                {lastNudgedAt && (
                  <span className="text-zinc-400">
                    Nudged {lastNudgedAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
                {!done && canNudge && (
                  <button disabled={pending} onClick={() => onNudge(person.id)}
                          className="text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400">Nudge</button>
                )}
                <a href={`/r/${person.linkToken}`} target="_blank" rel="noreferrer" className="text-zinc-500 hover:underline">
                  Open their link
                </a>
              </span>
            </li>
          );
        })}
      </ul>
      <details className="border-t border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-2 text-zinc-600 dark:text-zinc-300">
          Slack messages ({notifications.length})
          {notSent.length > 0 && <span className="text-amber-700 dark:text-amber-400"> · {notSent.length} not sent</span>}
        </summary>
        <ul className="space-y-1 px-4 pb-3 text-xs">
          {notifications.map((n) => (
            <li key={n.id} className="flex flex-wrap gap-x-2">
              <span className="text-zinc-400">{n.sentAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</span>
              <span>{KIND_LABELS[n.kind] ?? n.kind}{n.personName && ` · ${n.personName}`}</span>
              <span className={n.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                {n.ok ? "sent" : `not sent: ${n.error}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
