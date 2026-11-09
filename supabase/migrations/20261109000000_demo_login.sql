-- Demo sign-in: each person signs in with an email address. The team is fictional, so the
-- address is made from the name ("Morgan Lee" -> morgan.lee@tallyhouse.demo) when none is given.
-- There is no password column: the demo uses one shared password, shown on the sign-in page.

create function person_demo_email(name text) returns text
language sql immutable as $$
  select trim(both '.' from regexp_replace(lower(name), '[^a-z0-9]+', '.', 'g')) || '@tallyhouse.demo'
$$;

alter table person add column email text;
update person set email = person_demo_email(name);
alter table person alter column email set not null;
create unique index person_email_key on person (lower(email));

create function person_fill_email() returns trigger
language plpgsql as $$
begin
  if new.email is null then
    new.email := person_demo_email(new.name);
  end if;
  return new;
end;
$$;

create trigger person_fill_email before insert on person
  for each row execute function person_fill_email();
