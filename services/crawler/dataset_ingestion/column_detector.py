"""Detects which column(s) in a dataset row dict hold phone numbers, via
config-driven aliases (config/phone_column_aliases.yaml) rather than
hard-coded column names -- "Điện thoại", "SĐT", "Hotline" all normalize to
forms that match an alias.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import yaml

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "phone_column_aliases.yaml"


def _strip_diacritics(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def normalize_column_name(name: str) -> str:
    stripped = _strip_diacritics(name).lower().strip()
    return re.sub(r"[^a-z0-9]+", "_", stripped).strip("_")


def load_aliases() -> set[str]:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    return {normalize_column_name(a) for a in config.get("aliases", [])}


def detect_phone_columns(headers: list[str]) -> list[str]:
    """Returns the original header strings (preserving case) that look like
    phone columns, so callers can index rows by the original key."""
    aliases = load_aliases()
    return [h for h in headers if normalize_column_name(h) in aliases]
