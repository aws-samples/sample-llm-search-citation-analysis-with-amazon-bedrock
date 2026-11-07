"""Domain snapshot job steps (``jobs_domain``): targets of the weekly sweep and of a manual snapshot, one snapshot."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from shared.dataforseo_locations import MarketCodes
from testing.markets_fixtures import CHILE, markets_item
from testing.module_loader import load_handler_module
from testing.seo_domain_fixtures import FakeS3, FakeSnapshots

JOBS_DIR = Path(__file__).resolve().parent
LABS_CHILE = MarketCodes(location_code=2152, language_code='es', keyword_data='labs')
ADS_CHILE = MarketCodes(location_code=2152, language_code='es', keyword_data='google_ads')
BRAND = {
    'first_party_domains': ['example.com', 'shop.example.com'],
    'competitor_domains': {'Acme': ['acme.example.org']},
}


def brand_table(default=BRAND):
    items = {'markets': markets_item(CHILE), 'default': default}
    table = MagicMock()
    table.get_item.side_effect = lambda Key: {'Item': items[Key['config_id']]}
    return table


@pytest.fixture
def jobs(monkeypatch):
    monkeypatch.setenv('RAW_RESPONSES_BUCKET', 'raw')
    module = load_handler_module(str(JOBS_DIR), 'jobs_domain.py')
    with patch.object(module, 'brand_config_table', return_value=brand_table()):
        yield module


class TestSnapshotAll:
    def test_lists_every_brand_domain_in_every_labs_market(self, jobs):
        with patch.object(jobs, 'market_codes', return_value=LABS_CHILE):
            result = jobs.snapshot_all({'step': 'domain.snapshot_all', 'input': {}})

        assert result['targets'] == [
            {'domain': domain, 'market_id': market} for domain in ('acme.example.org', 'example.com') for market in ('global', 'cl-es')
        ]

    def test_skips_a_google_ads_only_market(self, jobs):
        with patch.object(jobs, 'market_codes', return_value=ADS_CHILE):
            result = jobs.snapshot_all({'step': 'domain.snapshot_all', 'input': {}})

        assert {target['market_id'] for target in result['targets']} == {'global'}

    def test_takes_only_the_manual_target_when_one_is_given(self, jobs):
        with patch.object(jobs, 'market_codes', return_value=LABS_CHILE):
            result = jobs.snapshot_all({'input': {'targets': [{'domain': 'www.example.com', 'market_id': 'cl-es'}]}})

        assert result == {'targets': [{'domain': 'example.com', 'market_id': 'cl-es'}], 'count': 1}

    def test_drops_a_manual_target_in_an_unknown_market(self, jobs):
        assert jobs.snapshot_all({'input': {'targets': [{'domain': 'example.com', 'market_id': 'br-pt'}]}})['count'] == 0

    def test_caps_the_targets(self, jobs):
        many = {'first_party_domains': [f'site{index}.example' for index in range(50)]}
        with patch.object(jobs, 'brand_config_table', return_value=brand_table(many)):
            assert jobs.snapshot_all({})['count'] == jobs.MAX_TARGETS


class TestSnapshotOne:
    def test_stores_one_snapshot_of_the_domain(self, jobs):
        take = MagicMock(return_value={'status': 'stored', 'keywords': 3})
        with patch.multiple(jobs, take_snapshot=take, snapshots_table=MagicMock(return_value=FakeSnapshots()),
                            s3_client=MagicMock(return_value=FakeS3())):
            result = jobs.snapshot_one({'domain': 'example.com', 'market_id': 'global'})

        assert (result, take.call_args.args[:2]) == ({'domain': 'example.com', 'market_id': 'global', 'status': 'stored', 'keywords': 3},
                                                    ('example.com', 'global'))

    def test_skips_a_market_that_is_no_longer_configured(self, jobs):
        take = MagicMock()
        with patch.object(jobs, 'take_snapshot', take):
            result = jobs.snapshot_one({'domain': 'example.com', 'market_id': 'br-pt'})

        assert (result['status'], take.call_count) == ('unknown_market', 0)


def test_registers_both_steps(jobs):
    assert sorted(jobs.STEPS) == ['domain.snapshot_all', 'domain.snapshot_one']
