"""SEO recommendations (``shared.seo_insights``): which rows each rule picks and the Action Center shape."""

from __future__ import annotations

from typing import Any

from shared.seo_insights import ai_gap, aio_competitor_cited, aio_missing_you, seo_gap, seo_recommendations
from shared.utils import recommendation_id


def seo_row(keyword: str = 'cheap flights', **fields: Any) -> dict[str, Any]:
    return {
        'keyword': keyword, 'search_volume': 1000, 'organic_position': None, 'competitor_positions': {'Acme': None},
        'ai_overview_shown': None, 'ai_overview_cites_you': None, 'ai_overview_cited_competitors': [],
        'ai_mention_rate': None, 'quadrant': 'no_data', **fields,
    }


class TestAioMissingYou:
    def test_picks_a_top_3_ranking_the_overview_does_not_cite(self):
        rows = [seo_row(organic_position=3, ai_overview_shown=True, ai_overview_cites_you=False)]

        assert aio_missing_you(rows)[0]['keywords'] == ['cheap flights']

    def test_skips_a_fourth_position(self):
        assert aio_missing_you([seo_row(organic_position=4, ai_overview_shown=True, ai_overview_cites_you=False)]) == []

    def test_skips_a_page_without_an_overview(self):
        assert aio_missing_you([seo_row(organic_position=1, ai_overview_shown=False, ai_overview_cites_you=False)]) == []


class TestAioCompetitorCited:
    def test_picks_a_cited_competitor_ranking_below_you(self):
        row = seo_row(organic_position=2, competitor_positions={'Acme': 5}, ai_overview_shown=True, ai_overview_cited_competitors=['Acme'])

        assert aio_competitor_cited([row])[0]['type'] == 'aio_competitor_cited'

    def test_picks_a_cited_competitor_outside_the_top_10(self):
        row = seo_row(organic_position=8, ai_overview_shown=True, ai_overview_cited_competitors=['Acme'])

        assert len(aio_competitor_cited([row])) == 1

    def test_skips_a_cited_competitor_ranking_above_you(self):
        row = seo_row(organic_position=6, competitor_positions={'Acme': 1}, ai_overview_shown=True, ai_overview_cited_competitors=['Acme'])

        assert aio_competitor_cited([row]) == []

    def test_skips_when_you_do_not_rank(self):
        assert aio_competitor_cited([seo_row(ai_overview_shown=True, ai_overview_cited_competitors=['Acme'])]) == []


class TestQuadrantRules:
    def test_ai_gap_uses_the_rule_title(self):
        assert ai_gap([seo_row(quadrant='ai_gap')])[0]['title'] == 'Ranks on Google but AI answers rarely name you'

    def test_seo_gap_uses_the_rule_title(self):
        assert seo_gap([seo_row(quadrant='seo_gap')])[0]['title'] == "AI knows you, Google doesn't rank you"


class TestShape:
    def test_has_the_action_center_fields_and_its_recommendation_id(self):
        recommendation = ai_gap([seo_row(quadrant='ai_gap')])[0]
        without_id = {key: value for key, value in recommendation.items() if key != 'id'}

        assert (sorted(recommendation), recommendation['id']) == (
            ['action', 'description', 'id', 'impact', 'keywords', 'priority', 'title', 'type'], recommendation_id(without_id),
        )

    def test_lists_the_five_first_keywords_and_counts_them_all(self):
        recommendation = seo_gap([seo_row(f'kw {index}', quadrant='seo_gap') for index in range(7)])[0]

        assert (len(recommendation['keywords']), recommendation['description'].startswith('On 7 keywords')) == (5, True)

    def test_sums_the_search_volume_as_the_impact(self):
        assert ai_gap([seo_row(quadrant='ai_gap'), seo_row('b', quadrant='ai_gap', search_volume=None)])[0]['impact'] == (
            '1,000 monthly searches across these keywords'
        )

    def test_orders_high_priority_rules_first(self):
        rows = [seo_row(quadrant='ai_gap', organic_position=2, ai_overview_shown=True, ai_overview_cites_you=False)]

        assert [item['type'] for item in seo_recommendations(rows)] == ['aio_missing_you', 'ai_gap']

    def test_keeps_the_id_when_the_volume_changes(self):
        before = ai_gap([seo_row(quadrant='ai_gap')])[0]['id']

        assert ai_gap([seo_row(quadrant='ai_gap', search_volume=5)])[0]['id'] == before
