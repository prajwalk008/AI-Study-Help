"""Thin wrapper around Groq so the LLM provider can be swapped without touching rag.py."""
from typing import Iterator, List, Dict
from groq import Groq

from . import config

_client = Groq(api_key=config.GROQ_API_KEY)


def stream_chat(messages: List[Dict[str, str]]) -> Iterator[str]:
    stream = _client.chat.completions.create(
        model=config.GROQ_MODEL,
        messages=messages,
        temperature=0.2,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
