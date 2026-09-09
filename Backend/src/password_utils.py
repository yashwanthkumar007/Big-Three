"""
Password hashing utilities for MedInspect.

Passwords are stored in Cosmos DB as werkzeug password hashes (pbkdf2/scrypt).
Legacy documents may still hold plaintext passwords; `verify_password`
transparently validates those and reports when the stored value should be
upgraded to a hash (`needs_rehash=True`).
"""

from werkzeug.security import check_password_hash, generate_password_hash

# Hashes produced by werkzeug always start with "<method>:" e.g. "pbkdf2:sha256:..."
_HASH_PREFIXES = ("pbkdf2:", "scrypt:")


def is_password_hashed(value) -> bool:
    """Return True when the stored value looks like a werkzeug password hash."""
    if not isinstance(value, str):
        return False
    return value.startswith(_HASH_PREFIXES)


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password for storage. Never store the plaintext."""
    return generate_password_hash(plain_password)


def verify_password(stored_password: str, provided_password: str):
    """Validate `provided_password` against `stored_password`.

    Returns a tuple (ok, needs_rehash):
    - ok: True when the password matches.
    - needs_rehash: True when the match succeeded but the stored value is a
      legacy plaintext password and should be replaced with a hash.
    """
    if stored_password is None:
        return False, False
    if is_password_hashed(stored_password):
        try:
            return check_password_hash(stored_password, provided_password), False
        except Exception:
            return False, False
    # Legacy plaintext value
    if stored_password == provided_password:
        return True, True
    return False, False
