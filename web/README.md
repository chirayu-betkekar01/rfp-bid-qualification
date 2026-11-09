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
- **Go / no-go** (`/rfps/<id>/report`): the score, report and decision below.

## Signing in (`/login`)

A demo sign-in stands in for real accounts. Each person on the fictional team (from
`supabase/seed.sql`) signs in with an email made from their name, such as
`morgan.lee@tallyhouse.demo`, and one shared password, `tallyhouse`. The sign-in page lists every
account beside the form: click a row to fill it in, or **Sign in** to go straight in.

- The proposal manager lands on the RFP list; everyone else lands on the line items waiting for
  them. A link opened while signed out comes back to that page after signing in.
- The session is a signed cookie (HMAC, `lib/session.ts`), so changing it doesn't let you become
  someone else. Set `SESSION_SECRET` in `.env` to keep people signed in across server restarts.
- `proxy.ts` sends anyone without a session to `/login`; pages check the signature. Personal links
  (`/r/<token>`) and the RFP PDFs still open without signing in, so Slack links keep working.
- Whoever is signed in is the name saved with every change.

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

## Go / no-go (`/rfps/<id>/report`)

- **What the RFP says**: product and category, buyer kind, budget per year, staff users, current
  system and issue date, read by the AI (`prompts/rfp_facts_v1.md`) with the quote and page each
  rests on. The manager corrects any of them with a reason; the AI's reading is kept beside the
  correction (`rfp_fact` keeps every version). Extraction reads them; for an existing RFP run
  `python -m src.extract.facts --rfp <id>`.
- **Relationship**: the one question only the team can answer (spoke with the buyer before the RFP,
  pre-proposal meeting only, no contact).
- **Score**: code in `lib/scoring.ts` applies the rules in `config/vendor.yaml` to the submitted
  answers and the facts: product fit (Yes 1, Maybe 0.5, No 0 over functional and integration items),
  mandatory (−5 per No, −1 per Maybe with Maybes capped at −10), relationship, deal size vs. list price for the buyer's users,
  competitive position and effort vs. deadline. Each factor shows its inputs and any flag.
- **Hard fails** recommend no-bid whatever the points. An RFP outside Tallyhouse's categories is one
  straight away, and shows on the Overview before anything is sent out. A mandatory item answered No
  that mentions a known gap (FedRAMP, on-premises, HIPAA BAA, EU data residency, CJIS) is only a
  *possible* hard fail, because the words often come from boilerplate: the manager confirms it or
  dismisses it with a reason (`gap_check`), and the decision waits until each one is checked.
- **Report**: every No and Maybe with the expert's note, who answered what, and how often people
  agreed with the AI suggestion.
- **Decision**: bid or no-bid with a written reason, once every item has a submitted answer and the
  relationship question is answered (a hard fail can be decided straight away). It is recorded once,
  with the score and inputs it was made on; going against the recommendation is allowed and shown.

## Slack

Set `SLACK_WEBHOOK_URL` in the repo-root `.env` to an incoming webhook for a demo channel. Without
it, messages are still written to the `notification` table and shown as "not sent".

## Tests

`npm test` runs the data-layer tests in `tests/` against `TEST_DATABASE_URL`. Each test is rolled back.
