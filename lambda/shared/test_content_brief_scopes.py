"""Authoritative scope and placeholder tests for Content Studio briefs."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shared.content_brief import (
    DEFAULT_PROMPT_TEMPLATES,
    MAX_SELECTED_KEYWORDS,
    ContentBriefTemplateError,
    ContentBriefValidationIssue,
    build_group_brief_prompt,
    builtin_content_brief_templates,
    canonicalize_group_brief,
)
from testing.assertions import present
from testing.content_brief_fixtures import (
    active_keyword,
    build_group_brief,
    build_keyword_scoped_content_brief,
    build_scoped_content_brief,
    cross_group_scope_case,
    mixed_group_keyword_rows,
)
from testing.dynamodb_stubs import fake_table


def canonicalize(
    idea: dict[str, object],
    *,
    members: list[dict[str, object]],
    group: dict[str, object] | None = None,
):
    """Canonicalize against deterministic authoritative rows."""
    group_item = {'id': 'group-1', 'name': 'Authoritative Group'} if group is None else group
    return canonicalize_group_brief(
        idea,
        fake_table(get_item={'Item': group_item}),
        fake_table(query={'Items': members}),
        url_validator=MagicMock(return_value=(True, '')),
    )


class TestAuthoritativeGroupScope:
    def test_resolves_every_active_member_when_group_scope_is_selected(self) -> None:
        members = mixed_group_keyword_rows()

        canonical, issue = canonicalize(build_scoped_content_brief(), members=members)

        assert issue is None
        assert present(canonical)['scope'] == {'mode': 'groups', 'group_ids': ['group-1']}
        assert present(canonical)['keyword_ids'] == ['keyword-1', 'keyword-2']
        assert present(canonical)['scope_label'] == 'Authoritative Group'

    def test_rejects_group_scope_when_no_active_member_resolves(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(),
            members=[active_keyword('keyword-1', 'Other', group_ids={'group-2'})],
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group has no active keywords'
        )

    def test_rejects_group_scope_when_fifty_one_active_members_resolve(self) -> None:
        members = [
            active_keyword(f'keyword-{index}', f'Keyword {index}', group_ids={'group-1'})
            for index in range(MAX_SELECTED_KEYWORDS + 1)
        ]

        canonical, issue = canonicalize(build_scoped_content_brief(), members=members)

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group has more than 50 active keywords'
        )

    def test_rejects_multiple_groups_when_group_scope_requires_exactly_one(self) -> None:
        idea = build_scoped_content_brief(
            scope={'mode': 'groups', 'group_ids': ['group-1', 'group-2']}
        )

        canonical, issue = canonicalize(idea, members=[])

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.group_ids', 'scope.group_ids accepts at most 1 entries'
        )

    def test_rejects_all_mode_when_content_briefs_require_explicit_scope(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(scope={'mode': 'all'}), members=[]
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.mode', 'scope.mode must be one of: groups, keywords'
        )


class TestAuthoritativeKeywordScope:
    def test_labels_one_selected_keyword_with_authoritative_text(self) -> None:
        idea = build_keyword_scoped_content_brief()

        canonical, issue = canonicalize(
            idea, members=[active_keyword('keyword-1', 'Authoritative keyword')]
        )

        assert issue is None
        assert present(canonical)['scope_label'] == 'Authoritative keyword'
        assert present(canonical)['keyword'] == 'Authoritative keyword'
        assert 'group_id' not in present(canonical)

    def test_labels_multiple_selected_keywords_with_exact_count(self) -> None:
        idea, members = cross_group_scope_case()

        canonical, issue = canonicalize(idea, members=members)

        assert issue is None
        assert present(canonical)['scope_label'] == '2 selected keywords'
        assert present(canonical)['keyword_ids'] == ['keyword-1', 'keyword-2']
        assert present(canonical)['keywords'] == ['Alpha', 'Beta']

    def test_preserves_all_fifty_authoritative_selected_keywords(self) -> None:
        ids = [f'keyword-{index:02d}' for index in range(MAX_SELECTED_KEYWORDS)]
        members = [active_keyword(keyword_id, f'Keyword {index:02d}') for index, keyword_id in enumerate(ids)]
        idea = build_scoped_content_brief(
            scope={'mode': 'keywords', 'keyword_ids': ids}
        )

        canonical, issue = canonicalize(idea, members=members)

        assert issue is None
        assert len(present(canonical)['keyword_ids']) == MAX_SELECTED_KEYWORDS
        assert present(canonical)['keywords'][0] == 'Keyword 00'
        assert present(canonical)['keywords'][-1] == 'Keyword 49'

    def test_rejects_fifty_one_selected_keyword_ids_before_resolution(self) -> None:
        ids = [f'keyword-{index}' for index in range(MAX_SELECTED_KEYWORDS + 1)]

        canonical, issue = canonicalize(
            build_scoped_content_brief(
                scope={'mode': 'keywords', 'keyword_ids': ids}
            ),
            members=[],
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.keyword_ids', 'scope.keyword_ids accepts at most 50 entries'
        )

    def test_rejects_empty_selected_keyword_ids_before_resolution(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(
                scope={'mode': 'keywords', 'keyword_ids': []}
            ),
            members=[],
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.keyword_ids',
            'scope.keyword_ids must contain between 1 and 50 active keyword ids',
        )

    @pytest.mark.parametrize('missing_id', ['missing-keyword', 'inactive-keyword'])
    def test_rejects_unresolved_selected_keyword_id(self, missing_id: str) -> None:
        idea = build_scoped_content_brief(
            scope={'mode': 'keywords', 'keyword_ids': ['keyword-1', missing_id]}
        )

        canonical, issue = canonicalize(
            idea, members=[active_keyword('keyword-1', 'Active keyword')]
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.keyword_ids',
            'scope.keyword_ids must contain only active existing keywords',
        )

    def test_accepts_selected_keywords_without_a_common_group(self) -> None:
        idea, members = cross_group_scope_case()

        canonical, issue = canonicalize(idea, members=members)

        assert issue is None
        assert present(canonical)['scope'] == {
            'mode': 'keywords',
            'keyword_ids': ['keyword-1', 'keyword-2'],
        }


class TestLegacyGroupScopeTranslation:
    def test_translates_legacy_selected_members_to_keyword_scope(self) -> None:
        members = [
            active_keyword('keyword-1', 'Alpha', group_ids={'group-1'}),
            active_keyword('keyword-2', 'Beta', group_ids={'group-1'}),
        ]

        canonical, issue = canonicalize(
            build_group_brief(keyword_ids=['keyword-2']), members=members
        )

        assert issue is None
        assert present(canonical)['scope'] == {
            'mode': 'keywords',
            'keyword_ids': ['keyword-2'],
        }
        assert present(canonical)['group_id'] == 'group-1'
        assert present(canonical)['scope_label'] == 'Authoritative Group'


class TestScopePlaceholder:
    def test_defaults_use_scope_instead_of_group_for_every_mode(self) -> None:
        placeholders = {
            mode: ('{scope}' in template, '{group}' in template)
            for mode, template in DEFAULT_PROMPT_TEMPLATES.items()
        }

        assert placeholders == {
            mode: (True, False) for mode in DEFAULT_PROMPT_TEMPLATES
        }

    def test_renders_scope_as_safety_wrapped_authoritative_context(self) -> None:
        idea = build_keyword_scoped_content_brief()
        canonical, _ = canonicalize(
            idea, members=[active_keyword('keyword-1', 'Authoritative keyword')]
        )

        prompt, source_count = build_group_brief_prompt(present(canonical), {})

        assert '<scope>Authoritative keyword</scope>' in prompt
        assert '<keywords>Authoritative keyword</keywords>' in prompt
        assert source_count == 0

    def test_preserves_group_placeholder_for_legacy_group_request(self) -> None:
        idea = build_group_brief(prompt_template='Write for {group} using {keywords}.')
        canonical, issue = canonicalize(
            idea,
            members=[active_keyword('keyword-1', 'Alpha', group_ids={'group-1'})],
        )

        prompt, _ = build_group_brief_prompt(present(canonical), {})

        assert issue is None
        assert '<group>Authoritative Group</group>' in prompt
        assert 'scope: <scope>Authoritative Group</scope>' in prompt

    def test_rejects_group_placeholder_for_selected_keyword_scope(self) -> None:
        idea = build_scoped_content_brief(
            scope={'mode': 'keywords', 'keyword_ids': ['keyword-1']},
            prompt_template='Write for {group} using {keywords}.',
        )

        canonical, issue = canonicalize(
            idea, members=[active_keyword('keyword-1', 'Alpha')]
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'prompt_template',
            'prompt_template cannot use {group} with a selected-keyword scope; use {scope} instead',
        )



def test_scope_placeholder_preserves_maximum_length_selected_keyword() -> None:
    keyword = 'x' * 500
    idea = build_scoped_content_brief(
        scope={'mode': 'keywords', 'keyword_ids': ['keyword-1']}
    )
    canonical, issue = canonicalize(
        idea, members=[active_keyword('keyword-1', keyword)]
    )

    prompt, _ = build_group_brief_prompt(present(canonical), {})

    assert issue is None
    assert f'<scope>{keyword}</scope>' in prompt



class TestBuiltinContentBriefTemplates:
    def test_returns_exact_builtin_metadata_for_every_mode(self) -> None:
        assert builtin_content_brief_templates() == [
            {
                'id': 'builtin-improve-current-url',
                'name': 'Improve current URL',
                'description': 'Rewrite and improve an existing landing page using its fetched source text.',
                'content_angle': 'improve_current_url',
                'prompt_template': DEFAULT_PROMPT_TEMPLATES['improve_current_url'],
                'builtin': True,
                'created_by': None,
                'created_at': None,
                'updated_at': None,
            },
            {
                'id': 'builtin-rewrite-pasted-copy',
                'name': 'Rewrite pasted copy',
                'description': 'Rewrite supplied landing-page copy while preserving accurate source facts.',
                'content_angle': 'rewrite_pasted_copy',
                'prompt_template': DEFAULT_PROMPT_TEMPLATES['rewrite_pasted_copy'],
                'builtin': True,
                'created_by': None,
                'created_at': None,
                'updated_at': None,
            },
            {
                'id': 'builtin-create-new-landing-page',
                'name': 'Create new landing page',
                'description': 'Create a complete landing page from the selected keyword scope.',
                'content_angle': 'create_new_landing_page',
                'prompt_template': DEFAULT_PROMPT_TEMPLATES['create_new_landing_page'],
                'builtin': True,
                'created_by': None,
                'created_at': None,
                'updated_at': None,
            },
        ]



class TestExactScopeContract:
    @pytest.mark.parametrize(
        ('scope', 'expected_message'),
        [
            (
                {'mode': 'groups', 'group_ids': ['group-1'], 'keyword_ids': ['keyword-1']},
                'scope for groups mode must contain exactly mode and group_ids',
            ),
            (
                {'mode': 'keywords', 'keyword_ids': ['keyword-1'], 'group_ids': ['group-1']},
                'scope for keywords mode must contain exactly mode and keyword_ids',
            ),
        ],
        ids=['group-extra-field', 'keyword-extra-field'],
    )
    def test_rejects_scope_with_fields_outside_exact_mode_shape(
        self, scope: dict[str, object], expected_message: str
    ) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(scope=scope), members=[]
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue('scope', expected_message)

    def test_rejects_scope_when_value_is_not_an_object(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(scope=['keyword-1']), members=[]
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue('scope', 'scope must be an object')

    def test_rejects_group_scope_when_group_id_list_is_empty(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(scope={'mode': 'groups', 'group_ids': []}),
            members=[],
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.group_ids', 'scope.group_ids must contain exactly one id'
        )


class TestAuthoritativeScopeRecords:
    def test_accepts_group_scope_with_exactly_fifty_active_members(self) -> None:
        members = [
            active_keyword(f'keyword-{index}', f'Keyword {index:02d}', group_ids={'group-1'})
            for index in range(MAX_SELECTED_KEYWORDS)
        ]

        canonical, issue = canonicalize(build_scoped_content_brief(), members=members)

        assert issue is None
        assert len(present(canonical)['keyword_ids']) == MAX_SELECTED_KEYWORDS

    def test_returns_scope_field_when_new_group_does_not_exist(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(), members=[], group={}
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group not found'
        )

    def test_rejects_group_when_authoritative_name_is_blank(self) -> None:
        canonical, issue = canonicalize(
            build_scoped_content_brief(),
            members=[],
            group={'id': 'group-1', 'name': '   '},
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group is unavailable'
        )

    def test_looks_up_group_by_exact_authoritative_id_key(self) -> None:
        groups_table = fake_table(get_item={
            'Item': {'id': 'group-1', 'name': 'Authoritative Group'}
        })
        keywords_table = fake_table(query={
            'Items': [active_keyword('keyword-1', 'Alpha', group_ids={'group-1'})]
        })

        canonical, issue = canonicalize_group_brief(
            build_scoped_content_brief(),
            groups_table,
            keywords_table,
            url_validator=MagicMock(return_value=(True, '')),
        )

        assert issue is None
        assert present(canonical)['group_id'] == 'group-1'
        assert groups_table.get_item.call_args.kwargs == {'Key': {'id': 'group-1'}}

    def test_rejects_selected_scope_when_authoritative_row_has_no_id(self) -> None:
        canonical, issue = canonicalize(
            build_keyword_scoped_content_brief(),
            members=[{'keyword': 'Malformed authoritative row'}],
        )

        assert canonical is None
        assert issue == ContentBriefValidationIssue(
            'scope.keyword_ids',
            'scope.keyword_ids must contain only active existing keywords',
        )

    def test_describes_canonical_single_keyword_count_exactly(self) -> None:
        canonical, issue = canonicalize(
            build_keyword_scoped_content_brief(),
            members=[active_keyword('keyword-1', 'Alpha')],
        )

        assert issue is None
        assert present(canonical)['description'] == (
            'Generate a complete landing page from 1 selected active keywords.'
        )


class TestPromptScopeFallbacks:
    @pytest.mark.parametrize(
        ('overrides', 'expected_scope'),
        [
            ({'scope_label': 'Current scope', 'group_name': 'Legacy group', 'keyword': 'Fallback keyword'}, 'Current scope'),
            ({'group_name': 'Legacy group', 'keyword': 'Fallback keyword'}, 'Legacy group'),
            ({'group_name': '', 'keyword': 'Fallback keyword'}, 'Fallback keyword'),
        ],
        ids=['scope-label', 'legacy-group-name', 'legacy-keyword'],
    )
    def test_scope_placeholder_uses_current_then_legacy_fallback_order(
        self, overrides: dict[str, str], expected_scope: str
    ) -> None:
        idea = build_group_brief(**overrides)

        prompt, _ = build_group_brief_prompt(idea, {})

        assert f'<scope>{expected_scope}</scope>' in prompt

    def test_rejects_prompt_build_when_every_scope_label_is_missing(self) -> None:
        idea = build_group_brief(group_name='', keyword='')

        with pytest.raises(ContentBriefTemplateError) as caught:
            build_group_brief_prompt(idea, {})

        assert str(caught.value) == 'Content brief scope label is unavailable'

    def test_keeps_group_and_scope_context_distinct_for_group_origin_child(self) -> None:
        idea = build_group_brief(
            group_name='Authoritative Group',
            scope_label='Authoritative keyword',
            keyword='Authoritative keyword',
            keywords=['Authoritative keyword'],
            prompt_template='{group}|{scope}|{keywords}',
        )

        prompt, _ = build_group_brief_prompt(idea, {})

        assert (
            '<group>Authoritative Group</group>|'
            '<scope>Authoritative keyword</scope>|'
            '<keywords>Authoritative keyword</keywords>'
        ) in prompt



def test_legacy_scope_ignores_malformed_unselected_group_member() -> None:
    members = [
        active_keyword('keyword-1', 'Alpha', group_ids={'group-1'}),
        {'keyword': 'Malformed row', 'group_ids': {'group-1'}},
    ]

    canonical, issue = canonicalize(build_group_brief(), members=members)

    assert issue is None
    assert present(canonical)['keyword_ids'] == ['keyword-1']
    assert present(canonical)['keywords'] == ['Alpha']
