"""Contract tests for the exported brand extraction defaults."""

from brand_extractor import DEFAULT_EXTRACTION_CONFIG


def test_exposes_general_under_industry_key_when_config_uses_defaults() -> None:
    assert DEFAULT_EXTRACTION_CONFIG['industry'] == 'general'
