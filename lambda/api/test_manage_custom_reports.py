"""Saved custom reports API: CRUD, the shared 50-report limit, and block validation."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest
from botocore.exceptions import ClientError

from testing.custom_reports_fixtures import (
    CALLER_EMAIL,
    CALLER_USERNAME,
    EMBEDDABLE_VIDEO_LINKS,
    FROZEN_TIMESTAMP,
    INVALID_IMAGE_LINKS,
    REPORT_ID,
    UNEMBEDDABLE_VIDEO_LINKS,
    VALID_IMAGE_LINKS,
    YOUTUBE_LINK,
    call_custom_reports,
    create_report_for_test,
    load_custom_reports_module,
    post_raw_body,
    report_body,
    single_block_body,
    stored_report,
    vector_description,
)
from testing.dynamodb_stubs import conditional_check_failure, fake_table

_mod = load_custom_reports_module('manage_custom_reports_under_test')

_NOT_FOUND = {'error': 'Custom report not found'}
_DAYS_ERROR = {'error': 'Invalid days. Must be one of: 30, 90, 180', 'field': 'days'}
_TYPE_ERROR = 'Block 1: type must be 2-48 lowercase letters, digits or underscores, starting with a letter'
_HEADING = {'type': 'heading', 'text': 'Where we stand', 'level': 2}
_DATA_BLOCK = {'type': 'sentiment_headline'}
_IMAGE = {'type': 'image', 'url': 'https://example.com/logo.png', 'alt': 'Logo'}
_VIDEO = {'type': 'video', 'url': YOUTUBE_LINK}
_LINK_ERRORS = {
    'image': {'Block 1: image url is required', 'Block 1: image url must be an https link'},
    'video': {
        'Block 1: video url is required',
        'Block 1: video url must be an https link',
        'Block 1: video url must be a YouTube or Vimeo video link',
    },
}


class TestListReports:
    def test_returns_reports_newest_update_first_with_ties_in_id_order(self) -> None:
        table = fake_table(scan={'Items': [
            stored_report(id='b', updated_at='2026-09-02T08:00:00Z'),
            stored_report(id='c', updated_at='2026-09-03T08:00:00Z'),
            stored_report(id='a', updated_at='2026-09-02T08:00:00Z'),
        ]})

        status, body = call_custom_reports(_mod, table, 'GET')

        assert status == 200
        assert [report['id'] for report in body['reports']] == ['c', 'a', 'b']

    def test_returns_only_the_public_report_fields_when_the_row_holds_more(self) -> None:
        table = fake_table(scan={'Items': [stored_report(internal_note='not for the dashboard')]})

        _, body = call_custom_reports(_mod, table, 'GET')

        assert body == {'reports': [{
            'id': REPORT_ID,
            'title': 'Quarterly visibility',
            'blocks': [_HEADING, _DATA_BLOCK],
            'days': 30,
            'created_at': '2026-09-01T08:00:00Z',
            'created_by': 'author@example.com',
            'updated_at': '2026-09-02T08:00:00Z',
            'updated_by': 'editor@example.com',
        }]}

    def test_returns_days_and_heading_levels_as_json_integers_when_dynamodb_returns_decimals(self) -> None:
        table = fake_table(scan={'Items': [stored_report(days=Decimal(180))]})

        _, body = call_custom_reports(_mod, table, 'GET')

        report = body['reports'][0]
        assert (type(report['days']), report['days']) == (int, 180)
        assert (type(report['blocks'][0]['level']), report['blocks'][0]['level']) == (int, 2)

    def test_follows_scan_pages_to_return_every_report(self) -> None:
        table = fake_table()
        table.scan.side_effect = [
            {'Items': [stored_report(id='a')], 'LastEvaluatedKey': {'id': 'a'}},
            {'Items': [stored_report(id='b')]},
        ]

        _, body = call_custom_reports(_mod, table, 'GET')

        assert sorted(report['id'] for report in body['reports']) == ['a', 'b']

    def test_returns_an_empty_list_when_no_report_is_saved(self) -> None:
        status, body = call_custom_reports(_mod, fake_table(scan={'Items': []}), 'GET')

        assert (status, body) == (200, {'reports': []})


class TestCreateReport:
    def test_stores_the_report_with_the_caller_email_as_author_and_editor(self) -> None:
        _, _, table = create_report_for_test(_mod, report_body())

        assert table.put_item.call_args.kwargs == {'Item': {
            'id': REPORT_ID,
            'title': 'Quarterly visibility',
            'blocks': [_HEADING, _DATA_BLOCK],
            'days': 30,
            'created_at': FROZEN_TIMESTAMP,
            'created_by': CALLER_EMAIL,
            'updated_at': FROZEN_TIMESTAMP,
            'updated_by': CALLER_EMAIL,
        }}

    def test_answers_201_with_the_stored_report(self) -> None:
        status, body, table = create_report_for_test(_mod, report_body())

        assert status == 201
        assert body == {'report': table.put_item.call_args.kwargs['Item']}

    def test_defaults_days_to_90_when_the_body_omits_them(self) -> None:
        body = report_body()
        del body['days']

        _, response, _ = create_report_for_test(_mod, body)

        assert response['report']['days'] == 90

    @pytest.mark.parametrize('days', [30, 90, 180])
    def test_stores_each_allowed_reporting_window(self, days: int) -> None:
        _, response, _ = create_report_for_test(_mod, report_body(days=days))

        assert response['report']['days'] == days

    def test_records_the_cognito_identity_when_the_token_has_no_email_claim(self) -> None:
        _, response, _ = create_report_for_test(_mod, report_body(), claims={'cognito:username': CALLER_USERNAME})

        assert (response['report']['created_by'], response['report']['updated_by']) == (CALLER_USERNAME, CALLER_USERNAME)

    def test_saves_for_a_signed_in_caller_outside_every_group(self) -> None:
        """Reports are shared team work: no Admin (or any) group is required."""
        status, _, _ = create_report_for_test(_mod, report_body(), claims={'email': CALLER_EMAIL})

        assert status == 201

    def test_stores_the_title_stripped(self) -> None:
        _, response, _ = create_report_for_test(_mod, report_body(title='  Spaced title  '))

        assert response['report']['title'] == 'Spaced title'

    def test_stores_a_title_of_exactly_eighty_characters(self) -> None:
        _, response, _ = create_report_for_test(_mod, report_body(title='t' * 80))

        assert response['report']['title'] == 't' * 80

    def test_refuses_with_409_limit_reached_when_fifty_reports_exist(self) -> None:
        status, body, table = create_report_for_test(_mod, report_body(), existing=50)

        assert (status, body) == (409, {'error': 'limit_reached', 'field': 'reports'})
        table.put_item.assert_not_called()

    def test_saves_the_fiftieth_report_when_forty_nine_exist(self) -> None:
        status, _, table = create_report_for_test(_mod, report_body(), existing=49)

        assert status == 201
        assert table.put_item.call_count == 1

    def test_counts_saved_reports_from_an_id_only_scan(self) -> None:
        _, _, table = create_report_for_test(_mod, report_body())

        table.scan.assert_called_once_with(ProjectionExpression='#id', ExpressionAttributeNames={'#id': 'id'})


class TestUpdateReport:
    def test_replaces_title_blocks_and_days_in_one_conditional_write(self) -> None:
        table = fake_table(update_item={'Attributes': stored_report()})

        call_custom_reports(_mod, table, 'PUT', body=report_body(title='Renamed', days=180), report_id=REPORT_ID)

        table.update_item.assert_called_once_with(
            Key={'id': REPORT_ID},
            UpdateExpression=(
                'SET #title = :title, #blocks = :blocks, #days = :days, '
                '#updated_at = :updated_at, #updated_by = :updated_by'
            ),
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={
                '#id': 'id',
                '#title': 'title',
                '#blocks': 'blocks',
                '#days': 'days',
                '#updated_at': 'updated_at',
                '#updated_by': 'updated_by',
            },
            ExpressionAttributeValues={
                ':title': 'Renamed',
                ':blocks': [_HEADING, _DATA_BLOCK],
                ':days': 180,
                ':updated_at': FROZEN_TIMESTAMP,
                ':updated_by': CALLER_EMAIL,
            },
            ReturnValues='ALL_NEW',
        )

    def test_answers_200_with_the_row_dynamodb_returns_keeping_its_author(self) -> None:
        updated = stored_report(title='Renamed', days=Decimal(180), updated_by=CALLER_EMAIL)
        table = fake_table(update_item={'Attributes': updated})

        status, body = call_custom_reports(_mod, table, 'PUT', body=report_body(title='Renamed'), report_id=REPORT_ID)

        assert status == 200
        assert (body['report']['title'], body['report']['days']) == ('Renamed', 180)
        assert (body['report']['created_by'], body['report']['updated_by']) == ('author@example.com', CALLER_EMAIL)

    def test_answers_404_when_no_report_has_the_id(self) -> None:
        table = fake_table()
        table.update_item.side_effect = conditional_check_failure('UpdateItem')

        status, body = call_custom_reports(_mod, table, 'PUT', body=report_body(), report_id=REPORT_ID)

        assert (status, body) == (404, _NOT_FOUND)

    def test_answers_500_when_the_write_fails_for_another_reason(self) -> None:
        table = fake_table()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ProvisionedThroughputExceededException', 'Message': 'busy'}}, 'UpdateItem'
        )

        status, body = call_custom_reports(_mod, table, 'PUT', body=report_body(), report_id=REPORT_ID)

        assert (status, body) == (500, {'error': 'Service temporarily unavailable'})

    def test_refuses_an_invalid_body_without_writing(self) -> None:
        table = fake_table()

        status, body = call_custom_reports(_mod, table, 'PUT', body=report_body(title=''), report_id=REPORT_ID)

        assert (status, body) == (400, {'error': 'title too short (min 1 characters)', 'field': 'title'})
        table.update_item.assert_not_called()


class TestDeleteReport:
    def test_deletes_conditionally_and_answers_with_the_deleted_id(self) -> None:
        table = fake_table()

        status, body = call_custom_reports(_mod, table, 'DELETE', report_id=REPORT_ID)

        assert (status, body) == (200, {'deleted': REPORT_ID})
        table.delete_item.assert_called_once_with(
            Key={'id': REPORT_ID},
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )

    def test_answers_404_when_no_report_has_the_id(self) -> None:
        table = fake_table()
        table.delete_item.side_effect = conditional_check_failure('DeleteItem')

        status, body = call_custom_reports(_mod, table, 'DELETE', report_id=REPORT_ID)

        assert (status, body) == (404, _NOT_FOUND)


class TestReportIdGuard:
    @pytest.mark.parametrize('method', ['PUT', 'DELETE'])
    @pytest.mark.parametrize('report_id', ['r' * 65, '', None], ids=['65 characters', 'empty', 'absent'])
    def test_answers_404_without_touching_dynamodb_when_the_id_cannot_name_a_report(
        self, method: str, report_id: str | None
    ) -> None:
        table = fake_table()

        status, body = call_custom_reports(_mod, table, method, body=report_body(), report_id=report_id)

        assert (status, body) == (404, _NOT_FOUND)
        assert table.method_calls == []

    def test_deletes_a_report_whose_id_is_exactly_64_characters(self) -> None:
        table = fake_table()

        status, _ = call_custom_reports(_mod, table, 'DELETE', report_id='r' * 64)

        assert status == 200
        assert table.delete_item.call_args.kwargs['Key'] == {'id': 'r' * 64}


class TestReportFieldValidation:
    @pytest.mark.parametrize(
        ('body', 'expected'),
        [
            ({'blocks': [_DATA_BLOCK]}, {'error': 'Missing required field: title', 'field': 'title'}),
            (report_body(title='   '), {'error': 'title too short (min 1 characters)', 'field': 'title'}),
            (report_body(title='t' * 81), {'error': 'title too long (max 80 characters)', 'field': 'title'}),
            (report_body(title=123), {'error': 'title must be a string', 'field': 'title'}),
            (report_body(title=['Quarterly']), {'error': 'title must be a string', 'field': 'title'}),
            (report_body(days=45), _DAYS_ERROR),
            (report_body(days=True), _DAYS_ERROR),
            (report_body(days='90'), _DAYS_ERROR),
            (report_body(days=90.0), _DAYS_ERROR),
            (report_body(days='ninety'), {'error': 'Invalid type for days: expected int', 'field': 'days'}),
        ],
        ids=[
            'title missing', 'title blank', 'title 81 characters', 'title a number', 'title a list',
            'days not allowed', 'days a boolean', 'days a string', 'days a float', 'days not a number',
        ],
    )
    def test_refuses_the_report_before_any_dynamodb_call(self, body: dict[str, Any], expected: dict[str, str]) -> None:
        status, response, table = create_report_for_test(_mod, body)

        assert (status, response) == (400, expected)
        assert table.method_calls == []

    def test_refuses_a_body_that_is_not_a_json_object(self) -> None:
        status, body, table = post_raw_body(_mod, '["Quarterly visibility"]')

        assert (status, body) == (400, {'error': 'Request body must be a JSON object', 'field': 'body'})
        assert table.method_calls == []

    def test_refuses_a_body_that_is_not_json(self) -> None:
        status, body, _ = post_raw_body(_mod, '{"title": ')

        assert (status, body) == (400, {'error': 'Invalid JSON format'})


class TestBlockListValidation:
    @pytest.mark.parametrize(
        ('blocks', 'message'),
        [
            (None, 'Missing required field: blocks'),
            ('sentiment_headline', 'blocks must be a list'),
            ([], 'blocks must contain at least 1 block'),
            ([_DATA_BLOCK] * 31, 'blocks must contain at most 30 blocks'),
            ([_HEADING, 'sentiment_headline'], 'Block 2: must be an object'),
            ([_HEADING, _DATA_BLOCK, {**_IMAGE, 'url': 'http://example.com/logo.png'}],
             'Block 3: image url must be an https link'),
        ],
        ids=['null', 'not a list', 'empty', '31 blocks', 'block not an object', 'third block invalid'],
    )
    def test_refuses_the_blocks_naming_the_failing_block_by_position(self, blocks: Any, message: str) -> None:
        status, body, table = create_report_for_test(_mod, report_body(blocks=blocks))

        assert (status, body) == (400, {'error': message, 'field': 'blocks'})
        assert table.method_calls == []

    def test_stores_thirty_blocks(self) -> None:
        status, body, _ = create_report_for_test(_mod, report_body(blocks=[_DATA_BLOCK] * 30))

        assert status == 201
        assert body['report']['blocks'] == [_DATA_BLOCK] * 30

    @pytest.mark.parametrize(
        'block',
        [
            {'text': 'No type'},
            {'type': 'h'},
            {'type': 'Heading'},
            {'type': '1heading'},
            {'type': 'sentiment-headline'},
            {'type': 'x' * 49},
            {'type': 'heading\n'},
            {'type': 7},
        ],
        ids=['absent', 'one character', 'uppercase', 'leading digit', 'hyphen', '49 characters', 'trailing newline', 'number'],
    )
    def test_refuses_a_block_type_that_is_not_a_lowercase_identifier(self, block: dict[str, Any]) -> None:
        _, body, _ = create_report_for_test(_mod, single_block_body(block))

        assert body == {'error': _TYPE_ERROR, 'field': 'blocks'}

    def test_stores_an_unknown_data_block_type_as_given(self) -> None:
        block = {'type': 'x' + 'y' * 47}

        _, body, _ = create_report_for_test(_mod, single_block_body(block))

        assert body['report']['blocks'] == [block]

    @pytest.mark.parametrize(
        ('block', 'message'),
        [
            ({'type': 'sentiment_headline', 'color': 'red'}, 'Block 1: sentiment_headline does not accept color'),
            ({**_HEADING, 'id': 'client-key'}, 'Block 1: heading does not accept id'),
            ({**_VIDEO, 'autoplay': True}, 'Block 1: video does not accept autoplay'),
        ],
        ids=['data block', 'heading', 'video'],
    )
    def test_refuses_a_block_carrying_a_key_its_type_does_not_take(self, block: dict[str, Any], message: str) -> None:
        _, body, _ = create_report_for_test(_mod, single_block_body(block))

        assert body == {'error': message, 'field': 'blocks'}


class TestContentBlockValidation:
    @pytest.mark.parametrize(
        ('block', 'message'),
        [
            ({'type': 'heading', 'level': 2}, 'Block 1: heading text is required'),
            ({**_HEADING, 'text': '   '}, 'Block 1: heading text is required'),
            ({**_HEADING, 'text': 'h' * 121}, 'Block 1: heading text must be at most 120 characters'),
            ({**_HEADING, 'text': 5}, 'Block 1: heading text must be a string'),
            ({'type': 'heading', 'text': 'Title'}, 'Block 1: heading level is required'),
            ({**_HEADING, 'level': 1}, 'Block 1: heading level must be 2 or 3'),
            ({**_HEADING, 'level': 4}, 'Block 1: heading level must be 2 or 3'),
            ({**_HEADING, 'level': True}, 'Block 1: heading level must be 2 or 3'),
            ({**_HEADING, 'level': 2.0}, 'Block 1: heading level must be 2 or 3'),
            ({**_HEADING, 'level': '2'}, 'Block 1: heading level must be 2 or 3'),
            ({'type': 'text'}, 'Block 1: text markdown is required'),
            ({'type': 'text', 'markdown': 'm' * 5001}, 'Block 1: text markdown must be at most 5000 characters'),
            ({'type': 'image', 'alt': 'Logo'}, 'Block 1: image url is required'),
            ({'type': 'image', 'url': 'https://example.com/logo.png'}, 'Block 1: image alt is required'),
            ({**_IMAGE, 'alt': 'a' * 201}, 'Block 1: image alt must be at most 200 characters'),
            ({**_IMAGE, 'caption': 'c' * 201}, 'Block 1: image caption must be at most 200 characters'),
            ({**_IMAGE, 'caption': None}, 'Block 1: image caption must be a string'),
            ({**_IMAGE, 'url': 'https://example.com/' + 'a' * 2029}, 'Block 1: image url must be at most 2048 characters'),
            ({**_IMAGE, 'url': 'https://example.com:abc/logo.png'}, 'Block 1: image url must be an https link'),
            ({**_IMAGE, 'url': 'https://example.com:0/logo.png'}, 'Block 1: image url must be an https link'),
            ({**_IMAGE, 'url': 'https://example.com/lo\x00go.png'}, 'Block 1: image url must be an https link'),
            ({**_IMAGE, 'url': 'https://@example.com/logo.png'}, 'Block 1: image url must be an https link'),
            ({**_IMAGE, 'url': 'https://[::1/logo.png'}, 'Block 1: image url must be an https link'),
            ({**_VIDEO, 'caption': 'c' * 201}, 'Block 1: video caption must be at most 200 characters'),
            ({**_VIDEO, 'url': 'https://www.youtube.com:443/watch?v=dQw4w9WgXcQ'},
             'Block 1: video url must be a YouTube or Vimeo video link'),
            ({**_VIDEO, 'url': 'https://youtu.be:/dQw4w9WgXcQ'}, 'Block 1: video url must be a YouTube or Vimeo video link'),
            ({**_VIDEO, 'url': 'https://www.youtube.com/embed/dQw4w9WgXcQ/'},
             'Block 1: video url must be a YouTube or Vimeo video link'),
            ({**_VIDEO, 'url': 'https://player.vimeo.com/video/1234567890123'},
             'Block 1: video url must be a YouTube or Vimeo video link'),
        ],
        ids=[
            'heading text absent', 'heading text blank', 'heading text 121 characters', 'heading text a number',
            'heading level absent', 'heading level 1', 'heading level 4', 'heading level a boolean',
            'heading level a float', 'heading level a string', 'text markdown absent', 'text markdown 5001 characters',
            'image url absent', 'image alt absent', 'image alt 201 characters', 'image caption 201 characters',
            'image caption null', 'image url 2049 characters', 'image url malformed port', 'image url port zero',
            'image url control character', 'image url empty user name', 'image url broken IPv6 host',
            'video caption 201 characters', 'video url explicit port', 'video url empty port',
            'video url trailing slash', 'video url 13-digit Vimeo id',
        ],
    )
    def test_refuses_the_content_block_naming_field_and_problem(self, block: dict[str, Any], message: str) -> None:
        status, body, _ = create_report_for_test(_mod, single_block_body(block))

        assert (status, body) == (400, {'error': message, 'field': 'blocks'})

    @pytest.mark.parametrize(
        ('block', 'stored'),
        [
            ({'type': 'heading', 'text': '  Title  ', 'level': 3}, {'type': 'heading', 'text': 'Title', 'level': 3}),
            ({'type': 'text', 'markdown': '  **Bold** move  '}, {'type': 'text', 'markdown': '**Bold** move'}),
            ({**_IMAGE, 'alt': ' Logo ', 'caption': ' Our logo '}, {**_IMAGE, 'caption': 'Our logo'}),
            ({**_IMAGE, 'caption': '   '}, _IMAGE),
            ({**_VIDEO, 'caption': ' Launch film '}, {**_VIDEO, 'caption': 'Launch film'}),
            ({**_VIDEO, 'caption': ''}, _VIDEO),
            ({'type': 'video', 'url': 'https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ'},
             {'type': 'video', 'url': 'https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ'}),
        ],
        ids=[
            'heading', 'text', 'image with caption', 'image blank caption dropped', 'video with caption',
            'video empty caption dropped', 'video host in mixed case',
        ],
    )
    def test_stores_the_content_block_with_its_strings_stripped(
        self, block: dict[str, Any], stored: dict[str, Any]
    ) -> None:
        _, body, _ = create_report_for_test(_mod, single_block_body(block))

        assert body['report']['blocks'] == [stored]

    @pytest.mark.parametrize(
        'block',
        [
            {**_HEADING, 'text': 'h' * 120},
            {'type': 'text', 'markdown': 'm' * 5000},
            {**_IMAGE, 'alt': 'a' * 200, 'caption': 'c' * 200},
            {**_IMAGE, 'url': 'https://example.com/' + 'a' * 2028},
            {**_VIDEO, 'url': 'https://vimeo.com/123456789012'},
        ],
        ids=['heading text', 'text markdown', 'image alt and caption', 'image url', 'Vimeo id'],
    )
    def test_stores_content_at_its_exact_length_limit(self, block: dict[str, Any]) -> None:
        _, body, _ = create_report_for_test(_mod, single_block_body(block))

        assert body['report']['blocks'] == [block]


class TestSharedLinkVectors:
    """``test-fixtures/custom-report-blocks.json``: the dashboard must agree on every vector."""

    @pytest.mark.parametrize('vector', EMBEDDABLE_VIDEO_LINKS, ids=vector_description)
    def test_stores_a_video_link_the_dashboard_can_embed(self, vector: dict[str, Any]) -> None:
        _, body, _ = create_report_for_test(_mod, single_block_body({'type': 'video', 'url': vector['url']}))

        assert body['report']['blocks'] == [{'type': 'video', 'url': vector['url'].strip()}]

    @pytest.mark.parametrize('vector', UNEMBEDDABLE_VIDEO_LINKS, ids=vector_description)
    def test_refuses_a_video_link_the_dashboard_cannot_embed(self, vector: dict[str, Any]) -> None:
        status, body, _ = create_report_for_test(_mod, single_block_body({'type': 'video', 'url': vector['url']}))

        assert (status, body['field']) == (400, 'blocks')
        assert body['error'] in _LINK_ERRORS['video']

    @pytest.mark.parametrize('vector', VALID_IMAGE_LINKS, ids=vector_description)
    def test_stores_an_https_image_link(self, vector: dict[str, Any]) -> None:
        _, body, _ = create_report_for_test(_mod, single_block_body({**_IMAGE, 'url': vector['url']}))

        assert body['report']['blocks'] == [{**_IMAGE, 'url': vector['url'].strip()}]

    @pytest.mark.parametrize('vector', INVALID_IMAGE_LINKS, ids=vector_description)
    def test_refuses_an_image_link_that_is_not_plain_https(self, vector: dict[str, Any]) -> None:
        status, body, _ = create_report_for_test(_mod, single_block_body({**_IMAGE, 'url': vector['url']}))

        assert (status, body['field']) == (400, 'blocks')
        assert body['error'] in _LINK_ERRORS['image']
