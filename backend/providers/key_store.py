"""
Fernet-based symmetric encryption for API keys.
A machine-local key is generated once and stored in KEY_FILE.
The DB stores only the encrypted blob (key_ref), never plaintext.
"""
import os
from pathlib import Path

from cryptography.fernet import Fernet

from config import settings


def _load_or_create_fernet() -> Fernet:
    key_path = Path(settings.key_file_path)
    if key_path.exists():
        raw = key_path.read_bytes()
    else:
        raw = Fernet.generate_key()
        key_path.parent.mkdir(parents=True, exist_ok=True)
        # Restrict to owner read/write only
        key_path.write_bytes(raw)
        os.chmod(key_path, 0o600)
    return Fernet(raw)


_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = _load_or_create_fernet()
    return _fernet


def encrypt_key(plaintext: str) -> str:
    """Encrypt an API key. Returns URL-safe base64 token."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_key(token: str) -> str:
    """Decrypt a stored token back to plaintext API key."""
    return _get_fernet().decrypt(token.encode()).decode()
