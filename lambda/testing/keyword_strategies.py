"""Hypothesis strategies for keyword texts as the keyword routes receive them.

Shared by the promote-keywords property suites (``test_promote_keywords_*``),
which used to carry their own near-identical copies. The vocabularies are the
union of what those suites generated, so every input either suite exercised is
still drawn here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from hypothesis import strategies as st

# A small vocabulary so existing keywords and request entries collide often.
BASE_TEXTS = st.sampled_from([
    'best running shoes',
    'trail running shoes',
    'marathon training plan',
    'lightweight racing flats',
    'running shoe reviews',
    'seo audit checklist',
])

# Surrounding whitespace only; normalization trims it, so the key is unchanged.
PADDING = st.sampled_from(['', ' ', '  ', '\t', '\n', ' \t '])

# Case transforms that must not change the comparison key either.
CASE_TRANSFORMS = st.sampled_from(['lower', 'upper', 'title', 'capitalize', 'swapcase'])

# Texts that are empty once trimmed.
EMPTY_TEXTS = st.sampled_from(['', ' ', '   ', '\t', '\n', ' \t\n '])

# Optional research-context fields that travel with a keyword into its notes.
CONTEXT_FIELDS = st.fixed_dictionaries(
    {},
    optional={
        'intent': st.sampled_from(['commercial', 'informational']),
        'competition': st.sampled_from(['high', 'low']),
        'source': st.sampled_from(['expansion', 'competitor', 'competitor-analysis']),
    },
)


def variant(text: str, case_transform: str, leading: str, trailing: str) -> str:
    """Build a whitespace/case variant of a text with the same normalized key."""
    return f'{leading}{getattr(text, case_transform)()}{trailing}'


def variants_of(text: str) -> st.SearchStrategy[str]:
    """A strategy for whitespace/case variants of one concrete text."""
    return st.builds(variant, st.just(text), CASE_TRANSFORMS, PADDING, PADDING)


def draw_mixed_request(
    draw: Callable[[st.SearchStrategy[Any]], Any],
    *,
    max_extra_entries: int,
) -> tuple[str, list[dict[str, Any]]]:
    """Draw ``(existing_text, entries)``: a request mixing every skip case, permuted.

    The entries always carry a whitespace/case variant of ``existing_text`` (a
    duplicate of a stored keyword), an entry that is empty after trimming, and
    two variants of one new text (an intra-request repeat that collapses). Up
    to ``max_extra_entries`` further variants or empties are appended before the
    list is permuted, so order carries no meaning. Call from inside an
    ``@st.composite`` strategy with its ``draw``.
    """
    vocabulary = draw(st.lists(BASE_TEXTS, min_size=2, max_size=4, unique=True))
    existing_text, new_text = vocabulary[0], vocabulary[1]

    entries = [
        {**draw(CONTEXT_FIELDS), 'keyword': draw(variants_of(existing_text))},
        {'keyword': draw(EMPTY_TEXTS)},
        {**draw(CONTEXT_FIELDS), 'keyword': draw(variants_of(new_text))},
        {'keyword': draw(variants_of(new_text))},
    ]
    entries.extend(
        draw(
            st.lists(
                st.one_of(
                    st.builds(
                        lambda text, context: {**context, 'keyword': text},
                        st.one_of(*[variants_of(text) for text in vocabulary]),
                        CONTEXT_FIELDS,
                    ),
                    EMPTY_TEXTS.map(lambda text: {'keyword': text}),
                ),
                max_size=max_extra_entries,
            )
        )
    )

    return existing_text, list(draw(st.permutations(entries)))
