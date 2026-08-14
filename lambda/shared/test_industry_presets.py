"""
Tests for shared.industry_presets.

The preset catalog previously lived in two files with slightly different
shapes (the API version carried `default_prompt`, the extractor version did
not). Consolidation risk: breaking either consumer by changing the structural
contract. These tests pin the contract.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import industry_presets  # type: ignore[import-not-found]

REQUIRED_FIELDS = {"name", "description", "entity_types", "example_brands", "extraction_focus"}


class TestIndustryPresetCatalog:
    def test_catalog_is_not_empty(self) -> None:
        assert len(industry_presets.INDUSTRY_PRESETS) > 0

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
            assert isinstance(preset["name"], str) and preset["name"], (
                f"{industry_id!r} name is empty or non-string"
            )

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

    def test_custom_preset_has_empty_entity_types_and_example_brands(self) -> None:
        """`custom` is the fallback for deployments that haven't picked
        an industry. Dashboard UX depends on it starting empty."""
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

    def test_preserves_hotels_example_brands(self) -> None:
        """Regression guard: example_brands are shown in the dashboard
        industry selector. Losing them during consolidation would break
        the UI."""
        preset = industry_presets.get_preset("hotels")
        assert "Marriott" in preset["example_brands"]
        assert "Hilton" in preset["example_brands"]
