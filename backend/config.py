from pathlib import Path
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
PARSED_DIR = STORAGE_DIR / "parsed"
DB_PATH = STORAGE_DIR / "spine.db"
CHROMA_DIR = STORAGE_DIR / "chroma"
KEY_FILE = STORAGE_DIR / ".spine.key"


class Settings(BaseSettings):
    app_name: str = "Spine"
    debug: bool = False
    db_url: str = f"sqlite+aiosqlite:///{DB_PATH}"
    chroma_path: str = str(CHROMA_DIR)
    uploads_path: str = str(UPLOADS_DIR)
    parsed_path: str = str(PARSED_DIR)
    key_file_path: str = str(KEY_FILE)
    # Tavily key loaded from environment; never stored in DB
    tavily_api_key: str = ""

    class Config:
        env_file = BASE_DIR / ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Ensure directories exist at import time
for _dir in (UPLOADS_DIR, PARSED_DIR, CHROMA_DIR):
    _dir.mkdir(parents=True, exist_ok=True)
