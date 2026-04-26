"""
Static pricing table for cost estimation.

Format: model_name → (input_$/M, output_$/M, cached_input_$/M | None)
  - cached_input_$/M: cost per million cached/prompt-cached input tokens.
    None means caching is not supported or pricing is unknown for that model.

Sources (verified April 2026):
  OpenAI:    https://platform.openai.com/docs/pricing
  Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
  OpenRouter: https://openrouter.ai/models

⚠ GPT-5.1 cached pricing is estimated (90% discount pattern from gpt-5.2 / gpt-5 family).
  Update when OpenAI publishes exact figures.
"""

# (input_$/M, output_$/M, cached_input_$/M | None)
_EXACT: dict[str, tuple[float, float, float | None]] = {
    # -----------------------------------------------------------------------
    # OpenAI — GPT-4o family
    # -----------------------------------------------------------------------
    "gpt-4o": (2.50, 10.00, 1.25),
    "gpt-4o-2024-11-20": (2.50, 10.00, 1.25),
    "gpt-4o-2024-08-06": (2.50, 10.00, 1.25),
    "gpt-4o-mini": (0.15, 0.60, 0.075),
    "gpt-4o-mini-2024-07-18": (0.15, 0.60, 0.075),
    # -----------------------------------------------------------------------
    # OpenAI — GPT-4.1 family (released April 2025)
    # -----------------------------------------------------------------------
    "gpt-4.1": (2.00, 8.00, 0.50),
    "gpt-4.1-mini": (0.40, 1.60, 0.10),
    "gpt-4.1-nano": (0.10, 0.40, 0.025),
    # -----------------------------------------------------------------------
    # OpenAI — GPT-4 legacy
    # -----------------------------------------------------------------------
    "gpt-4-turbo": (10.00, 30.00, 5.00),
    "gpt-4-turbo-2024-04-09": (10.00, 30.00, 5.00),
    "gpt-4": (30.00, 60.00, None),
    "gpt-3.5-turbo": (0.50, 1.50, None),
    "gpt-3.5-turbo-0125": (0.50, 1.50, None),
    # -----------------------------------------------------------------------
    # OpenAI — GPT-5 family
    # gpt-5.1: estimated at gpt-5 pricing (exact confirmed pricing unavailable)
    # gpt-5.2: $1.75/$14.00 confirmed, 90% cache discount → $0.175 cached
    # -----------------------------------------------------------------------
    "gpt-5": (1.25, 10.00, 0.125),
    "gpt-5-mini": (0.25, 2.00, None),
    "gpt-5.1": (1.25, 10.00, 0.125),   # estimated — same range as gpt-5
    "gpt-5.2": (1.75, 14.00, 0.175),
    # -----------------------------------------------------------------------
    # OpenAI — o-series reasoning models
    # -----------------------------------------------------------------------
    "o1": (15.00, 60.00, 7.50),
    "o1-2024-12-17": (15.00, 60.00, 7.50),
    "o1-mini": (3.00, 12.00, 1.50),
    "o1-mini-2024-09-12": (3.00, 12.00, 1.50),
    "o3": (2.00, 8.00, 0.50),
    "o3-mini": (1.00, 4.00, 0.25),
    "o4-mini": (1.10, 4.40, 0.275),
    # -----------------------------------------------------------------------
    # OpenAI — embeddings (no output tokens, no caching)
    # -----------------------------------------------------------------------
    "text-embedding-3-small": (0.02, 0.00, None),
    "text-embedding-3-large": (0.13, 0.00, None),
    "text-embedding-ada-002": (0.10, 0.00, None),
    # -----------------------------------------------------------------------
    # Anthropic — Claude 4.x (April 2026)
    # Cached read = 10% of base input price (Anthropic's flat rule)
    # -----------------------------------------------------------------------
    "claude-opus-4-7": (5.00, 25.00, 0.50),
    "claude-opus-4-6": (5.00, 25.00, 0.50),
    "claude-opus-4-5": (5.00, 25.00, 0.50),
    "claude-sonnet-4-6": (3.00, 15.00, 0.30),
    "claude-sonnet-4-5": (3.00, 15.00, 0.30),
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
    "claude-haiku-4-5-20251001": (1.00, 5.00, 0.10),
    # -----------------------------------------------------------------------
    # Anthropic — Claude 3.x legacy
    # -----------------------------------------------------------------------
    "claude-3-5-sonnet-20241022": (3.00, 15.00, 0.30),
    "claude-3-5-haiku-20241022": (0.80, 4.00, 0.08),
    "claude-3-opus-20240229": (15.00, 75.00, 1.50),
    "claude-3-sonnet-20240229": (3.00, 15.00, 0.30),
    "claude-3-haiku-20240307": (0.25, 1.25, 0.025),
    # -----------------------------------------------------------------------
    # Google Gemini via OpenRouter (April 2026)
    # -----------------------------------------------------------------------
    "gemini-2.5-pro": (1.25, 10.00, None),
    "gemini-2.5-flash": (0.075, 0.30, None),
    "gemini-2.0-flash": (0.10, 0.40, None),
    "gemini-1.5-pro": (1.25, 5.00, None),
    "gemini-1.5-flash": (0.075, 0.30, None),
    # -----------------------------------------------------------------------
    # Meta Llama via OpenRouter
    # -----------------------------------------------------------------------
    "llama-3.3-70b-instruct": (0.59, 0.79, None),
    "llama-3.1-8b-instruct": (0.055, 0.055, None),
    "llama-3.1-70b-instruct": (0.52, 0.75, None),
    # -----------------------------------------------------------------------
    # Mistral via OpenRouter (April 2026)
    # -----------------------------------------------------------------------
    "mistral-small-2409": (0.10, 0.30, None),
    "mistral-large-2411": (2.00, 6.00, None),
    "mixtral-8x7b-instruct": (0.24, 0.24, None),
    # -----------------------------------------------------------------------
    # DeepSeek via OpenRouter (April 2026)
    # -----------------------------------------------------------------------
    "deepseek-chat": (0.32, 0.89, None),       # DeepSeek V3
    "deepseek-v3.2": (0.252, 0.378, None),
    "deepseek-r1": (0.70, 2.50, None),
}

