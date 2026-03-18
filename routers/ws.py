import json
from typing import Dict, Set, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal
from models.models import Room, RoomUser, User
from services.auth import decode_token
from services.rooms import get_room_by_id, get_room_user

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, Set[WebSocket]] = {}
        self.user_sockets: Dict[Tuple[int, int], WebSocket] = {}
        self.room_users: Dict[int, Set[int]] = {}

    async def connect(self, room_id: int, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active.setdefault(room_id, set()).add(websocket)
        self.user_sockets[(room_id, user_id)] = websocket
        self.room_users.setdefault(room_id, set()).add(user_id)

    def disconnect(self, room_id: int, user_id: int, websocket: WebSocket):
        if room_id in self.active:
            self.active[room_id].discard(websocket)
            if not self.active[room_id]:
                del self.active[room_id]
        self.user_sockets.pop((room_id, user_id), None)
        if room_id in self.room_users:
            self.room_users[room_id].discard(user_id)
            if not self.room_users[room_id]:
                del self.room_users[room_id]

    async def broadcast(self, room_id: int, message: dict):
        if room_id not in self.active:
            return
        data = json.dumps(message)
        for ws in list(self.active[room_id]):
            await ws.send_text(data)

    async def close_user(self, room_id: int, user_id: int):
        ws = self.user_sockets.get((room_id, user_id))
        if ws:
            await ws.close(code=4003)

    async def send_to_user(self, room_id: int, user_id: int, message: dict):
        ws = self.user_sockets.get((room_id, user_id))
        if ws:
            await ws.send_text(json.dumps(message))

    def list_room_users(self, room_id: int) -> list[int]:
        return list(self.room_users.get(room_id, set()))


manager = ConnectionManager()


def get_db() -> AsyncSession:
    return SessionLocal()


@router.websocket("/ws/rooms/{room_id}")
async def room_ws(websocket: WebSocket, room_id: int):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return

    username = decode_token(token)
    if not username:
        await websocket.close(code=4002)
        return

    db = get_db()
    try:
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if not user:
            await websocket.close(code=4002)
            return

        room = await get_room_by_id(db, room_id)
        if not room:
            await websocket.close(code=4004)
            return

        room_user = await get_room_user(db, room_id, user.id)
        if not room_user or room_user.is_banned:
            await websocket.close(code=4003)
            return

        await manager.connect(room_id, user.id, websocket)
        await websocket.send_text(
            json.dumps(
                {
                    "type": "welcome",
                    "user_id": user.id,
                    "participants": [
                        uid for uid in manager.list_room_users(room_id) if uid != user.id
                    ],
                }
            )
        )
        await manager.broadcast(room_id, {"type": "join", "user_id": user.id})

        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "detail": "invalid_json"}))
                continue

            event_type = payload.get("type")
            if event_type == "mute_user":
                target_id = payload.get("user_id")
                try:
                    await handle_mute(db, room, user, target_id)
                except ValueError:
                    await websocket.send_text(json.dumps({"type": "error", "detail": "not_owner"}))
                    continue
                await manager.broadcast(room_id, {"type": "mute_user", "user_id": target_id})
            elif event_type == "ban_user":
                target_id = payload.get("user_id")
                try:
                    await handle_ban(db, room, user, target_id)
                except ValueError:
                    await websocket.send_text(json.dumps({"type": "error", "detail": "not_owner"}))
                    continue
                await manager.broadcast(room_id, {"type": "ban_user", "user_id": target_id})
                await manager.close_user(room_id, target_id)
            elif event_type in {"offer", "answer", "ice"}:
                target_id = payload.get("target_id")
                if not target_id:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "missing_target"})
                    )
                    continue
                relay = {
                    "type": event_type,
                    "from_id": user.id,
                    "payload": payload.get("payload"),
                }
                await manager.send_to_user(room_id, target_id, relay)
            else:
                await websocket.send_text(json.dumps({"type": "error", "detail": "unknown_event"}))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(room_id, user.id if 'user' in locals() else 0, websocket)
        await manager.broadcast(room_id, {"type": "leave", "user_id": user.id if 'user' in locals() else None})
        await db.close()


async def handle_mute(db: AsyncSession, room: Room, actor: User, target_id: int | None):
    if room.owner_id != actor.id:
        raise ValueError("not_owner")
    if not target_id:
        return
    result = await db.execute(
        select(RoomUser).where(RoomUser.room_id == room.id, RoomUser.user_id == target_id)
    )
    ru = result.scalar_one_or_none()
    if not ru:
        return
    ru.is_muted = True
    await db.commit()


async def handle_ban(db: AsyncSession, room: Room, actor: User, target_id: int | None):
    if room.owner_id != actor.id:
        raise ValueError("not_owner")
    if not target_id:
        return
    result = await db.execute(
        select(RoomUser).where(RoomUser.room_id == room.id, RoomUser.user_id == target_id)
    )
    ru = result.scalar_one_or_none()
    if not ru:
        return
    ru.is_banned = True
    await db.commit()
