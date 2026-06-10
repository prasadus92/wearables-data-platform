"""User endpoints: registration and Junction identity mapping."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Junction
from app.core.logging import get_logger
from app.models import User
from app.schemas import UserCreate, UserOut
from app.services.junction import JunctionError

logger = get_logger(__name__)
router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DbSession, junction: Junction) -> User:
    """Create an app user and register them with Junction.

    Idempotent on ``client_user_id``: re-posting the same id returns the
    existing user (200 semantics kept simple for the challenge scope).
    """
    existing = (
        await db.execute(select(User).where(User.client_user_id == body.client_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    user = User(client_user_id=body.client_user_id)

    try:
        junction_user = await junction.create_user(body.client_user_id)
        user.junction_user_id = junction_user.get("user_id")
    except JunctionError as exc:
        # 400 on duplicate client_user_id includes the existing user_id —
        # recover the mapping instead of failing registration.
        if exc.status_code == 400 and "user_id" in exc.detail:
            resolved = await junction.resolve_user(body.client_user_id)
            user.junction_user_id = resolved.get("user_id")
        else:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, detail=f"Junction user creation failed: {exc.detail}"
            ) from exc

    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("user_created", user_id=str(user.id), junction_user_id=user.junction_user_id)
    return user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user: CurrentUser) -> User:
    return user
