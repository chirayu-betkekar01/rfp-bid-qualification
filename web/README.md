# Review app

The human checkpoints of the Tallyhouse RFP system, built with Next.js. It reads and writes the
same Postgres database as the Python pipeline. So far it covers **Checkpoint A**: the reviewer
checks the requirement list the AI extracted, then confirms it.

## Run it

1. Start the local database from the repo root: `npx supabase start` (Docker Desktop must be running).
2. Make sure `DATABASE_URL` in the repo-root `.env` points at it. The app reads that file; there is no `web/.env`.
3. From `web/`: `npm install`, then `npm run dev -- -p 3100`, and open http://localhost:3100.

The source PDF panel serves files from `data/test_rfps/`, which stays out of git (rule 8).
Fetch them with `python -m eval.fetch_test_rfps`.

## Checkpoint A

- Rows are grouped by section; a section with many rows is flagged as a likely split clause.
- Fix a row's priority (mandatory, scored, optional) with one click; edit, delete, add, or select
  several rows and merge them into one.
- Clicking a row shows its page of the RFP beside the list.
- Every change is saved in `requirement_change` with the reviewer's name, the row before and after,
  and an optional reason. Merges keep every original row; deletes keep what the row said.
- **Confirm list** locks the list for drafting. Reopening it needs a reason.

There is no login yet: the reviewer types their name, and the app refuses changes without one
(or from "AI" / "system").

## Tests

`npm test` runs the data-layer tests in `tests/` against `TEST_DATABASE_URL`. Each test is rolled back.
