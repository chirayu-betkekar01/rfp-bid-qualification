import { Suspense } from "react";

import { RfpNav } from "@/components/rfp-nav";
import { pool } from "@/lib/db";
import { listPeople } from "@/lib/people";
import { getRfp } from "@/lib/requirements";
import { requireActor } from "@/lib/reviewer";

export default function RfpLayout({ children, params }: LayoutProps<"/rfps/[id]">) {
  return (
    <div className="flex w-full flex-1 flex-col lg:flex-row">
      <Suspense fallback={<div className="lg:w-60 lg:shrink-0" />}>
        <Nav params={params} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

async function Nav({ params }: Pick<LayoutProps<"/rfps/[id]">, "params">) {
  const rfpId = Number((await params).id);
  if (!Number.isInteger(rfpId)) return null;
  await requireActor();
  const db = pool();
  const [rfp, people] = await Promise.all([getRfp(db, rfpId), listPeople(db)]);
  if (!rfp) return null;
  return <RfpNav rfpId={rfp.id} title={rfp.title} buyer={rfp.buyer} lineItems={rfp.rowCount} contributors={people.length} />;
}
