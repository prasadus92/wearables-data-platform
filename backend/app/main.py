"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import webhooks
from app.api.deps import get_aggregator_client
from app.api.v1 import devices, timeseries, users
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
        aggregator_env=settings.aggregator_environment,
        aggregator_base=settings.aggregator_base_url,
    )
    yield
    await get_aggregator_client().aclose()


app = FastAPI(
    title="ExampleHealth Wearables API",
    description=(
        "Wearable data integration for the ExampleHealth app. Users connect WHOOP/Oura/"
        "Garmin/Apple Watch via Aggregator; biometrics are ingested via webhooks and "
        "served here for timeline charts."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# Demo scope: the web dashboard and Expo app run on other origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/v1")
app.include_router(devices.router, prefix="/v1")
app.include_router(timeseries.router, prefix="/v1")
app.include_router(webhooks.router)


@app.get("/health", response_model=HealthOut, tags=["ops"])
async def health() -> HealthOut:
    return HealthOut(environment=get_settings().environment)
