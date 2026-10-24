import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExpertView, type ExpertRfp } from "@/components/expert-view";
import { pool } from "@/lib/db";
import { findPersonByToken, listPeople } from "@/lib/people";
import { getRfp, listAssignedRequirements, listSections } from "@/lib/requirements";

/** An expert's personal link: everything waiting for them, across sent-out RFPs. */
export default function ExpertPage({ params }: PageProps<"/r/[token]">) {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">Loading your line items…</p>}>
      <Items params={params} />
    </Suspense>
  );
}

async function Items({ params }: Pick<PageProps<"/r/[token]">, "params">) {
  const { token } = await params;
  const db = pool();
  const person = await findPersonByToken(db, token);
  if (!person) notFound();
  const [rows, people] = await Promise.all([listAssignedRequirements(db, person.id), listPeople(db)]);

  const rfps: ExpertRfp[] = [];
  for (const rfpId of [...new Set(rows.map((r) => r.rfpId))]) {
    const [rfp, sections] = await Promise.all([getRfp(db, rfpId), listSections(db, rfpId)]);
    if (!rfp) continue;
    rfps.push({ id: rfp.id, buyer: rfp.buyer, title: rfp.title, dueAt: rfp.responsesDueAt, sections,
                rows: rows.filter((r) => r.rfpId === rfpId) });
  }
  return <ExpertView person={person} token={token} rfps={rfps} people={people} />;
}
