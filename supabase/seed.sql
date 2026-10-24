-- Fictional Tallyhouse team for the demo. Roles match the owner names in
-- data/library.csv and data/tulsa_matrix.csv. Runs on `npx supabase db reset`.

insert into person (name, role) values
  ('Morgan Lee',   'Proposal Manager'),
  ('Priya Shah',   'Solutions Engineering'),
  ('Sam Okafor',   'Security'),
  ('Elena Ruiz',   'Legal'),
  ('Dana Kim',     'Deal Desk'),
  ('Theo Novak',   'Professional Services'),
  ('Ava Brooks',   'Customer Support'),
  ('Jordan Patel', 'Product Marketing'),
  ('Riley Chen',   'Public Sector Team')
on conflict (name) do nothing;
