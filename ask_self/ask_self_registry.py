"""Registry helpers for ask-self multi-repo RAG indexes."""

from __future__ import annotations

import copy
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ask_self_harness import REPO_ROOT
except ImportError:  # pragma: no cover - package import path
    from .ask_self_harness import REPO_ROOT

REGISTRY_VERSION = 1
DEFAULT_REGISTRY_PATH = REPO_ROOT / "temp" / "rag" / "ask_self_registry.json"


def utc_timestamp() -> str:
    """Return an ISO8601 UTC timestamp."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_registry_path(path: str | Path | None = None) -> Path:
    """Return the registry path, defaulting to the shared ask-self registry."""
    if path is None:
        return DEFAULT_REGISTRY_PATH
    return Path(path).expanduser().resolve()


def registry_relative_path(path: str | Path, registry_path: str | Path | None = None) -> str:
    """Return a portable path value relative to the registry directory."""
    resolved_path = Path(path).expanduser().resolve()
    base_dir = get_registry_path(registry_path).parent
    return os.path.relpath(resolved_path, base_dir)


def resolve_registry_path(path: str | Path, registry_path: str | Path | None = None) -> Path:
    """Resolve a registry path value from the registry directory."""
    raw_path = Path(path).expanduser()
    if raw_path.is_absolute():
        return raw_path.resolve()
    return (get_registry_path(registry_path).parent / raw_path).resolve()


def _empty_registry() -> dict[str, Any]:
    return {
        "version": REGISTRY_VERSION,
        "updated_at": utc_timestamp(),
        "entries": [],
    }


def load_registry(path: str | Path | None = None) -> dict[str, Any]:
    """Load the registry JSON, returning an empty structure when absent."""
    registry_path = get_registry_path(path)
    if not registry_path.exists():
        return _empty_registry()

    with registry_path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)

    if not isinstance(payload, dict):
        raise TypeError("ask_self registry must be a JSON object")

    version = int(payload.get("version") or REGISTRY_VERSION)
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise TypeError("ask_self registry entries must be a list")

    return {
        "version": version,
        "updated_at": str(payload.get("updated_at") or utc_timestamp()),
        "entries": [copy.deepcopy(entry) for entry in entries if isinstance(entry, dict)],
    }


def save_registry(payload: dict[str, Any], path: str | Path | None = None) -> Path:
    """Persist registry JSON via a same-directory atomic replace."""
    registry_path = get_registry_path(path)
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    normalized = {
        "version": int(payload.get("version") or REGISTRY_VERSION),
        "updated_at": str(payload.get("updated_at") or utc_timestamp()),
        "entries": [entry for entry in payload.get("entries", []) if isinstance(entry, dict)],
    }
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=registry_path.parent,
            prefix=f".{registry_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as fh:
            tmp_path = Path(fh.name)
            json.dump(normalized, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, registry_path)
    finally:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink()
    return registry_path


def list_registry_entries(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Return registry entries sorted by slug."""
    payload = load_registry(path)
    entries = [copy.deepcopy(entry) for entry in payload["entries"]]
    entries.sort(key=lambda item: str(item.get("slug") or ""))
    return entries


def upsert_registry_entry(entry: dict[str, Any], path: str | Path | None = None) -> tuple[dict[str, Any], Path]:
    """Insert or replace a registry entry by slug."""
    slug = str(entry.get("slug") or "").strip()
    if not slug:
        raise ValueError("registry entry requires a non-empty slug")

    payload = load_registry(path)
    entries = [copy.deepcopy(item) for item in payload["entries"] if isinstance(item, dict)]
    replaced = False
    for index, existing in enumerate(entries):
        if str(existing.get("slug") or "").strip() == slug:
            entries[index] = copy.deepcopy(entry)
            replaced = True
            break
    if not replaced:
        entries.append(copy.deepcopy(entry))

    entries.sort(key=lambda item: str(item.get("slug") or ""))
    payload["entries"] = entries
    payload["updated_at"] = utc_timestamp()
    registry_path = save_registry(payload, path)
    return copy.deepcopy(entry), registry_path
