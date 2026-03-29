from datetime import UTC, datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.models import Room, RoomUser, User
from schemas.schemas import UserProfileUpdate

MAX_AVATAR_BYTES = 600_000


def utcnow() -> datetime:
    return datetime.now(UTC)


def validate_avatar_data(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    avatar = value.strip()
    if not avatar:
        return None
    if not avatar.startswith("data:image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar must be an image"
        )
    if len(avatar) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar is too large"
        )
    return avatar


def apply_profile_update(user: User, payload: UserProfileUpdate):
    fields = payload.model_fields_set
    if "display_name" in fields:
        user.display_name = payload.display_name
    if "status_text" in fields:
        user.status_text = payload.status_text or ""
    if "bio" in fields:
        user.bio = payload.bio or ""
    if "presence" in fields:
        user.presence = payload.presence
    if "avatar_data" in fields:
        user.avatar_data = validate_avatar_data(payload.avatar_data)


async def touch_user_last_seen(db: AsyncSession, user: User):
    user.last_seen_at = utcnow()
    await db.commit()
    await db.refresh(user)
    return user


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_active_room_for_user(db: AsyncSession, user_id: int) -> Optional[Room]:
    result = await db.execute(
        select(Room)
        .join(RoomUser, RoomUser.room_id == Room.id)
        .where(RoomUser.user_id == user_id, RoomUser.is_active == True, RoomUser.is_banned == False)
        .order_by(Room.id.desc())
    )
    return result.scalar_one_or_none()


async def count_rooms_joined(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(func.count(RoomUser.id)).where(
            RoomUser.user_id == user_id, RoomUser.is_banned == False
        )
    )
    return int(result.scalar_one() or 0)


async def count_rooms_owned(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(select(func.count(Room.id)).where(Room.owner_id == user_id))
    return int(result.scalar_one() or 0)


def build_profile_summary(user: User, *, is_online: bool) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "status_text": user.status_text or "",
        "avatar_data": user.avatar_data,
        "presence": user.presence or "online",
        "is_online": is_online,
        "last_seen_at": user.last_seen_at,
    }


async def build_profile_payload(db: AsyncSession, user: User, *, is_online: bool) -> dict:
    active_room = await get_active_room_for_user(db, user.id)
    return {
        **build_profile_summary(user, is_online=is_online),
        "bio": user.bio or "",
        "created_at": user.created_at,
        "rooms_joined": await count_rooms_joined(db, user.id),
        "rooms_owned": await count_rooms_owned(db, user.id),
        "active_room_id": active_room.id if active_room else None,
        "active_room_name": active_room.name if active_room else None,
    }
