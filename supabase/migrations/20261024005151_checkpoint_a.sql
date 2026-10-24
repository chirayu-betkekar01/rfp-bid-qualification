-- Checkpoint A: the reviewer confirms the requirement list before drafting.
-- Every add, edit, merge and delete is kept in requirement_change, so the list
-- can be traced back to what the AI extracted.

alter table rfp
  add column requirements_confirmed_by text,
  add column requirements_confirmed_at timestamptz,
  add constraint requirements_confirmation_is_named check (
    (requirements_confirmed_by is null) = (requirements_confirmed_at is null)
  );

-- "No (scored)" rows are scored but not mandatory; a row cannot be both.
alter table requirement
  add constraint mandatory_or_scored check (not (mandatory and scored));

create table requirement_change (
  id             bigint generated always as identity primary key,
  rfp_id         bigint not null references rfp (id) on delete cascade,
  requirement_id bigint,                            -- no foreign key: deleted rows keep their history
  action         text not null check (action in ('add', 'edit', 'merge', 'delete', 'confirm', 'reopen')),
  before         jsonb,                             -- row(s) before the change; a merge stores all of them
  after          jsonb,
  reviewer       text not null check (lower(trim(reviewer)) not in ('ai', 'system', '')),
  reason         text,
  changed_at     timestamptz not null default now()
);

create index requirement_change_rfp_id_idx on requirement_change (rfp_id);

alter table requirement_change enable row level security;
