-- Go/no-go scoring: the facts the score needs, read from the RFP by the AI and
-- corrected or added by the proposal manager. Code scores; a person decides.
--
-- Facts are never overwritten: every reading or correction is a new row, and the
-- latest row for a name is the value used. So each correction keeps who made it and why.

create table rfp_fact (
  id             bigint generated always as identity primary key,
  rfp_id         bigint not null references rfp (id) on delete cascade,
  name           text not null check (name in (
                   'product_sought', 'category', 'buyer_kind', 'budget_per_year_usd',
                   'incumbent', 'staff_users', 'issued_on', 'relationship')),
  value          jsonb,                 -- json null: the RFP doesn't say
  quote          text,                  -- the RFP's own words the reading relies on
  page           int,
  source         text not null check (source in ('ai', 'person')),
  set_by         text,
  reason         text,
  model          text,
  prompt_version text,
  created_at     timestamptz not null default now(),

  -- The AI reads; it never answers the one question only the team can answer.
  constraint relationship_is_from_a_person check (name <> 'relationship' or source = 'person'),
  constraint ai_fact_is_traced check (source <> 'ai' or (model is not null and prompt_version is not null)),
  constraint person_fact_is_named check (source <> 'person' or coalesce(trim(set_by), '') <> ''),
  -- Correcting what the RFP says needs a reason; answering the relationship question does not.
  constraint correction_has_reason check (
    source <> 'person' or name = 'relationship' or coalesce(trim(reason), '') <> ''
  )
);

create index rfp_fact_rfp_id_idx on rfp_fact (rfp_id, name, created_at desc);

alter table rfp_fact enable row level security;

-- The decision is recorded once, with the score it was made on.
alter table rfp add constraint decision_has_score check (
  decision is null or (go_no_go_score is not null and recommendation is not null and decided_at is not null)
);
