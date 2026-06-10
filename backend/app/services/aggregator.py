"""HTTP client for the Aggregator API.

Thin, typed wrapper around the endpoints we use. Kept deliberately small:
provider quirks live in Aggregator, not here; normalization of inbound data
lives in :mod:`app.services.ingestion`.

The API surface is the rebranded Aggregator v2 API. Endpoint paths and the auth
header are centralized here so a rename on Aggregator's side is a one-line fix.
"""

from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

API_KEY_HEADER = "x-vital-api-key"  # Aggregator kept Aggregator's header post-rebrand


class AggregatorError(Exception):
    """Raised for non-2xx responses from Aggregator."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Aggregator API error {status_code}: {detail}")


class AggregatorClient:
    def __init__(self, settings: Settings | None = None, client: httpx.AsyncClient | None = None):
        self._settings = settings or get_settings()
        self._client = client or httpx.AsyncClient(
            base_url=self._settings.aggregator_base_url,
            headers={API_KEY_HEADER: self._settings.aggregator_api_key},
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
                "aggregator_api_error",
                method=method,
                path=path,
                status=response.status_code,
                body=response.text[:500],
            )
            raise AggregatorError(response.status_code, response.text[:500])
        return response.json()

    # --- Users ---

    async def create_user(self, client_user_id: str) -> dict[str, Any]:
        """Register a user with Aggregator; returns at least ``user_id``."""
        return await self._request("POST", "/v2/user", json={"client_user_id": client_user_id})

    async def delete_user(self, aggregator_user_id: str) -> dict[str, Any]:
        return await self._request("DELETE", f"/v2/user/{aggregator_user_id}")

    async def resolve_user(self, client_user_id: str) -> dict[str, Any]:
        """Look up the Aggregator user for one of our client_user_ids."""
        return await self._request("GET", f"/v2/user/resolve/{client_user_id}")

    # --- Link (provider OAuth) ---

    async def create_link_token(
        self,
        aggregator_user_id: str,
        provider: str | None = None,
        redirect_url: str | None = None,
    ) -> dict[str, Any]:
        """Create a Link token; the user opens the returned hosted Link URL to
        OAuth into their wearable account (WHOOP, Oura, Garmin…)."""
        payload: dict[str, Any] = {"user_id": aggregator_user_id}
        if provider:
            payload["provider"] = provider
        if redirect_url:
            payload["redirect_url"] = redirect_url
        return await self._request("POST", "/v2/link/token", json=payload)

    async def deregister_provider(self, aggregator_user_id: str, provider: str) -> dict[str, Any]:
        """Disconnect flow: revoke the user's provider connection."""
        return await self._request("DELETE", f"/v2/user/{aggregator_user_id}/{provider}")

    async def get_user_connections(self, aggregator_user_id: str) -> dict[str, Any]:
        # Verified against the live API: /v2/user/{id}/providers returns 405,
        # the working shape is /v2/user/providers/{id}.
        return await self._request("GET", f"/v2/user/providers/{aggregator_user_id}")

    async def connect_demo_provider(self, aggregator_user_id: str, provider: str) -> dict[str, Any]:
        """Sandbox only: create a demo connection (oura/fitbit/apple_health_kit)
        with 30 days of synthetic backfill and a simulated webhook lifecycle.

        WHOOP and Garmin have no demo data: they require real devices (and
        WHOOP additionally requires BYOO OAuth credentials).
        """
        return await self._request(
            "POST",
            "/v2/link/connect/demo",
            json={"user_id": aggregator_user_id, "provider": provider},
        )

    async def refresh_user(self, aggregator_user_id: str) -> dict[str, Any]:
        """Force an immediate data refresh (rate-limited to 8/hour/user)."""
        return await self._request("POST", f"/v2/user/refresh/{aggregator_user_id}")

    # --- Data pull (backfill / reconciliation) ---

    async def get_timeseries(
        self,
        aggregator_user_id: str,
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
            "GET", f"/v2/timeseries/{aggregator_user_id}/{resource}/grouped", params=params
        )
