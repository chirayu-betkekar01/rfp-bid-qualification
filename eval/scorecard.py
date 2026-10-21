"""Compute the scorecard for one run against its answer key."""
from dataclasses import dataclass
from datetime import date

from eval.answer_key import KeyRow
from eval.match import MatchResult, match_rows
from eval.predictions import PredictedRow
from src.library.load import LibraryAnswer, is_stale

RECALL_TARGET = 0.90
STATUS_MATCH_TARGET = 0.80


@dataclass(frozen=True)
class Measure:
    name: str
    value: str
    target: str
    result: str                     # PASS | FAIL | REPORT | NOT RUN


@dataclass(frozen=True)
class Scorecard:
    predicted_rows: int
    matched: int
    recall: float | None
    precision: float | None
    status_match: float | None
    citation_overlap: float | None
    unflagged_traps: int
    unknown_citations: int
    needs_decision_ok: tuple[int, int] | None
    high_risk_ok: tuple[int, int] | None
    go_no_go: tuple[str | None, str] | None     # (actual, expected)
    match: MatchResult | None

    def measures(self) -> list[Measure]:
        m = [
            Measure("Recall", _pct(self.recall), f">= {RECALL_TARGET:.0%}",
                    _at_least(self.recall, RECALL_TARGET)),
            Measure("Precision", _pct(self.precision), "report", "REPORT"),
            Measure("Status match (matched rows)", _pct(self.status_match),
                    f">= {STATUS_MATCH_TARGET:.0%}", _at_least(self.status_match, STATUS_MATCH_TARGET)),
            Measure("Citation overlap", _pct(self.citation_overlap), "report", "REPORT"),
            Measure("Stale / unprofiled used without flag", str(self.unflagged_traps), "0",
                    "PASS" if self.unflagged_traps == 0 else "FAIL"),
            Measure("Needs-decision rows left empty", _of(self.needs_decision_ok), "all",
                    _all(self.needs_decision_ok)),
            Measure("High-risk rows routed to High", _of(self.high_risk_ok), "all",
                    _all(self.high_risk_ok)),
        ]
        if self.unknown_citations:
            m.append(Measure("Cited IDs not in library", str(self.unknown_citations), "0", "FAIL"))
        if self.go_no_go is None:
            m.append(Measure("Go/no-go", "n/a", "-", "NOT RUN"))
        else:
            actual, expected = self.go_no_go
            result = "NOT RUN" if actual is None else ("PASS" if actual == expected else "FAIL")
            m.append(Measure("Go/no-go", actual or "not scored", expected, result))
        return m

    @property
    def passed(self) -> bool:
        return all(m.result in ("PASS", "REPORT") for m in self.measures())


def score_run(key: list[KeyRow] | None, predicted: list[PredictedRow],
              library: list[LibraryAnswer], today: date,
              go_no_go: tuple[str | None, str] | None = None) -> Scorecard:
    unflagged, unknown = check_trap_flags(predicted, library, today)
    if not key:
        return Scorecard(len(predicted), 0, None, None, None, None, unflagged, unknown,
                         None, None, go_no_go, None)

    match = match_rows(key, predicted)
    pred_for_key = {p.key_index: predicted[p.pred_index] for p in match.matched}
    pairs = [(key[ki], pred) for ki, pred in pred_for_key.items()]

    status_hits = sum(pred.status == k.expected_status for k, pred in pairs)
    overlaps = [_jaccard(set(k.library_sources), set(pred.cited_ids))
                for k, pred in pairs if k.library_sources or pred.cited_ids]

    def ok(ki: int, test) -> bool:
        pred = pred_for_key.get(ki)
        return pred is not None and test(pred)

    needs = [i for i, k in enumerate(key) if k.expected_status == "Needs decision"]
    needs_ok = sum(ok(i, lambda p: p.status == "Needs decision" and not p.answer_text.strip())
                   for i in needs)
    high = [i for i, k in enumerate(key) if k.risk == "High"]
    high_ok = sum(ok(i, lambda p: p.risk_tier == "High") for i in high)

    return Scorecard(
        predicted_rows=len(predicted),
        matched=len(pairs),
        recall=len(pairs) / len(key),
        precision=len(pairs) / len(predicted) if predicted else None,
        status_match=status_hits / len(pairs) if pairs else None,
        citation_overlap=sum(overlaps) / len(overlaps) if overlaps else None,
        unflagged_traps=unflagged,
        unknown_citations=unknown,
        needs_decision_ok=(needs_ok, len(needs)),
        high_risk_ok=(high_ok, len(high)),
        go_no_go=go_no_go,
        match=match,
    )


def check_trap_flags(predicted: list[PredictedRow], library: list[LibraryAnswer],
                     today: date) -> tuple[int, int]:
    """Count cited stale / unprofiled answers missing their flag (rule 2), and unknown IDs."""
    by_id = {a.id: a for a in library}
    unflagged = unknown = 0
    for row in predicted:
        for cid in row.cited_ids:
            answer = by_id.get(cid)
            if answer is None:
                unknown += 1
                continue
            if is_stale(answer, today) and "stale_source" not in row.flags:
                unflagged += 1
            if answer.unprofiled and "unprofiled_source" not in row.flags:
                unflagged += 1
    return unflagged, unknown


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.1%}"


def _of(x: tuple[int, int] | None) -> str:
    return "n/a" if x is None else f"{x[0]} of {x[1]}"


def _at_least(x: float | None, target: float) -> str:
    return "FAIL" if x is None or x < target else "PASS"


def _all(x: tuple[int, int] | None) -> str:
    return "NOT RUN" if x is None else ("PASS" if x[0] == x[1] else "FAIL")
