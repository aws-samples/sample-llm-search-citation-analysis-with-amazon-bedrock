"""
Which model each AI provider is asked to answer with.

One home for the defaults and for reading an administrator's override from the
ProviderConfig row, shared by the search Lambda (analysis runs), the research
worker (keyword research) and the providers API (Settings > AI Providers).
Before 2.17.0 the same ids were hardcoded in about six places and only the
search Lambda's OpenAI call honoured an override that nothing could write.

Every AI engine's model is configurable (Perplexity and Claude since 2.26.0);
an unset or invalid override falls back to the default below.

Perplexity moved from Sonar Chat Completions to the Agent API in 2.37.0 (the
Sonar endpoint was retired on 2026-09-27). Agent API ids carry a vendor prefix
(``perplexity/sonar``, ``openai/gpt-6-luna``); the Sonar ids an administrator
may have saved before (``LEGACY_MODEL_IDS``) are read as the new default.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from typing import Any

from .config import Provider

logger = logging.getLogger(__name__)

DEFAULT_PROVIDER_MODELS: dict[str, str] = {
    Provider.OPENAI: 'gpt-5-mini',
    Provider.PERPLEXITY: 'perplexity/sonar',
    Provider.GEMINI: 'gemini-3.6-flash',
    Provider.CLAUDE: 'claude-sonnet-5-5',
}

#: Providers whose model an administrator may change in Settings.
CONFIGURABLE_MODEL_PROVIDERS = frozenset({Provider.OPENAI, Provider.PERPLEXITY, Provider.GEMINI, Provider.CLAUDE})

#: Saved ids a provider no longer serves -> the id they are read as.
LEGACY_MODEL_IDS: Mapping[str, Mapping[str, str]] = {
    Provider.PERPLEXITY: {
        'sonar': 'perplexity/sonar',
        'sonar-pro': 'perplexity/sonar',
        'sonar-reasoning-pro': 'perplexity/sonar',
    },
}

# Model ids are interpolated into the Gemini URL path
# (`/models/{model}:generateContent`), so anything beyond letters, digits,
# dots, dashes and underscores is refused rather than escaped. Every published
# OpenAI, Gemini and Claude id (`gpt-5.2`, `o4-mini`, `gemini-2.5-flash-lite`,
# `claude-sonnet-4-6`) fits.
_MODEL_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}')
# Perplexity's Agent API ids are `<vendor>/<model>` (`perplexity/sonar`,
# `openai/gpt-6-luna`); they travel only in a JSON body, never in a URL, and
# exactly one slash is allowed.
_VENDOR_MODEL_ID = re.compile(r'[a-z0-9][a-z0-9-]{0,29}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}')


class ProviderConfigUnavailableError(RuntimeError):
    """The provider's config row could not be read, so its model is unknown."""


def is_valid_model_id(value: object, provider_id: str | None = None) -> bool:
    """Whether ``value`` is a model id safe to store and send to ``provider_id``.

    Without a provider only the plain form (no slash) is accepted, the one
    that is safe in every provider's URL; Perplexity also accepts the
    ``<vendor>/<model>`` form of the Agent API.
    """
    if not isinstance(value, str):
        return False
    if _MODEL_ID.fullmatch(value) is not None:
        return True
    return provider_id == Provider.PERPLEXITY and _VENDOR_MODEL_ID.fullmatch(value) is not None


def current_model_id(provider_id: str, model: str) -> str:
    """``model`` with a retired id replaced by the one it is read as (``sonar`` -> ``perplexity/sonar``)."""
    return LEGACY_MODEL_IDS.get(provider_id, {}).get(model, model)


def default_model(provider_id: str) -> str:
    """The model ``provider_id`` answers with when nothing is configured ('' when it has none)."""
    return DEFAULT_PROVIDER_MODELS.get(provider_id, '')


def configured_model(provider_id: str, row: Mapping[str, Any]) -> str | None:
    """The administrator's override on a ProviderConfig ``row``, or ``None``.

    A blank, malformed or non-configurable-provider value is not an override:
    it is ignored rather than sent to the provider. A retired id is read as
    its replacement (``LEGACY_MODEL_IDS``), and is no override when that
    replacement is the default.
    """
    value = row.get('model')
    if provider_id not in CONFIGURABLE_MODEL_PROVIDERS or not is_valid_model_id(value, provider_id):
        return None
    model = current_model_id(provider_id, str(value))
    return None if model == default_model(provider_id) else model


def effective_model(provider_id: str, row: Mapping[str, Any]) -> str:
    """The model a run will actually use for ``provider_id`` given its config ``row``."""
    return configured_model(provider_id, row) or default_model(provider_id)


def read_provider_model(table: Any, provider_id: str) -> str:
    """The model to use for ``provider_id``, read from the ProviderConfig ``table``.

    Fails closed: a DynamoDB error raises ``ProviderConfigUnavailableError``
    instead of falling back to the default, so a transient outage can never
    run a different model than the administrator configured. The caller skips
    the provider (analysis) or fails the step (research).
    """
    try:
        row = table.get_item(Key={'provider_id': provider_id}).get('Item') or {}
    except Exception as error:
        # The message carries the error type only; str(error) can name tables.
        logger.exception(
            'provider_model_read_failed provider=%s error=%s action=fail_closed',
            provider_id, type(error).__name__,
        )
        raise ProviderConfigUnavailableError(f'Cannot read model config for provider {provider_id}') from error
    return effective_model(provider_id, row)


__all__ = [
    'CONFIGURABLE_MODEL_PROVIDERS',
    'DEFAULT_PROVIDER_MODELS',
    'LEGACY_MODEL_IDS',
    'ProviderConfigUnavailableError',
    'configured_model',
    'current_model_id',
    'default_model',
    'effective_model',
    'is_valid_model_id',
    'read_provider_model',
]
