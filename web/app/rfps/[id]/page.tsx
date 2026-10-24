import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CheckpointA } from "@/components/checkpoint-a";
import { pool } from "@/lib/db";
import { getRfp, listChanges, listRequirements } from "@/lib/requirements";
import { getReviewer } from "@/lib/reviewer";

export default function RfpPage({ params }: PageProps<"/rfps/[id]">) {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">Loading requirement list…</p>}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: Pick<PageProps<"/rfps/[id]">, "params">) {
  const rfpId = Number((await params).id);
  if (!Number.isInteger(rfpId)) notFound();
  const db = pool();
  const [rfp, rows, changes, reviewer] = await Promise.all([
    getRfp(db, rfpId), listRequirements(db, rfpId), listChanges(db, rfpId), getReviewer(),
  ]);
  if (!rfp) notFound();
  return <CheckpointA rfp={rfp} rows={rows} changes={changes} reviewer={reviewer} />;
}
