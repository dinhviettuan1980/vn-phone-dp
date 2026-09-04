from __future__ import annotations

import json
from typing import Iterator

from dataset_ingestion.base_ingestor import BaseDatasetIngestor


class JsonIngestor(BaseDatasetIngestor):
    """Expects a JSON array of flat objects: [{"phone": "...", ...}, ...]."""

    def _load(self) -> list[dict]:
        with open(self.file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            raise ValueError("JSON dataset must be a top-level array of objects")
        return data

    def validate(self) -> None:
        data = self._load()
        if len(data) == 0:
            raise ValueError("JSON dataset is empty")
        if not isinstance(data[0], dict):
            raise ValueError("JSON dataset array must contain objects")

    def headers(self) -> list[str]:
        data = self._load()
        return list(data[0].keys()) if data else []

    def read_rows(self) -> Iterator[dict]:
        for row in self._load():
            yield row
