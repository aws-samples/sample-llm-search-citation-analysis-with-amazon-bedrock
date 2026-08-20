"""
Every provider must be asked the identical question.

This system's output is a comparison: which providers cite which brands for a
given keyword. That comparison is only valid if the providers were asked the
same thing. They were not.

- OpenAI received `"Search for information about: {keyword}"` via a `default`
  parameter on `build_provider_query`, while Perplexity and Gemini received the
  bare keyword.
- Claude received `keyword + "\\n\\nPlease include source URLs for all
  information provided."`, concatenated onto the keyword in
  `_run_claude_provider` *before* template substitution — so with a persona
  configured, the instruction was injected at whatever position `{keyword}`
  occupied inside the template.

Both differences were uncontrolled variables in the very measurement the
product exists to make. The instruction Claude genuinely needs (it will not
emit source URLs otherwise, and citations are the primary output) now travels
in Claude's *system* prompt, which is provider-specific by design and leaves
the user-facing query untouched.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')
os.environ.setdefault('SEARCH_RESULTS_TABLE', 'test-search')
os.environ.setdefault('PROVIDER_CONFIG_TABLE', 'test-providers')
os.environ.setdefault('DYNAMODB_TABLE_PROVIDER_CONFIG', 'test-providers')
os.environ.setdefault('BRAND_CONFIG_TABLE', 'test-brands')
os.environ.setdefault('DYNAMODB_TABLE_BRAND_CONFIG', 'test-brands')

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_HERE)
for _path in (_LAMBDA_DIR, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

_spec = importlib.util.spec_from_file_location(
    'search_handler_parity', os.path.join(_HERE, 'handler.py')
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['search_handler_parity'] = _mod
_spec.loader.exec_module(_mod)

KEYWORD = 'best hotels near Brussels Airport'
PERSONA = 'I am travelling with two young children. {keyword}'


class TestQueryIsIdenticalAcrossProviders:
    def test_no_persona_sends_the_bare_keyword(self):
        """
        The owner's intended design: no persona configured means the provider
        is asked the keyword and nothing else.
        """
        assert _mod.build_provider_query(KEYWORD, None) == KEYWORD

    def test_empty_persona_template_sends_the_bare_keyword(self):
        """An empty string must behave as 'no template', not produce ''."""
        assert _mod.build_provider_query(KEYWORD, '') == KEYWORD

    def test_persona_template_substitutes_the_keyword(self):
        expected = 'I am travelling with two young children. ' + KEYWORD
        assert _mod.build_provider_query(KEYWORD, PERSONA) == expected

    def test_openai_no_longer_receives_a_search_for_information_wrapper(self):
        """
        REGRESSION: OpenAI alone used to be asked
        "Search for information about: X" while others were asked "X".
        """
        query = _mod.build_provider_query(KEYWORD, None)

        assert 'Search for information about' not in query

    def test_build_provider_query_takes_no_per_provider_default(self):
        """
        The `default` parameter was the mechanism by which one provider's
        wording could drift from the rest. It is gone, so the drift cannot be
        reintroduced without a visible signature change.
        """
        import inspect

        params = list(inspect.signature(_mod.build_provider_query).parameters)

        assert params == ['keyword', 'query_template']


class TestClaudeParity:
    """
    Claude's citation instruction must reach Claude without altering the query.
    """

    @staticmethod
    def _claude_call(query_template: str | None) -> dict:
        """Run the Claude provider and return the kwargs it sent to the client."""
        client = MagicMock()
        client.generate_content.return_value = {'content': []}

        with (
            patch.object(_mod, 'ClaudeClient', MagicMock(return_value=client)),
            patch.object(_mod, 'store_raw_response_to_s3', MagicMock(return_value=None)),
        ):
            _mod._run_claude_provider(KEYWORD, 'test-key', query_template)

        call = client.generate_content.call_args
        return {'query': call.args[0], 'system_prompt': call.kwargs.get('system_prompt')}

    def test_claude_receives_the_same_bare_keyword_as_other_providers(self):
        """
        REGRESSION: the instruction used to be concatenated onto the keyword,
        so Claude's query differed from every other provider's.
        """
        sent = self._claude_call(None)

        assert sent['query'] == KEYWORD

    def test_claude_query_carries_no_citation_instruction(self):
        sent = self._claude_call(None)

        assert 'source URL' not in sent['query']

    def test_citation_instruction_travels_in_the_system_prompt(self):
        """The behaviour the old concatenation existed for is preserved."""
        sent = self._claude_call(None)

        assert sent['system_prompt'] == _mod.CLAUDE_CITATION_SYSTEM_PROMPT

    def test_persona_template_is_not_corrupted_by_the_instruction(self):
        """
        REGRESSION: the instruction was appended to `keyword` *before* template
        substitution, so it was injected wherever `{keyword}` sat inside the
        persona — splicing an instruction into the middle of the user's prompt.
        """
        sent = self._claude_call(PERSONA)

        assert sent['query'] == 'I am travelling with two young children. ' + KEYWORD

    def test_claude_gets_byte_identical_query_to_perplexity(self):
        """
        The parity guarantee stated end to end: same keyword, same persona,
        same string on the wire.
        """
        perplexity_client = MagicMock()
        perplexity_client.chat_completion.return_value = {}

        with (
            patch.object(_mod, 'PerplexityClient', MagicMock(return_value=perplexity_client)),
            patch.object(_mod, 'store_raw_response_to_s3', MagicMock(return_value=None)),
        ):
            _mod._run_perplexity_provider(KEYWORD, 'test-key', PERSONA)

        perplexity_query = perplexity_client.chat_completion.call_args.args[0][0]['content']
        claude_query = self._claude_call(PERSONA)['query']

        assert claude_query == perplexity_query
