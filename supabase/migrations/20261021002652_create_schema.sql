-- Tallyhouse RFP Response System: initial schema.
-- Tables follow the data model in CLAUDE.md. Constraints enforce the rules the
-- database can check on its own; the rest is enforced in application code.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Status values shared by drafts and review decisions.
create domain compliance_status as text check (value in (
  'Fully compliant', 'Partially compliant', 'Via integration',
  'Not compliant', 'Needs decision', 'Admin'
));

create domain risk_tier as text check (value in ('Low', 'Medium', 'High'));


-- Library ------------------------------------------------------------------
-- Loaded from data/library.csv. Code upserts here but never writes the CSV (rule 7).

create table library_answer (
  id              text primary key,                 -- e.g. SEC-015
  category        text not null,
  question        text not null,
  answer          text not null,
  answer_type     text not null check (answer_type in
                    ('Yes', 'No', 'Partial', 'Via integration', 'Narrative')),
  source_section  text not null,
  owner           text not null,
  last_reviewed   date not null,
  status          text not null check (status in ('Current', 'Stale')),
  tags            text[] not null default '{}',
  -- Dimension left open until the embedding model is chosen (open decision).
  embedding       extensions.vector,
  embedding_model text,
  synced_at       timestamptz not null default now()
);


-- RFP ----------------------------------------------------------------------

create table rfp (
  id               bigint generated always as identity primary key,
  buyer            text not null,
  title            text not null,
  source_file      text not null,
  due_date         timestamptz,
  received_at      timestamptz not null default now(),
  go_no_go_score   numeric(5, 2) check (go_no_go_score between 0 and 100),
  score_breakdown  jsonb,                           -- every factor's inputs and points
  recommendation   text check (recommendation in ('bid', 'no_bid')),  -- from code
  decision         text check (decision in ('bid', 'no_bid')),        -- from a human
  decided_by       text,
  decision_reason  text,
  decided_at       timestamptz,
  signed_off_by    text,                            -- Checkpoint D attestation
  signed_off_at    timestamptz,
  outcome          text,

  -- Checkpoint B: a bid decision always has a named reviewer and a written reason.
  constraint decision_has_reviewer_and_reason check (
    decision is null
    or (decided_by is not null and coalesce(trim(decision_reason), '') <> '')
  ),
  constraint sign_off_is_named check ((signed_off_by is null) = (signed_off_at is null)),
  constraint sign_off_requires_bid check (signed_off_by is null or decision = 'bid')
);


-- Requirements -------------------------------------------------------------

create table requirement (
  id          bigint generated always as identity primary key,
  rfp_id      bigint not null references rfp (id) on delete cascade,
  req_ref     text not null,                        -- e.g. T-001
  rfp_section text,                                 -- e.g. IV.A
  text        text not null,
  type        text not null,
  mandatory   boolean not null default false,
  scored      boolean not null default false,       -- "No (scored)" in the answer key
  page        integer,
  created_by  text not null check (created_by in ('ai', 'reviewer')),
  unique (rfp_id, req_ref)
);

create index requirement_rfp_id_idx on requirement (rfp_id);


-- Drafts -------------------------------------------------------------------
-- AI output. Only suggested_status lives here; final status is set by a human
-- in review_decision (rule 3).

create table draft (
  id               bigint generated always as identity primary key,
  requirement_id   bigint not null references requirement (id) on delete cascade,
  answer_text      text,
  retrieved_ids    text[] not null,
  cited_ids        text[] not null,
  suggested_status compliance_status not null,
  confidence       text not null check (confidence in
                     ('high', 'medium', 'low', 'needs_decision')),
  risk_tier        risk_tier not null,
  flags            text[] not null default '{}',     -- e.g. stale_source, unprofiled_source
  model            text not null,                    -- traceability (rule 6)
  prompt_version   text not null,
  drafted_at       timestamptz not null default now(),

  -- Rule 6: a draft can only cite what it retrieved.
  constraint cited_subset_of_retrieved check (cited_ids <@ retrieved_ids),
  -- Rule 1: no source means no answer; needs-decision rows are left empty.
  constraint no_source_no_answer check (
    (cardinality(cited_ids) > 0 and suggested_status <> 'Needs decision')
    or coalesce(answer_text, '') = ''
  ),
  constraint needs_decision_confidence check (
    (confidence = 'needs_decision') = (suggested_status = 'Needs decision')
  )
);

create index draft_requirement_id_idx on draft (requirement_id);


-- Review decisions ---------------------------------------------------------

create table review_decision (
  id               bigint generated always as identity primary key,
  requirement_id   bigint not null references requirement (id) on delete cascade,
  reviewer         text not null check (lower(reviewer) not in ('ai', 'system', '')),
  action           text not null check (action in ('approve', 'edit', 'reject', 'reassign')),
  final_text       text,
  final_status     compliance_status,
  claims_checked   jsonb not null default '[]',
  reason           text,
  is_planted_error boolean not null default false,
  caught           boolean,                          -- set only for planted errors
  second_approver  text,
  seconds_on_row   numeric(8, 1) check (seconds_on_row >= 0),
  decided_at       timestamptz not null default now(),

  constraint caught_only_for_planted check (is_planted_error or caught is null),
  constraint second_approver_differs check (
    second_approver is null or second_approver <> reviewer
  )
);

create index review_decision_requirement_id_idx on review_decision (requirement_id);


-- Library proposals --------------------------------------------------------
-- Edits made during review go to the library owner as proposals (rule 7).

create table library_proposal (
  id             bigint generated always as identity primary key,
  library_id     text references library_answer (id),  -- null for a brand-new answer
  proposed_text  text not null,
  proposed_by    text not null,
  source_rfp_id  bigint references rfp (id),
  status         text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at     timestamptz not null default now()
);


-- Supabase exposes the public schema through its REST API. Turning on row-level
-- security with no policies blocks all API access; the app connects directly
-- as the database owner, which bypasses RLS.

alter table library_answer   enable row level security;
alter table rfp              enable row level security;
alter table requirement      enable row level security;
alter table draft            enable row level security;
alter table review_decision  enable row level security;
alter table library_proposal enable row level security;
