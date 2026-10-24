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

## RFP pages

Each RFP has a navigation column on the left (tabs across the top on a phone):

- **Overview** (`/rfps/<id>`): the RFP's details, a five-step tracker (shredded, owners set, sent to
  experts, all answered, go / no-go) with the next thing to do, line-item counts by priority and
  type, answer counts from people and from the AI, mandatory items answered No, the known gaps the
  RFP touches, and after sending out, who has answered (with Nudge and the Slack log).
- **Line items** (`/rfps/<id>/items`): the manager screen below.
- **Contributors** (`/rfps/<id>/contributors`): add, rename, change the role of, or remove people.
  The team is shared by every RFP, so changes update every owner dropdown. Removing someone hides
  them from the dropdowns and keeps their past answers; it is refused while they still hold
  unanswered items.

## Line items (`/rfps/<id>/items`)

- Line items are grouped by the RFP's real sections (IV, Exhibit B, ...); click one to see its page.
- Fix the list: merge, edit, delete and add line items. Each item has a priority tag at its top
  left, set by the AI from the RFP's wording: **Mandatory** (pass/fail), **Good to Have** (earns
  points but isn't pass/fail; stored as `scored`) or **Optional**. The manager corrects it with the
  tag's dropdown until the RFP is sent out.
- Route it: **Give N unassigned items to their usual owners** sets an owner by item type. **Assign**
  on an item, **Assign section** on a section header, or **Assign** on a selection opens a popup
  with the team grouped by role and the usual owner first.
- Answer it yourself with the **Yes / No / Maybe** buttons on each item: Yes saves at once, No and
  Maybe ask for a note first. Edit and Delete sit behind the **⋯** menu.
- Every change goes to `requirement_change` with the person's name. Once the RFP is sent out to
  experts the list is locked; reassigning still works.

- **Send out**: once every item has an owner or an answer, pick an answer deadline and send. The
  list locks, and each person gets one Slack message with their personal link. After that, the
  manager sees who has answered, can **Nudge** anyone with items left, and can open each person's
  link (handy for the demo). Every Slack attempt is logged, sent or not.

## Expert screen (`/r/<token>`)

- Only that person's items on sent-out RFPs, grouped by RFP, with the RFP page beside them.
- Each item shows the AI suggestion, its reason and the library answers it cites. Nothing is
  pre-selected: the expert picks Yes / No / Maybe (No and Maybe need a note).
- **Forward** passes items to someone else with a note; the new person gets a Slack message and
  sees who forwarded it and why. Items forwarded more than twice are flagged for the manager.
- **Submit** once every item is answered. The last submission tells the manager on Slack.

## Slack

Set `SLACK_WEBHOOK_URL` in the repo-root `.env` to an incoming webhook for a demo channel. Without
it, messages are still written to the `notification` table and shown as "not sent".

There is no login yet: pick who you are under **Acting as**. The demo team is fictional and comes
from `supabase/seed.sql`.

## Tests

`npm test` runs the data-layer tests in `tests/` against `TEST_DATABASE_URL`. Each test is rolled back.
