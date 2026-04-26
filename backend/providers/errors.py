"""
Typed provider exceptions.

Callers can catch the base ProviderError for all failures,
or catch specific subtypes to handle rate limits, timeouts, and auth errors differently.
"""


class ProviderError(RuntimeError):
    """Base class for all provider-level errors."""


class ProviderRateLimitError(ProviderError):
    """429 — provider is throttling requests. Caller may retry after a delay."""


class ProviderTimeoutError(ProviderError):
    """Request to the provider timed out."""


class ProviderAuthError(ProviderError):
    """401/403 — API key is missing, invalid, or lacks permissions."""
