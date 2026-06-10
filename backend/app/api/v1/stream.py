"""Server-sent events endpoint for live timeline updates."""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser
from app.services.events import sse_stream

router = APIRouter(prefix="/users/{user_id}", tags=["stream"])


@router.get("/stream")
async def stream_updates(user: CurrentUser) -> StreamingResponse:
    """Stream `update` events whenever new samples are ingested for the user.

    Consume with EventSource; each `update` event carries
    `{"type": "samples", "metrics": ["heartrate", ...], "count": N}`.
    """
    return StreamingResponse(
        sse_stream(user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
