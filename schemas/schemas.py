from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RoomCreate(BaseModel):
    name: str
    is_private: bool = False


class RoomJoin(BaseModel):
    room_id: int


class RoomJoinByCode(BaseModel):
    code: str


class RoomOut(BaseModel):
    id: int
    name: str
    is_private: bool
    owner_id: int
    code: Optional[str] = None

    class Config:
        from_attributes = True


class RoomUserOut(BaseModel):
    id: int
    user_id: int
    room_id: int
    is_muted: bool
    is_banned: bool

    class Config:
        from_attributes = True
