# Review app

The people side of the Tallyhouse bid-qualification flow, built with Next.js. It reads and
writes the same Postgres database as the Python pipeline: the AI shreds an RFP into sections and
line items, the proposal manager routes them to experts, experts answer Yes / No / Maybe, and
code scores the answers for the go/no-go decision.

## Run it

1. Start the local database from the repo root: `npx supabase start` (Docker Desktop must be running).
2. Make sure `DATABASE_URL` in the repo-root `.env` points at it. The app reads that file; there is no `web/.env`.
3. From `web/`: `npm install`, then `npm run dev -- -p 3100`, and open http://localhost:3100.

The source PDF panel serves files from `data/test_rfps/`, which stays out of git (rule 8).
Fetch them with `python -m eval.fetch_test_rfps`.

## Manager screen (`/rfps/<id>`)

- Line items are grouped by the RFP's real sections (IV, Exhibit B, ...); click one to see its page.
- Fix the list: merge, edit, delete, add, and set each item's priority (mandatory, scored, optional).
- Route it: **Give N unassigned items to their usual owners** sets an owner by item type; give a
  whole section to one person, change single items, or **Answer myself** (Yes / No / Maybe, with a
  note required for No and Maybe).
- Every change goes to `requirement_change` with the person's name. Once the RFP is sent out to
  experts the list is locked; reassigning still works.

There is no login yet: pick who you are under **Acting as**. The demo team is fictional and comes
from `supabase/seed.sql`.

## Tests

`npm test` runs the data-layer tests in `tests/` against `TEST_DATABASE_URL`. Each test is rolled back.
