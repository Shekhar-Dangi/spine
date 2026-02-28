"""
OpenRouter adapter — thin wrapper around OpenAIAdapter with a fixed base_url.
OpenRouter is OpenAI-compatible; the only difference is the endpoint.
"""
from providers.base import ProviderConfig
from providers.openai_adapter import OpenAIAdapter

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterAdapter(OpenAIAdapter):

    def __init__(self, config: ProviderConfig) -> None:
        if not config.base_url:
            config = ProviderConfig(
                api_key=config.api_key,
                base_url=OPENROUTER_BASE_URL,
                model_map=config.model_map,
            )
        super().__init__(config)
