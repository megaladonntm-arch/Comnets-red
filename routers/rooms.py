from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.models import Room, RoomUser, User
from schemas.schemas import RoomCreate, RoomJoin, RoomJoinByCode, RoomOut, RoomUserOut
from services.deps import get_current_user
from services.rooms import (
    create_room,
    get_public_rooms,
    get_room_by_code,
    get_room_by_id,
    join_room,
    pick_random_public_room,
)

router = APIRouter(prefix="/rooms")


@router.get("", response_model=list[RoomOut])
async def list_public_rooms(db: AsyncSession = Depends(get_db)):
    return await get_public_rooms(db)


@router.post("/create", response_model=RoomOut)
async def create_room_endpoint(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    room = await create_room(db, payload.name, payload.is_private, user.id)
    # auto-join owner
    await join_room(db, room.id, user.id)
    return room


@router.post("/join", response_model=RoomUserOut)
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
    return room_user


@router.post("/join-by-code", response_model=RoomUserOut)
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
    return room_user


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
    return room
