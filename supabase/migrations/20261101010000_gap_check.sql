-- A mandatory item answered No that mentions a known hard-fail gap (FedRAMP, CJIS ...) is only a
-- possible hard fail: the words can come from boilerplate ("comply with all applicable laws,
-- including CJIS"). The proposal manager confirms or dismisses each one; dismissing needs a reason.
-- The latest row for an item is the one that counts.

create table gap_check (
  id             bigint generated always as identity primary key,
  rfp_id         bigint not null references rfp (id) on delete cascade,
  requirement_id bigint not null references requirement (id) on delete cascade,
  is_hard_fail   boolean not null,
  set_by         text not null check (trim(set_by) <> '' and lower(trim(set_by)) not in ('ai', 'system')),
  reason         text,
  created_at     timestamptz not null default now(),
  constraint dismissal_has_reason check (is_hard_fail or coalesce(trim(reason), '') <> '')
);

create index gap_check_rfp_id_idx on gap_check (rfp_id, requirement_id, created_at desc);

alter table gap_check enable row level security;
