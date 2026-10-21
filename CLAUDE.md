# Tallyhouse RFP Response System

A portfolio project that cuts the time to **draft** B2B vendor RFP responses, while a human reviewer keeps full control of every decision. AI drafts; people decide. The only value claimed is less drafting time, so review time is always measured separately and never counted as savings.

The vendor is fictional: **Tallyhouse CRM, Inc.**, a mid-market CRM with a Public Sector Edition. All vendor facts below are the single source of truth for code and tests.

Full brief (human-readable): https://claude.ai/code/artifact/e308f390-d6c0-4328-b297-836c87528f30
Vendor profile: https://claude.ai/code/artifact/71a8d298-e02f-46e5-a647-24848c2939aa

---

## Non-negotiable rules

These hold in every component. Write tests for each one.

1. Drafts use **only** retrieved library text. No source means no answer: the row is marked `needs_decision` and the answer is left empty.
2. Library rows with status `Stale` are never used without a visible `stale_source` flag on the draft.
3. The AI never sets a final status, never approves a row, never makes the bid decision and never triggers export.
4. Export is blocked until every row has a human decision, every planted error has been rejected, and the reviewer has signed off.
5. Planted errors exist only in the review screen. They are stripped before export and can never reach an output file.
6. Every draft stores its model, prompt version, retrieved library IDs and cited library IDs, so any answer can be traced.
7. Code never writes to `data/library.csv`. Owners edit the library in Google Sheets and re-export the CSV. Edits made during review are saved as **proposals** for the owner, never silent overwrites.
8. The CAIQ file and any real buyer contact details never go in the repository.
9. Secrets live in environment variables only. Never commit `.env`.

---

## Flow and human checkpoints

```
Intake -> Extract (AI) -> [A] -> Draft every row (AI) -> Go/no-go score (code) -> [B] -> Line-by-line review -> [C] -> Sign-off [D] -> Export + log outcome
```

| Step | Who | What happens |
|---|---|---|
| Intake | Code | Parse PDF / DOCX / XLSX into text with section and page references; create an `rfp` record |
| Extract | AI | One row per requirement, deadline, evaluation criterion and mandatory form, with RFP section reference |
| **Checkpoint A** | Reviewer | Confirm the requirement list: add, edit, merge, delete rows; fix the mandatory flag |
| Draft | AI | For every row: retrieve current library answers, draft from them only, cite IDs, suggest status, confidence, risk tier, flags |
| Go/no-go | Code | Hard-fail check, then 0-100 score from fixed rules (below) |
| **Checkpoint B** | Reviewer | See the score breakdown, correct any input, decide bid / no-bid with a written reason. No-bid stops here |
| **Checkpoint C** | Reviewer | Approve, edit, reject or reassign every row; set final status. Friction scales with risk tier |
| **Checkpoint D** | Reviewer | Attest "I reviewed every line item in this response", then export |

Drafting runs **before** the bid decision because machine drafting is cheap; the expensive step is human review, which only happens if the reviewer decides to bid.

---

## Stack

| Concern | Choice |
|---|---|
| Language | Python 3.11+ |
| LLM calls | **OpenRouter API** (OpenAI-compatible chat completions endpoint). Use structured JSON output for extraction and drafting |
| Embeddings | Via OpenRouter if the chosen provider supports it, otherwise a local sentence-transformers model. Decide in week 1 |
| Database | Postgres with pgvector (Supabase or local Docker) |
| Library source | CSV snapshot in `data/library.csv` (exported from Google Sheets). A live Sheets sync is a later upgrade, not week 1 |
| Parsing | pdfplumber, python-docx, openpyxl |
| Review app | Streamlit (default; Next.js is an open decision) |
| Export | python-docx, openpyxl |
| Tests | pytest |

Only two places call an LLM: **Extract** and **Draft** (plus a small category classifier used by go/no-go). Everything else is deterministic code.

### Environment variables

```
OPENROUTER_API_KEY=
OPENROUTER_EXTRACT_MODEL=
OPENROUTER_DRAFT_MODEL=
DATABASE_URL=
```

Prefer OpenRouter providers that do not retain or train on prompt data (provider routing settings).

