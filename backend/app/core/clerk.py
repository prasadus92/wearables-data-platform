"""Clerk session JWT verification.

Clerk signs session tokens with RS256; the public keys are published at
``{issuer}/.well-known/jwks.json``. Verification checks the signature,
expiry/not-before (with a small leeway for clock skew), and the issuer,
then returns the stable Clerk user id from the ``sub`` claim.
"""

from functools import lru_cache

import jwt
from jwt import PyJWKClient

from app.core.config import get_settings

# Tolerated clock skew for exp/nbf/iat validation, in seconds.
LEEWAY_SECONDS = 10


class ClerkAuthError(Exception):
    """Raised when a Clerk session JWT fails verification."""


@lru_cache
def _jwks_client(issuer: str) -> PyJWKClient:
    """Process-wide JWKS client per issuer (caches fetched signing keys)."""
    return PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)


def _signing_key(token: str, issuer: str):
    """Resolve the public key matching the token's ``kid`` from the JWKS.

    Isolated so tests can substitute a locally generated keypair without
    any network access.
    """
    return _jwks_client(issuer).get_signing_key_from_jwt(token).key


def verify_clerk_token(token: str) -> str:
    """Verify a Clerk session JWT and return its ``sub`` claim.

    Raises :class:`ClerkAuthError` if Clerk auth is not configured or the
    token fails any check (signature, exp/nbf, issuer, missing sub).
    """
    issuer = get_settings().clerk_issuer
    if not issuer:
        raise ClerkAuthError("Clerk authentication is not configured")

    try:
        key = _signing_key(token, issuer)
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise ClerkAuthError(f"Invalid Clerk token: {exc}") from exc

    sub = claims.get("sub")
    if not sub:
        raise ClerkAuthError("Clerk token has an empty sub claim")
    return sub
