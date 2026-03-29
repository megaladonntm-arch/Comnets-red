from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from config import DATABASE_URL

engine_kwargs = {"echo": False}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_async_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)

Base = declarative_base()


def _ensure_schema(sync_conn):
    inspector = inspect(sync_conn)
    tables = set(inspector.get_table_names())

    if "rooms" in tables:
        room_columns = {column["name"] for column in inspector.get_columns("rooms")}
        if "whiteboard_enabled" not in room_columns:
            sync_conn.execute(
                text(
                    "ALTER TABLE rooms ADD COLUMN whiteboard_enabled BOOLEAN NOT NULL DEFAULT 0"
                )
            )
        if "whiteboard_state" not in room_columns:
            sync_conn.execute(
                text("ALTER TABLE rooms ADD COLUMN whiteboard_state TEXT NOT NULL DEFAULT '{}'")
            )

    if "room_users" in tables:
        room_user_columns = {column["name"] for column in inspector.get_columns("room_users")}
        if "is_active" not in room_user_columns:
            sync_conn.execute(
                text(
                    "ALTER TABLE room_users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 0"
                )
            )


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_schema)


async def get_db():
    async with SessionLocal() as db:
        yield db
