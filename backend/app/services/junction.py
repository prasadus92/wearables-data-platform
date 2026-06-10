"""HTTP client for the Junction (formerly Vital) API.

Thin, typed wrapper around the endpoints we use. Kept deliberately small:
provider quirks live in Junction, not here; normalization of inbound data
lives in :mod:`app.services.ingestion`.

The API surface is the rebranded Vital v2 API. Endpoint paths and the auth
header are centralized here so a rename on Junction's side is a one-line fix.
"""

from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import JunctionEnvironment, Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

API_KEY_HEADER = "x-vital-api-key"  # Junction kept Vital's header post-rebrand


class JunctionError(Exception):
    """Raised for non-2xx responses from Junction."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Junction API error {status_code}: {detail}")


class JunctionClient:
    def __init__(
        self,
        settings: Settings | None = None,
        client: httpx.AsyncClient | None = None,
        environment: "JunctionEnvironment | None" = None,
    ):
        self._settings = settings or get_settings()
        self.environment = environment or self._settings.junction_environment
        self._client = client or httpx.AsyncClient(
            base_url=self._settings.junction_base_url_for(self.environment),
            headers={API_KEY_HEADER: self._settings.junction_api_key_for(self.environment)},
            timeout=httpx.Timeout(15.0),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        wait=wait_exponential(multiplier=0.5, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = await self._client.request(method, path, **kwargs)
        if response.status_code >= 400:
            logger.warning(
                "junction_api_error",
                method=method,
                path=path,
                status=response.status_code,
                body=response.text[:500],
            )
            raise JunctionError(response.status_code, response.text[:500])
        return response.json()

    # --- Users ---

    async def create_user(self, client_user_id: str) -> dict[str, Any]:
        """Register a user with Junction; returns at least ``user_id``."""
        return await self._request("POST", "/v2/user", json={"client_user_id": client_user_id})

    async def delete_user(self, junction_user_id: str) -> dict[str, Any]:
        return await self._request("DELETE", f"/v2/user/{junction_user_id}")

    async def resolve_user(self, client_user_id: str) -> dict[str, Any]:
        """Look up the Junction user for one of our client_user_ids."""
        return await self._request("GET", f"/v2/user/resolve/{client_user_id}")

    # --- Link (provider OAuth) ---

    async def create_link_token(
        self,
        junction_user_id: str,
        provider: str | None = None,
        redirect_url: str | None = None,
    ) -> dict[str, Any]:
        """Create a Link token; the user opens the returned hosted Link URL to
        OAuth into their wearable account (WHOOP, Oura, Garmin…)."""
        payload: dict[str, Any] = {"user_id": junction_user_id}
        if provider:
            payload["provider"] = provider
        if redirect_url:
            payload["redirect_url"] = redirect_url
        return await self._request("POST", "/v2/link/token", json=payload)

    async def deregister_provider(self, junction_user_id: str, provider: str) -> dict[str, Any]:
        """Disconnect flow: revoke the user's provider connection."""
        return await self._request("DELETE", f"/v2/user/{junction_user_id}/{provider}")

    async def get_user_connections(self, junction_user_id: str) -> dict[str, Any]:
        # Verified against the live API: /v2/user/{id}/providers returns 405,
        # the working shape is /v2/user/providers/{id}.
        return await self._request("GET", f"/v2/user/providers/{junction_user_id}")

    async def connect_demo_provider(self, junction_user_id: str, provider: str) -> dict[str, Any]:
        """Sandbox only: create a demo connection (oura/fitbit/apple_health_kit)
        with 30 days of synthetic backfill and a simulated webhook lifecycle.

        WHOOP and Garmin have no demo data: they require real devices (and
        WHOOP additionally requires BYOO OAuth credentials).
        """
        return await self._request(
            "POST",
            "/v2/link/connect/demo",
            json={"user_id": junction_user_id, "provider": provider},
        )

    async def refresh_user(self, junction_user_id: str) -> dict[str, Any]:
        """Force an immediate data refresh (rate-limited to 8/hour/user)."""
        return await self._request("POST", f"/v2/user/refresh/{junction_user_id}")

    # --- Data pull (backfill / reconciliation) ---

    async def get_timeseries(
        self,
        junction_user_id: str,
        resource: str,
        start_date: str,
        end_date: str,
        provider: str | None = None,
        next_cursor: str | None = None,
    ) -> dict[str, Any] | list[Any]:
        """Pull raw timeseries (e.g. ``heartrate``, ``blood_oxygen``) for a
        date range, using the grouped form (cursor-paginated, samples grouped
        by provider source).

        Webhooks are the primary ingestion path; this exists for initial
        backfill after ``historical.data.*.created`` notifications and for
        gap reconciliation.
        """
        params: dict[str, str] = {"start_date": start_date, "end_date": end_date}
        if provider:
            params["provider"] = provider
        if next_cursor:
            params["next_cursor"] = next_cursor
        return await self._request(
            "GET", f"/v2/timeseries/{junction_user_id}/{resource}/grouped", params=params
        )
