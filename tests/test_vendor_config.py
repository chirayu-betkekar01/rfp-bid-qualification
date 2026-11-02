"""config/vendor.yaml matches the vendor facts and scoring rules in CLAUDE.md."""
from pathlib import Path

import yaml

CONFIG = yaml.safe_load(
    (Path(__file__).resolve().parent.parent / "config" / "vendor.yaml").read_text()
)


def test_vendor_and_category() -> None:
    assert CONFIG["vendor"] == "Tallyhouse CRM, Inc."
    assert CONFIG["category"] == ["crm", "customer_service", "constituent_service_311"]


def test_pricing() -> None:
    p = CONFIG["pricing"]
    assert p["professional_per_user_month"] == 90
    assert p["enterprise_per_user_month"] == 150
    assert p["public_sector_platform_fee_year"] == 30000
    assert p["public_sector_per_staff_user_year"] == 1200
    assert p["implementation_one_time"] == [25000, 120000]
    assert p["multi_year_discount"] == {2: 0.10, 3: 0.15}


def test_hosting_and_cycle() -> None:
    assert CONFIG["hosting"] == {"clouds": ["aws", "azure", "gcp"], "regions": "us_only"}
    assert CONFIG["review_cycle_days"] == 365
    assert CONFIG["csm_included_above_arr"] == 50000


def test_gaps_have_phrases() -> None:
    assert set(CONFIG["hard_fail_gaps"]) == {
        "fedramp", "on_premises_or_private_cloud", "hipaa_baa", "eu_data_residency", "cjis",
    }
    assert set(CONFIG["soft_gaps"]) == {
        "stateramp_in_progress_q2_2027", "no_native_telephony_via_twilio", "breach_notice_72_hours",
    }
    for phrases in {**CONFIG["hard_fail_gaps"], **CONFIG["soft_gaps"]}.values():
        assert phrases and all(isinstance(p, str) and p for p in phrases)


def test_scorecard_totals_100() -> None:
    s = CONFIG["scorecard"]
    factors = ["product_fit", "mandatory", "relationship", "deal_size",
               "competitive_position", "effort_vs_deadline"]
    assert sum(s[f]["points"] for f in factors) == 100
    assert s["bid_threshold"] == 65


def test_scorecard_rule_values() -> None:
    s = CONFIG["scorecard"]
    assert s["product_fit"]["status_values"] == {
        "Fully compliant": 1.0, "Via integration": 0.75, "Partially compliant": 0.5,
        "Needs decision": 0.25, "Not compliant": 0.0,
    }
    assert s["mandatory"]["penalty_per_not_compliant"] == 5
    assert s["mandatory"]["penalty_per_needs_decision"] == 1
    assert s["relationship"]["options"] == {
        "spoke_with_buyer_before_rfp": 15, "pre_proposal_meeting_only": 8, "none": 0,
    }
    assert s["competitive_position"]["incumbents"]["salesforce"] == 3
    assert s["competitive_position"]["incumbents"]["unknown"] == 5


def test_expert_answer_rules() -> None:
    s = CONFIG["scorecard"]
    assert s["product_fit"]["answer_values"] == {"Yes": 1.0, "Maybe": 0.5, "No": 0.0}
    assert (s["mandatory"]["penalty_per_no"], s["mandatory"]["penalty_per_maybe"]) == (5, 1)
    assert s["competitive_position"]["incumbents"]["other"] == 5
