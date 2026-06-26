import time
from dataclasses import dataclass
from threading import Lock
from typing import Any


@dataclass
class CacheEntry:
    expires_at: float
    value: Any


class TtlCache:
    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self._lock = Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if time.time() >= entry.expires_at:
                del self._entries[key]
                return None
            return entry.value

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        with self._lock:
            self._entries[key] = CacheEntry(
                expires_at=time.time() + ttl_seconds,
                value=value,
            )

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


portfolio_cache = TtlCache()
