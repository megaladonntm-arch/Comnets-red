from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.models import User
from schemas.schemas import RoomCreate, RoomJoin, RoomJoinByCode, RoomOut
from services.deps import get_current_user
from services.rooms import (
    count_room_users,
    create_room,
    get_public_rooms,
    get_room_by_code,
    get_room_by_id,
    join_room,
    pick_random_public_room,
)

router = APIRouter(prefix="/rooms")


async def serialize_room(db: AsyncSession, room) -> dict:
    return {
        "id": room.id,
        "name": room.name,
        "is_private": room.is_private,
        "owner_id": room.owner_id,
        "code": room.code,
        "owner_username": room.owner_username,
        "whiteboard_enabled": room.whiteboard_enabled,
        "active_users": await count_room_users(db, room.id),
    }


@router.get("", response_model=list[RoomOut])
async def list_public_rooms(db: AsyncSession = Depends(get_db)):
    rooms = await get_public_rooms(db)
    return [await serialize_room(db, room) for room in rooms]


@router.get("/{room_id}", response_model=RoomOut)
async def get_room_endpoint(room_id: int, db: AsyncSession = Depends(get_db)):
    room = await get_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return await serialize_room(db, room)


@router.post("/create", response_model=RoomOut)
async def create_room_endpoint(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    room = await create_room(
        db, payload.name, payload.is_private, user.id, payload.whiteboard_enabled
    )
    # auto-join owner
    await join_room(db, room.id, user.id)
    return await serialize_room(db, room)


@router.post("/join", response_model=RoomOut)
async def join_room_endpoint(
    payload: RoomJoin,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    room = await get_room_by_id(db, payload.room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    if room.is_private:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Room is private")

    room_user, error = await join_room(db, room.id, user.id)
    if error == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are banned")
    if error == "room_full":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Room is full")
    return await serialize_room(db, room)


@router.post("/join-by-code", response_model=RoomOut)
async def join_room_by_code_endpoint(
    payload: RoomJoinByCode,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    room = await get_room_by_code(db, payload.code)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    room_user, error = await join_room(db, room.id, user.id)
    if error == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are banned")
    if error == "room_full":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Room is full")
    return await serialize_room(db, room)


@router.post("/random", response_model=RoomOut)
async def join_random_room_endpoint(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    room = await pick_random_public_room(db)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No available rooms")

    room_user, error = await join_room(db, room.id, user.id)
    if error == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are banned")
    if error == "room_full":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Room is full")
    return await serialize_room(db, room)
