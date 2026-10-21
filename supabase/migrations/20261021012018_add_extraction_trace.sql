-- Record which model and prompt extracted each RFP's requirement list, as drafts already do.

alter table rfp
  add column extract_model          text,
  add column extract_prompt_version text,
  add column extracted_at           timestamptz,
  add constraint extraction_is_traceable check (
    (extracted_at is null) = (extract_model is null)
    and (extract_model is null) = (extract_prompt_version is null)
  );