# Prefix fallbacks — matched after stripping org prefix, longest prefix wins.
_PREFIXES: list[tuple[str, tuple[float, float, float | None]]] = [
    ("gpt-5.2", (1.75, 14.00, 0.175)),
    ("gpt-5.1", (1.25, 10.00, 0.125)),
    ("gpt-5-mini", (0.25, 2.00, None)),
    ("gpt-5", (1.25, 10.00, 0.125)),
    ("gpt-4.1-nano", (0.10, 0.40, 0.025)),
    ("gpt-4.1-mini", (0.40, 1.60, 0.10)),
    ("gpt-4.1", (2.00, 8.00, 0.50)),
    ("gpt-4o-mini", (0.15, 0.60, 0.075)),
    ("gpt-4o", (2.50, 10.00, 1.25)),
    ("gpt-4-turbo", (10.00, 30.00, 5.00)),
    ("gpt-4", (30.00, 60.00, None)),
    ("gpt-3.5", (0.50, 1.50, None)),
    ("o4-mini", (1.10, 4.40, 0.275)),
    ("o3-mini", (1.00, 4.00, 0.25)),
    ("o3", (2.00, 8.00, 0.50)),
    ("o1-mini", (3.00, 12.00, 1.50)),
    ("o1", (15.00, 60.00, 7.50)),
    ("claude-opus-4", (5.00, 25.00, 0.50)),
    ("claude-sonnet-4", (3.00, 15.00, 0.30)),
    ("claude-haiku-4", (1.00, 5.00, 0.10)),
    ("claude-3-5-sonnet", (3.00, 15.00, 0.30)),
    ("claude-3-5-haiku", (0.80, 4.00, 0.08)),
    ("claude-3-opus", (15.00, 75.00, 1.50)),
    ("claude-3-sonnet", (3.00, 15.00, 0.30)),
    ("claude-3-haiku", (0.25, 1.25, 0.025)),
    ("claude-sonnet", (3.00, 15.00, 0.30)),
    ("claude-haiku", (1.00, 5.00, 0.10)),
    ("claude-opus", (5.00, 25.00, 0.50)),
    ("gemini-2.5-pro", (1.25, 10.00, None)),
    ("gemini-2.5-flash", (0.075, 0.30, None)),
    ("gemini-2.5", (1.25, 10.00, None)),
    ("gemini-2.0-flash", (0.10, 0.40, None)),
    ("gemini-2.0", (0.10, 0.40, None)),
    ("gemini-1.5-pro", (1.25, 5.00, None)),
    ("gemini-1.5-flash", (0.075, 0.30, None)),
    ("gemini-1.5", (0.075, 0.30, None)),
    ("text-embedding-3-small", (0.02, 0.00, None)),
    ("text-embedding-3-large", (0.13, 0.00, None)),
    ("text-embedding", (0.10, 0.00, None)),
    ("llama-3.3", (0.59, 0.79, None)),
    ("llama-3.1-8b", (0.055, 0.055, None)),
    ("llama-3.1-70b", (0.52, 0.75, None)),
    ("llama-3", (0.52, 0.75, None)),
    ("mistral-large", (2.00, 6.00, None)),
    ("mistral-small", (0.10, 0.30, None)),
    ("mixtral", (0.24, 0.24, None)),
    ("deepseek-r1", (0.70, 2.50, None)),
    ("deepseek-v3", (0.32, 0.89, None)),
    ("deepseek", (0.32, 0.89, None)),
]


def _normalize(model: str) -> str:
    """Strip org prefix and lowercase. 'openai/gpt-4o' → 'gpt-4o'."""
    return model.split("/")[-1].lower()


def get_pricing(model: str) -> tuple[float, float, float | None] | None:
    """Return (input_$/M, output_$/M, cached_$/M) for a model, or None if unknown."""
    name = _normalize(model)
    if name in _EXACT:
        return _EXACT[name]
    for prefix, price in _PREFIXES:
        if name.startswith(prefix):
            return price
    return None


def estimate_cost(
    model: str,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    cached_tokens: int | None = None,
) -> float | None:
    """
    Return estimated cost in USD, or None if pricing is unknown or no token data.

    cached_tokens: tokens served from prompt cache (already included in prompt_tokens).
    If cached_tokens is provided and the model has a cached rate, those tokens are
    charged at the cached rate; the remainder at the standard input rate.
    """
    if prompt_tokens is None and completion_tokens is None:
        return None
    pricing = get_pricing(model)
    if pricing is None:
        return None

    input_rate, output_rate, cached_rate = pricing
    cost = 0.0

    if prompt_tokens:
        if cached_tokens and cached_rate is not None:
            uncached = max(prompt_tokens - cached_tokens, 0)
            cost += (uncached / 1_000_000) * input_rate
            cost += (cached_tokens / 1_000_000) * cached_rate
        else:
            cost += (prompt_tokens / 1_000_000) * input_rate

    if completion_tokens:
        cost += (completion_tokens / 1_000_000) * output_rate

    return round(cost, 8)
