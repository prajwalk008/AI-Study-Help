"""Lock and unlock passage text stored in Qdrant.
  One secret key does both jobs (AES-256-GCM). Each value gets a fresh random
  starter, and a stamp of which chat, field, and chunk it belongs to. A copied
  value fails to open in the wrong place.
  """
import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from . import config

_PREFIX = "v1."
def _key() -> bytes:
    raw = (config.QDRANT_PAYLOAD_KEY or "").strip()
    if not raw:
        raise RuntimeError("QDRANT_PAYLOAD_KEY is not set.")
    try:
        key = base64.b64decode(raw)
    except Exception as e:
        raise RuntimeError("QDRANT_PAYLOAD_KEY must be base64.") from e
    if len(key) != 32:
        raise RuntimeError("QDRANT_PAYLOAD_KEY must decode to 32 bytes.")
    return key

def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

def _b64d(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)

def _stamp(chat_id: str, field: str, record_id: str) -> bytes:
    return f"qdrant|{chat_id}|{field}|{record_id}".encode("utf-8")

def encrypt_field(value: str, *, field: str, record_id: str, chat_id: str) -> str:
    """Lock a string. Old callers may pass a value that is already locked."""
    if value.startswith(_PREFIX):
        return value
    nonce = os.urandom(12)
    blob = AESGCM(_key()).encrypt(nonce, value.encode("utf-8"), _stamp(chat_id, field, record_id))
    ciphertext, tag = blob[:-16], blob[-16:]
    return f"{_PREFIX}{_b64e(nonce)}.{_b64e(ciphertext)}.{_b64e(tag)}"

def decrypt_field(value: str, *, field: str, record_id: str, chat_id: str) -> str:
    """Unlock a string. Values with no v1. prefix are old plain text and pass through."""
    if not isinstance(value, str) or not value.startswith(_PREFIX):
        return value
    parts = value[len(_PREFIX):].split(".")
    if len(parts) != 3:
        raise ValueError("Locked value is damaged.")
    nonce, ciphertext, tag = (_b64d(parts[0]), _b64d(parts[1]), _b64d(parts[2]))
    try:
        plain = AESGCM(_key()).decrypt(nonce, ciphertext + tag, _stamp(chat_id, field, record_id))
    except InvalidTag as e:
        raise ValueError("Could not unlock this passage. The key is wrong, or the text was changed.") from e
    return plain.decode("utf-8")