import random
import string

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.models import Room, RoomUser

MAX_ROOM_USERS = 4
ROOM_CODE_LENGTH = 5
ROOM_CODE_ALPHABET = string.digits


def generate_room_code() -> str:
    return "".join(random.choices(ROOM_CODE_ALPHABET, k=ROOM_CODE_LENGTH))


async def generate_unique_room_code(db: AsyncSession) -> str:
    for _ in range(20):
        code = generate_room_code()
        if not await get_room_by_code(db, code):
            return code
    raise RuntimeError("failed_to_generate_room_code")


async def get_public_rooms(db: AsyncSession):
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.owner))
        .where(Room.is_private == False)
        .order_by(Room.id.desc())
    )
    return result.scalars().all()


async def get_room_by_id(db: AsyncSession, room_id: int):
    result = await db.execute(
        select(Room).options(selectinload(Room.owner)).where(Room.id == room_id)
    )
    return result.scalar_one_or_none()


async def get_room_by_code(db: AsyncSession, code: str):
    result = await db.execute(
        select(Room).options(selectinload(Room.owner)).where(Room.code == code)
    )
    return result.scalar_one_or_none()


async def count_room_users(db: AsyncSession, room_id: int) -> int:
    result = await db.execute(
        select(func.count(RoomUser.id)).where(
            RoomUser.room_id == room_id,
            RoomUser.is_banned == False,
            RoomUser.is_active == True,
        )
    )
    return int(result.scalar_one())


async def is_user_banned(db: AsyncSession, room_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(RoomUser).where(RoomUser.room_id == room_id, RoomUser.user_id == user_id)
    )
    ru = result.scalar_one_or_none()
    return bool(ru and ru.is_banned)


async def get_room_user(db: AsyncSession, room_id: int, user_id: int):
    result = await db.execute(
        select(RoomUser).where(RoomUser.room_id == room_id, RoomUser.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def join_room(db: AsyncSession, room_id: int, user_id: int):
    room = await get_room_by_id(db, room_id)
    if not room:
        return None, "room_not_found"

    room_user = await get_room_user(db, room_id, user_id)
    if room_user:
        if room_user.is_banned:
            return None, "banned"
        return room_user, None

    if await count_room_users(db, room_id) >= MAX_ROOM_USERS:
        return None, "room_full"

    room_user = RoomUser(user_id=user_id, room_id=room_id)
    db.add(room_user)
    await db.commit()
    await db.refresh(room_user)
    return room_user, None


async def create_room(
    db: AsyncSession, name: str, is_private: bool, owner_id: int, whiteboard_enabled: bool
):
    code = await generate_unique_room_code(db) if is_private else None
    room = Room(
        name=name,
        is_private=is_private,
        code=code,
        owner_id=owner_id,
        whiteboard_enabled=whiteboard_enabled,
    )
    db.add(room)
    await db.commit()
    return await get_room_by_id(db, room.id)


async def pick_random_public_room(db: AsyncSession):
    result = await db.execute(
        select(Room).options(selectinload(Room.owner)).where(Room.is_private == False)
    )
    rooms = result.scalars().all()
    available = []
    for r in rooms:
        if await count_room_users(db, r.id) < MAX_ROOM_USERS:
            available.append(r)
    if not available:
        return None
    return random.choice(available)


async def set_room_user_active(db: AsyncSession, room_id: int, user_id: int, is_active: bool):
    room_user = await get_room_user(db, room_id, user_id)
    if not room_user:
        return None
    room_user.is_active = is_active
    await db.commit()
    await db.refresh(room_user)
    return room_user


async def update_room_user_mute_state(
    db: AsyncSession, room_id: int, user_id: int, is_muted: bool
):
    room_user = await get_room_user(db, room_id, user_id)
    if not room_user:
        return None
    room_user.is_muted = is_muted
    await db.commit()
    await db.refresh(room_user)
    return room_user
