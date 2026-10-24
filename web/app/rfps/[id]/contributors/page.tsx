import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContributorsView } from "@/components/contributors-view";
import { pool } from "@/lib/db";
import { KNOWN_ROLES, listContributors } from "@/lib/people";
import { getActor } from "@/lib/reviewer";

/** Contributors: add, rename, change the role of, or remove people who answer line items. */
export default function ContributorsPage({ params }: PageProps<"/rfps/[id]/contributors">) {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">Loading contributors…</p>}>
      <Team params={params} />
    </Suspense>
  );
}

async function Team({ params }: Pick<PageProps<"/rfps/[id]/contributors">, "params">) {
  const rfpId = Number((await params).id);
  if (!Number.isInteger(rfpId)) notFound();
  const db = pool();
  const [contributors, actor] = await Promise.all([listContributors(db, rfpId), getActor()]);
  const roles = [...new Set([...KNOWN_ROLES, ...contributors.map((c) => c.role)])].sort();
  return <ContributorsView contributors={contributors} roles={roles} canEdit={actor !== null} />;
}
