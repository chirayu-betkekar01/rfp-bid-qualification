import Link from "next/link";
import { Suspense } from "react";

import { pool } from "@/lib/db";
import { listRfps } from "@/lib/requirements";
import { requireActor } from "@/lib/reviewer";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">RFPs</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The AI shreds each RFP into line items. Route them to the right experts, collect Yes / No / Maybe answers, then decide whether to bid.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading RFPs…</p>}>
        <RfpList />
      </Suspense>
    </main>
  );
}

async function RfpList() {
  await requireActor();
  const rfps = await listRfps(pool());
  if (rfps.length === 0) {
    return (
      <p className="mt-6 text-sm text-zinc-500">
        No RFPs yet. Run <code className="font-mono">python -m src.extract.run data/test_rfps/&lt;file&gt;.pdf</code>.
      </p>
    );
  }
  return (
    <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {rfps.map((rfp) => (
        <li key={rfp.id}>
          <Link href={`/rfps/${rfp.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <div className="min-w-0">
              <div className="truncate font-medium">{rfp.title}</div>
              <div className="text-sm text-zinc-500">
                {rfp.buyer} · {rfp.rowCount} requirements · {rfp.sourceFile}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                rfp.sentOutAt
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              }`}
            >
              {rfp.sentOutAt ? "Sent to experts" : "Needs routing"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
