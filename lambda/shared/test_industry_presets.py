"""
Tests for shared.industry_presets.

The preset catalog previously lived in two files with slightly different
shapes (the API version carried `default_prompt`, the extractor version did
not). Consolidation risk: breaking either consumer by changing the structural
contract. These tests pin the contract.
"""

from __future__ import annotations

from shared import industry_presets

REQUIRED_FIELDS = {"name", "description", "entity_types", "example_brands", "extraction_focus"}


class TestIndustryPresetCatalog:
    def test_catalog_lists_general_before_the_eight_industries_and_custom_fallback(self) -> None:
        assert list(industry_presets.INDUSTRY_PRESETS) == [
            "general",
            "hotels",
            "restaurants",
            "airlines",
            "retail",
            "fashion",
            "automotive",
            "technology",
            "finance",
            "custom",
        ]

    def test_custom_fallback_exists(self) -> None:
        """`get_preset` falls back to 'custom' for unknown industries —
        if this key is missing, every unknown-industry lookup would
        raise KeyError."""
        assert "custom" in industry_presets.INDUSTRY_PRESETS

    def test_every_preset_has_all_required_fields(self) -> None:
        for industry_id, preset in industry_presets.INDUSTRY_PRESETS.items():
            missing = REQUIRED_FIELDS - set(preset.keys())
            assert not missing, f"{industry_id!r} missing fields: {missing}"

    def test_every_preset_has_string_name(self) -> None:
        for industry_id, preset in industry_presets.INDUSTRY_PRESETS.items():
            assert isinstance(preset["name"], str), f"{industry_id!r} name is non-string"
            assert preset["name"], f"{industry_id!r} name is empty"

    def test_every_preset_entity_types_is_a_list(self) -> None:
        for industry_id, preset in industry_presets.INDUSTRY_PRESETS.items():
            assert isinstance(preset["entity_types"], list), (
                f"{industry_id!r} entity_types is not a list"
            )

    def test_every_preset_example_brands_is_a_list(self) -> None:
        for industry_id, preset in industry_presets.INDUSTRY_PRESETS.items():
            assert isinstance(preset["example_brands"], list), (
                f"{industry_id!r} example_brands is not a list"
            )

    def test_general_preset_has_the_canonical_generic_values(self) -> None:
        assert industry_presets.INDUSTRY_PRESETS["general"] == {
            "name": "General",
            "description": "Track brands and companies in any industry",
            "entity_types": [],
            "example_brands": [],
            "extraction_focus": "brand and company recommendations",
        }

    def test_default_industry_id_selects_general(self) -> None:
        assert industry_presets.DEFAULT_INDUSTRY_ID == "general"

    def test_custom_preset_has_empty_entity_types_and_example_brands(self) -> None:
        """`custom` remains the fallback for unrecognized explicit ids."""
        custom = industry_presets.INDUSTRY_PRESETS["custom"]
        assert custom["entity_types"] == []
        assert custom["example_brands"] == []


class TestGetPreset:
    def test_returns_preset_for_known_industry(self) -> None:
        preset = industry_presets.get_preset("hotels")
        assert preset["name"] == "Hotels & Hospitality"

    def test_returns_custom_preset_for_unknown_industry(self) -> None:
        """Every caller in the codebase relied on this fallback. Missing
        it would have required every handler to handle KeyError."""
        preset = industry_presets.get_preset("nonexistent-industry-id")
        assert preset["name"] == "Custom Industry"

    def test_returns_custom_preset_for_empty_string(self) -> None:
        preset = industry_presets.get_preset("")
        assert preset["name"] == "Custom Industry"

    def test_preserves_hotels_preset_when_general_is_the_default(self) -> None:
        preset = industry_presets.get_preset("hotels")
        assert preset == {
            "name": "Hotels & Hospitality",
            "description": "Track hotel brands, chains, and individual properties",
            "entity_types": [
                "hotel chains",
                "hotel brands",
                "individual properties",
                "resorts",
                "boutique hotels",
            ],
            "example_brands": [
                "Marriott",
                "Hilton",
                "Hyatt",
                "InterContinental",
                "Four Seasons",
            ],
            "extraction_focus": "hotel and accommodation recommendations",
        }
