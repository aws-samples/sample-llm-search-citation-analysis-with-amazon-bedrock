"""``normalize_url``: tracking-only query parameters go, content-selecting ones stay."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.utils import TRACKING_PARAMETER_PREFIXES, TRACKING_PARAMETERS, is_tracking_parameter, normalize_url

PAGE = 'https://aurora-airways.example/fares/lima'


class TestTrackingParametersAreStripped:
    @pytest.mark.parametrize('query', [
        pytest.param('utm_source=openai&utm_medium=referral&utm_campaign=spring', id='utm-classics'),
        pytest.param('utm_id=12&utm_source_platform=ads&utm_creative_format=video', id='utm-newer-members'),
        pytest.param('gclid=Cj0K&gbraid=0AAA&wbraid=1BBB&dclid=CNz', id='google-ad-clicks'),
        pytest.param('fbclid=IwAR1&msclkid=abc&yclid=123&twclid=t1&ttclid=tt1', id='other-ad-clicks'),
        pytest.param('srsltid=AfmBOop&_ga=2.1.1&_gl=1*abc', id='google-analytics-and-shopping'),
        pytest.param('igshid=MzRl&igsh=abc&mibextid=Zxz2cZ', id='share-tracking'),
        pytest.param('mc_cid=1&mc_eid=2&_hsenc=p2AN&_hsmi=9&mkt_tok=NTI&elqTrackId=e1&vero_id=v&_ke=k&ck_subscriber_id=7', id='marketing-automation'),
        pytest.param('hsa_acc=1&hsa_cam=2&hsa_grp=3&mtm_campaign=m&mtm_kwd=k&pk_campaign=p', id='hubspot-ads-and-matomo'),
        pytest.param('s_kwcid=AL!1&ef_id=x&wt_mc=m&_openstat=o', id='adobe-webtrekk-yandex'),
        pytest.param('ref=newsletter&source=chatgpt&ref_src=twsrc&cmpid=c&ncid=n&spm=a2g0o', id='referrer-attribution'),
        pytest.param('pd_rd_i=B0&pd_rd_r=r&pf_rd_p=p&pf_rd_r=rr', id='amazon-referral'),
        pytest.param('UTM_Source=Mail&FBCLID=x&Ref=y', id='any-letter-case'),
    ])
    def test_strips_every_tracking_only_parameter(self, query):
        assert normalize_url(f'{PAGE}?{query}') == PAGE

    def test_keeps_the_parameters_that_select_content_around_the_tracking_ones(self):
        assert normalize_url(f'{PAGE}?utm_source=openai&id=42&gclid=x&page=2&lang=es&srsltid=y') == f'{PAGE}?id=42&page=2&lang=es'


class TestContentParametersAreKept:
    @pytest.mark.parametrize('query', [
        pytest.param('id=42', id='id'),
        pytest.param('q=lima&page=2', id='search-and-page'),
        pytest.param('v=abc123', id='video-id-on-a-non-youtube-host'),
        pytest.param('lang=es&currency=CLP', id='locale'),
        pytest.param('s=20&t=abc', id='short-names-that-mean-something-elsewhere'),
        pytest.param('tag=travel&trk=nav', id='generic-names-left-alone'),
        pytest.param('sort=price&filter=nonstop', id='listing-controls'),
        pytest.param('utm=1&ref_id=9&sources=all', id='look-alikes-that-are-not-tracking-names'),
    ])
    def test_keeps_a_parameter_that_may_select_content(self, query):
        assert normalize_url(f'{PAGE}?{query}') == f'{PAGE}?{query}'


class TestIsTrackingParameter:
    def test_every_listed_name_is_lower_case_so_the_case_insensitive_match_can_find_it(self):
        assert all(name == name.lower() for name in TRACKING_PARAMETERS)
        assert all(prefix == prefix.lower() for prefix in TRACKING_PARAMETER_PREFIXES)

    @given(st.sampled_from(sorted(TRACKING_PARAMETERS)), st.sampled_from(['lower', 'upper', 'title']))
    def test_matches_a_listed_name_in_any_case(self, name, style):
        spelled = {'lower': name.lower(), 'upper': name.upper(), 'title': name.title()}[style]

        assert is_tracking_parameter(spelled) is True

    @given(st.sampled_from(TRACKING_PARAMETER_PREFIXES), st.text(alphabet='abcdefghijklmnopqrstuvwxyz_', min_size=1, max_size=12))
    def test_matches_every_member_of_a_prefix_family(self, prefix, rest):
        assert is_tracking_parameter(prefix + rest) is True

    @pytest.mark.parametrize('name', ['id', 'page', 'q', 'utm', 'refs', 'sourced', 'hsa', 'mtm', 'pd_rd', ''])
    def test_leaves_a_name_that_is_not_in_the_list_alone(self, name):
        assert is_tracking_parameter(name) is False
