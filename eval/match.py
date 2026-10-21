"""Match extracted rows to answer-key rows by section reference plus text similarity.

Pairs are assigned one-to-one, best score first. Weights and thresholds are
starting values, to be tuned on real extraction output.
"""
import re
from dataclasses import dataclass

from eval.answer_key import KeyRow
from eval.predictions import PredictedRow

REF_WEIGHT, TEXT_WEIGHT = 0.4, 0.6
MATCH_THRESHOLD = 0.5
BORDERLINE_MARGIN = 0.1     # pairs this close to the threshold are printed for checking

STOPWORDS = set("""a an and are as at be by can for from has have in is it its of on or our
shall should that the their this to will with your you must any all each other such than""".split())


@dataclass(frozen=True)
class Pair:
    key_index: int
    pred_index: int
    score: float
    ref_score: float
    text_score: float


@dataclass(frozen=True)
class MatchResult:
    matched: list[Pair]             # accepted, one-to-one
    borderline: list[Pair]          # accepted or rejected, within the margin of the threshold


def words(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {t[:-1] if len(t) > 3 and t.endswith("s") else t for t in tokens if t not in STOPWORDS}


def ref_score(a: str, b: str) -> float:
    a, b = a.strip().casefold(), b.strip().casefold()
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a.startswith(b + ".") or b.startswith(a + "."):
        return 0.5                  # parent and child, e.g. IV.A and IV.A.1
    return 0.0


def text_score(a: str, b: str) -> float:
    """Share of the shorter text's words found in the other; Jaccard for very short texts."""
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    common = len(wa & wb)
    if min(len(wa), len(wb)) < 4:
        return common / len(wa | wb)
    return common / min(len(wa), len(wb))


def match_rows(key: list[KeyRow], predicted: list[PredictedRow]) -> MatchResult:
    pairs = []
    for ki, k in enumerate(key):
        for pi, p in enumerate(predicted):
            rs, ts = ref_score(k.rfp_section, p.ref), text_score(k.requirement, p.text)
            score = REF_WEIGHT * rs + TEXT_WEIGHT * ts
            if score >= MATCH_THRESHOLD - BORDERLINE_MARGIN:
                pairs.append(Pair(ki, pi, round(score, 3), rs, round(ts, 3)))
    pairs.sort(key=lambda p: (-p.score, p.key_index, p.pred_index))

    matched, used_keys, used_preds = [], set(), set()
    for pair in pairs:
        if pair.score >= MATCH_THRESHOLD and pair.key_index not in used_keys and pair.pred_index not in used_preds:
            matched.append(pair)
            used_keys.add(pair.key_index)
            used_preds.add(pair.pred_index)

    # Borderline: weak accepted matches, plus the best near-miss for each unmatched key row.
    borderline = [p for p in matched if p.score < MATCH_THRESHOLD + BORDERLINE_MARGIN]
    for pair in pairs:
        if pair.score < MATCH_THRESHOLD and pair.key_index not in used_keys and pair.pred_index not in used_preds:
            borderline.append(pair)
            used_keys.add(pair.key_index)
    return MatchResult(matched=sorted(matched, key=lambda p: p.key_index), borderline=borderline)
