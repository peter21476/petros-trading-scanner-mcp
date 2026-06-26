import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=1)
def get_settings() -> dict[str, str | int | bool]:
    token = os.getenv("PORTFOLIO_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("PORTFOLIO_API_TOKEN is required")

    username = os.getenv("ROBINHOOD_USERNAME", "").strip()
    password = os.getenv("ROBINHOOD_PASSWORD", "").strip()
    if not username or not password:
        raise RuntimeError("ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD are required")

    cache_seconds = int(os.getenv("PORTFOLIO_CACHE_SECONDS", "45"))
    cache_seconds = max(30, min(60, cache_seconds))

    return {
        "portfolio_api_token": token,
        "robinhood_username": username,
        "robinhood_password": password,
        "robinhood_mfa_code": os.getenv("ROBINHOOD_MFA_CODE", "").strip(),
        "cache_seconds": cache_seconds,
        "cors_origins": os.getenv("CORS_ORIGINS", "").strip(),
    }
