-- Bid qualification: the proposal manager routes each section or line item to an
-- expert, experts answer Yes / No / Maybe with a note (or forward the item), and
-- code scores the answers for the go/no-go decision. The AI only suggests.

-- People ---------------------------------------------------------------------
-- No login yet: each person opens their own items through a personal link.

create table person (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  role          text not null,
  link_token    text not null unique default replace(gen_random_uuid()::text, '-', ''),
  slack_user_id text,
  active        boolean not null default true
);


-- Sections -------------------------------------------------------------------
-- The top-level parts of an RFP ("IV", "Exhibit B"), in document order.

create table rfp_section (
  id          bigint generated always as identity primary key,
  rfp_id      bigint not null references rfp (id) on delete cascade,
  ref         text not null,
  title       text not null,
  position    integer not null,
  assignee_id bigint references person (id),
  unique (rfp_id, ref)
);

alter table requirement
  add column section_id  bigint references rfp_section (id) on delete set null,
  add column assignee_id bigint references person (id);

create index requirement_section_id_idx on requirement (section_id);
create index requirement_assignee_id_idx on requirement (assignee_id);


-- Answers ---------------------------------------------------------------------

create domain fit_answer as text check (value in ('Yes', 'No', 'Maybe'));

-- AI output. Shown beside the item, never copied into an answer.
create table ai_suggestion (
  id             bigint generated always as identity primary key,
  requirement_id bigint not null references requirement (id) on delete cascade,
  answer         fit_answer,                         -- null: nothing in the library covers this
  reason         text not null,
  cited_ids      text[] not null default '{}',
  flags          text[] not null default '{}',       -- stale_source, unprofiled_source, hard_fail_gap:<name>, soft_gap:<name>
  model          text not null,
  prompt_version text not null,
  created_at     timestamptz not null default now(),

  -- No library source means no suggestion.
  constraint no_source_no_suggestion check ((answer is null) = (cardinality(cited_ids) = 0))
);

create index ai_suggestion_requirement_id_idx on ai_suggestion (requirement_id);

-- One answer per line item, from the person who holds it.
create table line_response (
  id             bigint generated always as identity primary key,
  requirement_id bigint not null unique references requirement (id) on delete cascade,
  person_id      bigint not null references person (id),
  answer         fit_answer not null,
  note           text,
  suggestion_id  bigint references ai_suggestion (id) on delete set null,  -- the suggestion on screen when answering
  status         text not null default 'draft' check (status in ('draft', 'submitted')),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,

  constraint note_for_no_or_maybe check (answer = 'Yes' or coalesce(trim(note), '') <> ''),
  constraint submitted_has_time check ((status = 'submitted') = (submitted_at is not null))
);

-- An expert who can't answer passes the item to someone who can.
create table forward (
  id             bigint generated always as identity primary key,
  requirement_id bigint not null references requirement (id) on delete cascade,
  from_person_id bigint not null references person (id),
  to_person_id   bigint not null references person (id),
  note           text,
  forwarded_at   timestamptz not null default now(),
  constraint forward_to_someone_else check (from_person_id <> to_person_id)
);

create index forward_requirement_id_idx on forward (requirement_id);


-- Sending out and Slack ------------------------------------------------------

alter table rfp
  add column sent_out_at      timestamptz,
  add column sent_out_by      text,
  add column responses_due_at timestamptz,
  add constraint sent_out_is_named check ((sent_out_at is null) = (sent_out_by is null));

create table notification (
  id        bigint generated always as identity primary key,
  rfp_id    bigint not null references rfp (id) on delete cascade,
  person_id bigint references person (id),
  kind      text not null check (kind in ('send_out', 'forwarded', 'reassigned', 'nudge', 'all_done')),
  text      text not null,
  sent_at   timestamptz not null default now(),
  ok        boolean not null,
  error     text
);


-- Change log -----------------------------------------------------------------

alter table requirement_change drop constraint requirement_change_action_check;
alter table requirement_change add constraint requirement_change_action_check check (action in (
  'add', 'edit', 'merge', 'delete', 'confirm', 'reopen', 'assign', 'answer', 'forward', 'send_out'
));


alter table person        enable row level security;
alter table rfp_section   enable row level security;
alter table ai_suggestion enable row level security;
alter table line_response enable row level security;
alter table forward       enable row level security;
alter table notification  enable row level security;
