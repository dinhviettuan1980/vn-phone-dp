"""Format-specific ingestors only need to answer "what are the headers"
and "give me rows as dicts" -- everything downstream (column detection,
evidence generation, normalization) is shared, see dataset_service.py and
row_processor.py.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterator


class BaseDatasetIngestor(ABC):
    def __init__(self, file_path: Path):
        self.file_path = file_path

    @abstractmethod
    def validate(self) -> None:
        """Raises ValueError if the file isn't readable in this format."""
        raise NotImplementedError

    @abstractmethod
    def headers(self) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def read_rows(self) -> Iterator[dict]:
        raise NotImplementedError
