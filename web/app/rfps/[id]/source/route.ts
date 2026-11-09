import { readFile } from "node:fs/promises";
import path from "node:path";

import { pool } from "@/lib/db";
import { getRfp } from "@/lib/requirements";

// Real test RFPs stay on this machine, outside git (rule 8): python -m eval.fetch_test_rfps.
// The fictional demo RFPs are committed in data/mock_rfps.
const RFP_FOLDERS = ["test_rfps", "mock_rfps"].map((dir) => path.resolve(process.cwd(), "..", "data", dir));

/** Serve an RFP's source PDF so the review screen can show the page a row came from. */
export async function GET(_request: Request, ctx: RouteContext<"/rfps/[id]/source">) {
  const rfpId = Number((await ctx.params).id);
  const rfp = Number.isInteger(rfpId) ? await getRfp(pool(), rfpId) : null;
  if (!rfp) return new Response("No such RFP.", { status: 404 });

  const name = path.basename(rfp.sourceFile);
  if (!name.toLowerCase().endsWith(".pdf")) return new Response("Only PDF sources can be shown.", { status: 415 });
  for (const folder of RFP_FOLDERS) {
    try {
      const data = await readFile(path.join(folder, name));
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