### Suggested layout

```
rfp-system/
  CLAUDE.md
  config/vendor.yaml          # pricing, known gaps, scorecard weights (from this file)
  prompts/                    # versioned prompt files: extract_v1.md, draft_v1.md ...
  src/
    parse/                    # pdf, docx, xlsx -> text + section refs
    extract/
    library/                  # CSV load, embeddings, stale flags
    retrieve/
    draft/
    scoring/                  # go/no-go
    review/                   # streamlit app
    export/
    db/                       # schema + migrations
  eval/                       # harness, answer key loader, run log
  data/
    library.csv               # 97 approved answers (snapshot of the Library tab)
    tulsa_matrix.csv          # 94-row answer key (snapshot of the Tulsa Matrix tab)
    test_rfps/                # public RFP PDFs (not CAIQ)
  tests/
```

---

## Inputs

### Content library (`data/library.csv`)

A snapshot of the Library tab of the owners' Google Sheet
(https://docs.google.com/spreadsheets/d/1CmSNUPqzvnOg3R5CywCjiK68cAHUxG0HOHOSZEwpTbo/edit).
UTF-8, comma-separated, standard quoting. 97 rows.

Columns: `id, category, question, answer, answer_type, source_section, owner, last_reviewed, tags`
- `answer_type`: `Yes | No | Partial | Via integration | Narrative`
- `last_reviewed`: ISO date `YYYY-MM-DD`
- ID prefixes: COM, PRD, PUB, INT, SEC, HOST, IMP, SUP, PRC, LEG, ACC, REF
- There is **no status column**. Code computes stale: `today - last_reviewed > review_cycle_days` (from `config/vendor.yaml`). Pass "today" in as a parameter so tests are repeatable; with today = 2026-10-17 exactly four rows are stale.

### Answer key (`data/tulsa_matrix.csv`)

A snapshot of the Tulsa Matrix tab. See Evaluation for columns.

Deliberate traps in the library. The system must flag these, never reuse them silently:

| ID | Trap |
|---|---|
| SEC-015 | Stale, says TLS 1.0 (current answer SEC-005 says TLS 1.2+) |
| HOST-007 | Stale, says AWS only (current: AWS, Azure or Google Cloud) |
| PRC-006 | Stale, says $80/user/month (current: $90) |
| SUP-004 | Stale by date but content still correct |
| LEG-005, LEG-006, ACC-002, ACC-003 | Source section is "Not in vendor profile": flag `unprofiled_source` |

### Test documents

| Document | Expected go/no-go |
|---|---|
| City of Tulsa RFP 26-901, Constituent CRM — https://cityoftulsa.org/media/28516/rfp-26-901-constituent-relationship-management-software.pdf | No-bid by score (about 47) |
| City of Asheville, Service Request Management — https://evp.nc.gov/_entity/annotation/f722d2ec-4f21-f111-8342-001dd803db57/api | Bid candidate |
| UTEP RFP 724-2605, Planning & Scheduling Software — https://www.utep.edu/purchasing-and-general-services/pgs-departments/purchasing/RFPs/Plannning-Scheduling-Software---RFP-724-2605-JBT.pdf | Hard fail: out of category |
| CSA CAIQ v4 (download manually; personal use only; keep out of git) | Security questionnaire run |

---

## Vendor facts the code needs (`config/vendor.yaml`)

```yaml
vendor: Tallyhouse CRM, Inc.
category: [crm, customer_service, constituent_service_311]
pricing:
  professional_per_user_month: 90      # up to 250 users, no custom objects
  enterprise_per_user_month: 150
  public_sector_platform_fee_year: 30000
  public_sector_per_staff_user_year: 1200
  implementation_one_time: [25000, 120000]
  multi_year_discount: {2: 0.10, 3: 0.15}
implementation_weeks: {commercial: [8, 12], public_sector: [12, 16]}
hosting: {clouds: [aws, azure, gcp], regions: us_only}
hard_fail_gaps:            # any of these as a MANDATORY requirement = automatic no-bid
  - fedramp
  - on_premises_or_private_cloud
  - hipaa_baa
  - eu_data_residency
  - cjis
soft_gaps:                 # answer honestly, flag for review
  - stateramp_in_progress_q2_2027
  - no_native_telephony_via_twilio
  - breach_notice_72_hours
csm_included_above_arr: 50000
review_cycle_days: 365     # library answers older than this are Stale
```

---

## Go/no-go scoring

AI reads, code scores, a human decides. The AI only extracts facts (budget, incumbent, product category) and the per-row statuses come from drafting. The same inputs must always give the same score.

**Pass 1, hard fails.** Automatic no-bid recommendation if the RFP is outside `category`, or any mandatory requirement maps to a `hard_fail_gaps` item.

**Pass 2, 100 points.** Recommend bid at **65 or above**.

| Factor | Points | Rule |
|---|---|---|
| Product fit | 30 | Mean over functional + integration rows: Fully compliant 1, Via integration 0.75, Partially compliant 0.5, Needs decision 0.25, Not compliant 0; times 30 |
| Mandatory requirements | 20 | 20 minus 5 per mandatory row Not compliant, minus 1 per mandatory row Needs decision; floor 0 |
| Relationship | 15 | Reviewer input: spoke with buyer before RFP 15; pre-proposal meeting only 8; none 0 |
| Deal size vs budget | 15 | Budget >= list price 15; up to 25% below 8; more than 25% below 0 + flag. Unknown budget 8 + flag |
| Competitive position | 10 | None or legacy incumbent 10; HubSpot or Zendesk 6; Salesforce or Dynamics 3; unknown 5 |
| Effort vs deadline | 10 | >= 14 days and < 150 requirements 10; 7-13 days or 150-300 requirements 5; else 0 |

Store every factor's inputs and points so the Checkpoint B screen can show the full breakdown. Every reviewer correction or override is logged with a reason.

---

## Draft confidence and risk tier

**Confidence** (per draft): `high` only if the top retrieved answer is a strong match, is `Current`, is backed by the vendor profile, and a self-check confirms the draft adds nothing beyond its sources. Otherwise `medium` or `low`. No usable source: `needs_decision`, empty answer.

**Risk tier** (rules, not AI):
- **High**: category SEC, LEG or PRC; any `No` answer type; mandatory row; stale, unsourced or unprofiled source
- **Medium**: `Partial` or `Via integration`; product capability claims
- **Low**: everything else

---

## Review rules

| Tier | Reviewer must |
|---|---|
| Low | Open the row and view its source, then approve |
| Medium | Tick each highlighted claim (numbers, yes/no, dates) against the source text shown beside it |
| High | Edit, or type a reason for approving. Mandatory + Not compliant needs a second approver |

Controls against rubber-stamping: no bulk approve; claim checking; planted errors (export locked until each is rejected); speed flags on fast high-risk approvals (log only, do not block); named sign-off on every row and the final attestation. Reviewer metrics: edit rate, planted-error catch rate, post-submission errors. Never score reviewers on speed.

---

## Data model

| Table | Key fields |
|---|---|
| `library_answer` | id, category, question, answer, answer_type, source_section, owner, last_reviewed, status, tags, embedding, synced_at |
| `rfp` | id, buyer, title, source_file, due_date, received_at, go_no_go_score, score_breakdown (json), recommendation, decision, decided_by, decision_reason, outcome |
| `requirement` | id, rfp_id, req_ref, rfp_section, text, type, mandatory, page, created_by (ai or reviewer) |
| `draft` | id, requirement_id, answer_text, retrieved_ids, cited_ids, suggested_status, confidence, risk_tier, flags, model, prompt_version, drafted_at |
| `review_decision` | id, requirement_id, reviewer, action, final_text, final_status, claims_checked, reason, is_planted_error, caught, second_approver, seconds_on_row, decided_at |
| `library_proposal` | id, library_id, proposed_text, proposed_by, source_rfp_id, status (open, accepted, rejected) |

Status values: `Fully compliant | Partially compliant | Via integration | Not compliant | Needs decision | Admin`. Risk tiers: `Low | Medium | High`.

---

## Evaluation harness

`data/tulsa_matrix.csv` is the answer key: 94 rows, columns
`req_id, rfp_section, requirement, type, mandatory, expected_status, library_sources, reviewer_guidance, risk, owner`.
`library_sources` is a comma-separated list of library IDs, or `None`. `mandatory` is `Yes`, `No` or `No (scored)`.
Expected counts: 52 Fully, 15 Partially, 2 Via integration, 2 Not compliant, 12 Needs decision, 11 Admin; 22 High risk.

`python -m eval.run --rfp tulsa` prints one scorecard and appends it to `eval/runs.csv`:

| Measure | Target |
|---|---|
| Recall (answer-key rows matched) | >= 90% |
| Precision (extracted rows that match a key row) | report |
| Status match on matched rows | >= 80% |
| Citation overlap with expected sources | report |
| Stale / unprofiled sources used without a flag | 0 |
| The 12 needs-decision rows left empty and flagged | 12 of 12 |
| The 22 high-risk rows routed to High tier | 22 of 22 |
| Go/no-go on all four test documents | matches expected |

Match extracted rows to key rows by section reference plus text similarity; print borderline pairs for manual checking.

---

## Build plan

| Week | Build | Done when |
|---|---|---|
| 1 | Repo, DB schema, library load from CSV with embeddings and stale flags, PDF parser, eval harness skeleton | 97 rows load with correct Stale flags; Tulsa PDF parses with section refs; harness runs on an empty result |
| 2 | Extraction + Checkpoint A screen | Tulsa recall >= 90%; reviewer can add, edit, merge, delete rows |
| 3 | Retrieval, drafting every row, go/no-go scorer + Checkpoint B screen | Every row cited or needs_decision; traps flagged; status match >= 80%; Tulsa < 65, UTEP hard-fails; overrides logged |
| 4 | Checkpoint C review (claims, planted errors, risk friction) + Checkpoint D sign-off + Word/Excel export | Full Tulsa review completes; export blocked until all rows decided and planted errors caught |
| 5 | Dashboard (drafting vs review time, accuracy, outcomes), CAIQ run, demo, write-up | Dashboard live; 6-minute demo recorded; case study published |

## Start here

Week 1, in this order:
1. Scaffold the layout above, `pyproject.toml`, `.env.example`, `.gitignore` (include `.env`, `data/caiq*`).
2. Write `config/vendor.yaml` from this file.
3. DB schema and migration for the tables above.
4. Library load: read `data/library.csv`, compute stale flags and embeddings, upsert into `library_answer`. Test: 97 rows; with today = 2026-10-17, exactly SEC-015, HOST-007, PRC-006 and SUP-004 are Stale.
5. PDF parser for the Tulsa RFP with section references. Test against known sections (IV.A, VIII.X, Exhibit B).
6. Eval harness that loads `data/tulsa_matrix.csv` and scores an empty run. Test: 94 rows, 22 High risk, status counts as listed in Evaluation, and every ID in `library_sources` exists in `data/library.csv`.

Commit after each step with a clear message.

---

## Conventions

- Prompts live in `prompts/` as versioned files; never inline long prompts in code. Record `prompt_version` on every model call.
- Every LLM call goes through one wrapper (`src/llm.py`) that handles OpenRouter auth, retries, JSON validation and logging.
- Run `pytest` and the eval harness before every commit that touches extraction, drafting or scoring.
- Keep functions small and typed. Plain language in UI copy.

## Open decisions

- [ ] Streamlit or Next.js for the review app
- [ ] HubSpot free CRM or a Sheets tab for pipeline tracking
- [ ] Planted-error rate per RFP and which kinds (wrong number, flipped yes/no, stale source)
- [ ] Speed-flag threshold in seconds for high-risk rows
- [ ] Source for the 20-30 hour manual drafting baseline
- [ ] Tulsa demo: show the system declining, or the reviewer overriding to bid a smaller plan
- [ ] OpenRouter models for extraction and drafting; embedding approach; provider data-retention settings
- [ ] Repository name and public from day one or not
- [ ] Later upgrade: replace the CSV snapshot with a live Google Sheets sync (service account, read-only)
