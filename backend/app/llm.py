"""Stage 6 helper: the LLM (Groq). Kept behind a thin wrapper so the provider is swappable
(OpenAI / Gemini / local) without touching the rest of the pipeline."""
from typing import Iterator, List, Dict
from groq import Groq

from . import config

_client = Groq(api_key=config.GROQ_API_KEY)


def stream_chat(messages: List[Dict[str, str]]) -> Iterator[str]:
    """Yield answer tokens as they are generated (for a live 'typing' UI)."""
    stream = _client.chat.completions.create(
        model=config.GROQ_MODEL,
        messages=messages,
        temperature=0.2,  # low temp: we want faithful, grounded answers, not creative ones
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
