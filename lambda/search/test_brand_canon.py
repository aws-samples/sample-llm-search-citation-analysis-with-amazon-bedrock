"""Tests for deterministic, config-driven brand canonicalisation in the extractor.

Proves the folding is brand/industry-agnostic: it derives canonical brands purely
from the configured tracked_brands, with no hardcoded brand names.
"""
from brand_extractor import LLMBrandExtractor, build_brand_index, canonicalize_brand


CAR_RENTAL = {
    "tracked_brands": {
        "first_party": ["Avis"],
        "competitors": ["Hertz", "Enterprise", "National", "Budget", "Dollar"],
    },
}


def test_folds_variants_to_parent():
    idx = build_brand_index(CAR_RENTAL["tracked_brands"])
    assert canonicalize_brand("Enterprise Rent-A-Car", idx) == ("Enterprise", "competitor")
    assert canonicalize_brand("Enterprise Plus", idx) == ("Enterprise", "competitor")
    assert canonicalize_brand("Hertz Gold Plus Rewards", idx) == ("Hertz", "competitor")
    assert canonicalize_brand("Avis Preferred", idx) == ("Avis", "first_party")


def test_fixes_misclassification_deterministically():
    idx = build_brand_index(CAR_RENTAL["tracked_brands"])
    # "Budget" is a tracked competitor, never first_party, regardless of LLM guess.
    assert canonicalize_brand("Budget", idx) == ("Budget", "competitor")


def test_no_false_positive_substring():
    idx = build_brand_index(CAR_RENTAL["tracked_brands"])
    # "International" must NOT fold onto "National".
    assert canonicalize_brand("International Rentals", idx) == ("International Rentals", None)


def test_untracked_stays_other():
    idx = build_brand_index(CAR_RENTAL["tracked_brands"])
    assert canonicalize_brand("Kayak", idx) == ("Kayak", None)


def test_aliases_fold_standalone_subbrands():
    tracked = {"first_party": [], "competitors": ["National"]}
    aliases = {"National": ["Emerald Club", "Emerald Choice"]}
    idx = build_brand_index(tracked, aliases)
    assert canonicalize_brand("Emerald Club", idx) == ("National", "competitor")


def test_short_mention_folds_to_longer_configured_name():
    # Configured brand is the long form; the model often says the short form.
    tracked = {"first_party": [], "competitors": ["National Car Rental"]}
    idx = build_brand_index(tracked)
    assert canonicalize_brand("National", idx) == ("National Car Rental", "competitor")
    assert canonicalize_brand("National Car Rental", idx) == ("National Car Rental", "competitor")


def test_exact_match_beats_longer_variant():
    # "Avis" must stay "Avis", not get pulled into "Avis Car Rental".
    tracked = {"first_party": ["Avis", "Avis Car Rental"], "competitors": []}
    idx = build_brand_index(tracked)
    assert canonicalize_brand("Avis", idx) == ("Avis", "first_party")
    assert canonicalize_brand("Avis Preferred", idx) == ("Avis", "first_party")


def test_industry_agnostic_hotels():
    # Same machinery, entirely different industry/brands, no code changes.
    tracked = {"first_party": ["Marriott"], "competitors": ["Hilton", "Hyatt"]}
    idx = build_brand_index(tracked)
    assert canonicalize_brand("Marriott Bonvoy", idx) == ("Marriott", "first_party")
    assert canonicalize_brand("Hilton Honors", idx) == ("Hilton", "competitor")
    assert canonicalize_brand("Airbnb", idx) == ("Airbnb", None)


def test_classify_merges_duplicates_within_response():
    extractor = LLMBrandExtractor(config=CAR_RENTAL)
    brands = [
        {"name": "Enterprise", "classification": "competitor", "mention_count": 2, "rank": 3},
        {"name": "Enterprise Rent-A-Car", "classification": "other", "mention_count": 1, "rank": 1},
        {"name": "Avis Preferred", "classification": "other", "mention_count": 1, "rank": 2},
        {"name": "Kayak", "classification": "other", "mention_count": 1, "rank": 5},
    ]
    result = extractor._classify_brands(brands)
    by_name = {b["name"]: b for b in result}

    # Enterprise variants merged into one entry.
    assert "Enterprise" in by_name
    assert "Enterprise Rent-A-Car" not in by_name
    assert by_name["Enterprise"]["mention_count"] == 3
    assert by_name["Enterprise"]["rank"] == 1
    assert by_name["Enterprise"]["classification"] == "competitor"

    # Avis Preferred folded to Avis / first_party.
    assert by_name["Avis"]["classification"] == "first_party"

    # Untracked brand untouched.
    assert by_name["Kayak"]["classification"] == "other"
