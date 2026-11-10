import { readFile } from "node:fs/promises";
import path from "node:path";

import { pool } from "@/lib/db";
import { getRfp } from "@/lib/requirements";

// Each folder's path is written out in full so the bundler traces only that folder. The
// fictional demo RFPs (data/mock_rfps) ship with a deployment. Real test RFPs stay on this
// machine (rule 8: they hold buyer contact details), so that folder is never traced or bundled.
const readers = [
  (name: string) => readFile(path.join(process.cwd(), "..", "data", "mock_rfps", name)),
  (name: string) => readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), "..", "data", "test_rfps", name)),
];

/** Serve an RFP's source PDF so the review screen can show the page a row came from. */
export async function GET(_request: Request, ctx: RouteContext<"/rfps/[id]/source">) {
  const rfpId = Number((await ctx.params).id);
  const rfp = Number.isInteger(rfpId) ? await getRfp(pool(), rfpId) : null;
  if (!rfp) return new Response("No such RFP.", { status: 404 });

  const name = path.basename(rfp.sourceFile);
  if (!name.toLowerCase().endsWith(".pdf")) return new Response("Only PDF sources can be shown.", { status: 415 });
  for (const read of readers) {
    try {
      const data = await read(name);
      return new Response(data, {
        headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"` },
      });
    } catch {
      // not in this folder; try the next
    }
  }
  return new Response(`${name} is not in data/test_rfps or data/mock_rfps. Fetch the test RFPs with: python -m eval.fetch_test_rfps`,
                      { status: 404 });
}
