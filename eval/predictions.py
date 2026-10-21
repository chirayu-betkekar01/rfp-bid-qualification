"""The system's output for one RFP, in the shape the harness scores."""
from dataclasses import dataclass

import psycopg


@dataclass(frozen=True)
class PredictedRow:
    ref: str                        # rfp_section as extracted
    text: str
    mandatory: bool = False
    status: str | None = None       # draft.suggested_status; None if not drafted yet
    cited_ids: tuple[str, ...] = ()
    flags: tuple[str, ...] = ()
    risk_tier: str | None = None
    answer_text: str = ""
    model: str | None = None
    prompt_version: str | None = None


LATEST_RFP = "select id from rfp where source_file = %s order by received_at desc, id desc limit 1"

ROWS = """
select r.rfp_section, r.text, r.mandatory, d.suggested_status, d.cited_ids, d.flags,
       d.risk_tier, d.answer_text, d.model, d.prompt_version
from requirement r
left join lateral (
  select * from draft where draft.requirement_id = r.id order by drafted_at desc, id desc limit 1
) d on true
where r.rfp_id = %s
order by r.id
"""


def load_predictions(conn: psycopg.Connection, source_file: str) -> list[PredictedRow] | None:
    """Rows and latest drafts for the newest RFP with this source file; None if it was never run."""
    found = conn.execute(LATEST_RFP, (source_file,)).fetchone()
    if found is None:
        return None
    return [
        PredictedRow(ref=ref or "", text=text, mandatory=mandatory, status=status,
                     cited_ids=tuple(cited or ()), flags=tuple(flags or ()), risk_tier=risk,
                     answer_text=answer or "", model=model, prompt_version=prompt_version)
        for ref, text, mandatory, status, cited, flags, risk, answer, model, prompt_version
        in conn.execute(ROWS, (found[0],))
    ]


def load_recommendation(conn: psycopg.Connection, source_file: str) -> str | None:
    row = conn.execute("select recommendation from rfp where source_file = %s "
                       "order by received_at desc, id desc limit 1", (source_file,)).fetchone()
    return row[0] if row else None
