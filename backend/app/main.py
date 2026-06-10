"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import webhooks
from app.api.deps import close_junction_clients, require_auth
from app.api.v1 import devices, stream, timeseries, users
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.schemas import HealthOut

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    logger.info(
        "api_started",
        environment=settings.environment,
        junction_env=settings.junction_environment,
        junction_base=settings.junction_base_url,
    )
    yield
    await close_junction_clients()


app = FastAPI(
    title="YOU(th) Wearables API",
    description=(
        "Wearable data integration for the YOU(th) app. Users connect WHOOP/Oura/"
        "Garmin/Apple Watch via Junction; biometrics are ingested via webhooks and "
        "served here for timeline charts.\n\n"
        "Authentication: all `/v1` routes accept either the service API token or a "
        "Clerk session JWT via `X-API-Key`, `Authorization: Bearer`, or an `api_key` "
        "query parameter (the SSE stream uses the query form because EventSource "
        "cannot send headers). Clerk-authenticated callers are scoped to their own "
        "users and bootstrap their identity via `POST /v1/me`."
    ),
    version="1.0.0",
    lifespan=lifespan,
    openapi_tags=[
        {"name": "users", "description": "App users and their Junction identity mapping."},
        {
            "name": "devices",
            "description": "Wearable connections: hosted OAuth link, listing, disconnect.",
        },
        {
            "name": "timeseries",
            "description": "Biometric timelines with server-side bucketing (raw/hour/day/week).",
        },
        {
            "name": "stream",
            "description": "Server-sent events pushing live updates as new samples are ingested.",
        },
        {
            "name": "sandbox",
            "description": "Demo helpers available only against the Junction sandbox.",
        },
        {
            "name": "webhooks",
            "description": (
                "Inbound event receiver. Deliberately unversioned: the URL is registered "
                "in external dashboards (stability is the contract) and the payload schema "
                "is versioned by the sender. Authenticated by Svix signature, never by API key."
            ),
        },
        {"name": "ops", "description": "Health and operational endpoints."},
    ],
)

# Demo scope: the web dashboard and Expo app run on other origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# All /v1 routes require either the service API key or a Clerk session JWT.
# Webhooks authenticate via the Svix signature instead, and /health stays
# open for load balancer checks.
v1_auth = [Depends(require_auth)]
app.include_router(users.router, prefix="/v1", dependencies=v1_auth)
app.include_router(users.me_router, prefix="/v1", dependencies=v1_auth)
app.include_router(devices.router, prefix="/v1", dependencies=v1_auth)
app.include_router(timeseries.router, prefix="/v1", dependencies=v1_auth)
app.include_router(stream.router, prefix="/v1", dependencies=v1_auth)
app.include_router(webhooks.router)


@app.get("/health", response_model=HealthOut, tags=["ops"])
async def health() -> HealthOut:
    return HealthOut(environment=get_settings().environment)
