from __future__ import annotations

import csv
from typing import Iterator

from dataset_ingestion.base_ingestor import BaseDatasetIngestor


class CsvIngestor(BaseDatasetIngestor):
    def validate(self) -> None:
        with open(self.file_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            try:
                next(reader)
            except StopIteration:
                raise ValueError("CSV file is empty")

    def headers(self) -> list[str]:
        with open(self.file_path, "r", encoding="utf-8-sig", newline="") as f:
            return next(csv.reader(f))

    def read_rows(self) -> Iterator[dict]:
        with open(self.file_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                yield row
