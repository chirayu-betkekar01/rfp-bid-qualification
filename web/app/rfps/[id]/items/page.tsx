import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ManagerView } from "@/components/manager-view";
import { pool } from "@/lib/db";
import { listPeople } from "@/lib/people";
import { getRfp, listChanges, listRequirements, listSections } from "@/lib/requirements";
import { getActor } from "@/lib/reviewer";

/** Line items: where the manager fixes, routes and answers the list. */
export default function LineItemsPage({ params }: PageProps<"/rfps/[id]/items">) {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">Loading line items…</p>}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: Pick<PageProps<"/rfps/[id]/items">, "params">) {
  const rfpId = Number((await params).id);
  if (!Number.isInteger(rfpId)) notFound();
  const db = pool();
  const [rfp, sections, rows, changes, people, actor] = await Promise.all([
    getRfp(db, rfpId), listSections(db, rfpId), listRequirements(db, rfpId), listChanges(db, rfpId),
    listPeople(db), getActor(),
  ]);
  if (!rfp) notFound();
  return <ManagerView rfp={rfp} sections={sections} rows={rows} changes={changes} people={people} actor={actor} />;
}
