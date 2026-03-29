from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.models import RoomUser, User
from schemas.schemas import UserProfileOut, UserProfileUpdate
from services.deps import get_current_user
from services.profiles import (
    apply_profile_update,
    build_profile_payload,
    get_user_by_id,
    touch_user_last_seen,
)

router = APIRouter(prefix="/profile", tags=["profile"])


async def is_user_online(db: AsyncSession, user_id: int) -> bool:
    result = await db.execute(
        select(RoomUser.id).where(RoomUser.user_id == user_id, RoomUser.is_active == True).limit(1)
    )
    return result.scalar_one_or_none() is not None


@router.get("/me", response_model=UserProfileOut)
async def get_my_profile(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    return await build_profile_payload(db, user, is_online=await is_user_online(db, user.id))


@router.put("/me", response_model=UserProfileOut)
async def update_my_profile(
    payload: UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    apply_profile_update(user, payload)
    await db.commit()
    await db.refresh(user)
    user = await touch_user_last_seen(db, user)
    return await build_profile_payload(db, user, is_online=await is_user_online(db, user.id))


@router.get("/users/{user_id}", response_model=UserProfileOut)
async def get_user_profile(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return await build_profile_payload(db, user, is_online=await is_user_online(db, user.id))
