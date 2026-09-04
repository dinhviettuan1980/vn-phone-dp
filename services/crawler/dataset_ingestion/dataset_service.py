"""Orchestrates bulk dataset ingestion: pick ingestor by file extension,
record provenance (datasets table), detect phone column(s), and run every
row through the SAME evidence pipeline the HTML crawler uses (row_processor
-> normalizer -> phone_numbers). See docs/PHASE2_IMPLEMENTATION_PLAN.md
Part H/J for why this doesn't duplicate the raw_documents pipeline.
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import psycopg

from dataset_ingestion.base_ingestor import BaseDatasetIngestor
from dataset_ingestion.column_detector import detect_phone_columns
from dataset_ingestion.csv_ingestor import CsvIngestor
from dataset_ingestion.json_ingestor import JsonIngestor
from dataset_ingestion.row_processor import process_row
from dataset_ingestion.xlsx_ingestor import XlsxIngestor
from storage import postgres_repository as repo

logger = logging.getLogger("crawler.dataset_service")

INGESTORS: dict[str, type[BaseDatasetIngestor]] = {
    ".csv": CsvIngestor,
    ".xlsx": XlsxIngestor,
    ".json": JsonIngestor,
}

FORMAT_BY_EXT = {".csv": "CSV", ".xlsx": "XLSX", ".json": "JSON"}


def _file_checksum(file_path: Path) -> str:
    return hashlib.sha256(file_path.read_bytes()).hexdigest()


def ingest_dataset(
    conn: psycopg.Connection,
    file_path: Path,
    source_name: str,
    license_notes: str | None = None,
) -> dict:
    ext = file_path.suffix.lower()
    ingestor_cls = INGESTORS.get(ext)
    if ingestor_cls is None:
        raise ValueError(f"unsupported dataset format '{ext}' -- expected .csv, .xlsx, or .json")

    ingestor = ingestor_cls(file_path)
    ingestor.validate()

    source_id = _upsert_dataset_source(conn, source_name)
    checksum = _file_checksum(file_path)

    dataset = repo.insert_dataset(
        conn,
        source_id=source_id,
        name=file_path.name,
        dataset_format=FORMAT_BY_EXT[ext],
        checksum=checksum,
        license_notes=license_notes,
    )
    dataset_id = dataset["id"]

    if dataset["status"] == "SUCCESS":
        logger.info("[DATASET] dataset=%s already ingested (checksum match), skipping", file_path.name)
        return {"dataset_id": dataset_id, "status": "ALREADY_INGESTED", "rows_processed": 0, "phones_found": 0}

    headers = ingestor.headers()
    phone_columns = detect_phone_columns(headers)
    if not phone_columns:
        repo.update_dataset_progress(conn, dataset_id, 0, "FAILED")
        raise ValueError(f"no phone column detected in headers: {headers}")

    rows_processed = 0
    phones_found = 0
    for row in ingestor.read_rows():
        count = process_row(conn, source_id, dataset_id, rows_processed, row, phone_columns)
        phones_found += count
        rows_processed += 1
        logger.info("[DATASET] dataset=%s row=%d phones_found=%d", file_path.name, rows_processed, count)

    repo.update_dataset_progress(conn, dataset_id, rows_processed, "SUCCESS")

    return {"dataset_id": dataset_id, "status": "SUCCESS", "rows_processed": rows_processed, "phones_found": phones_found}


def _upsert_dataset_source(conn: psycopg.Connection, name: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO data_sources (name, base_url, source_type, trust_level, is_active, license_notes)
            VALUES (%s, %s, 'PUBLIC_DATASET', 'MEDIUM', true, 'Bulk dataset ingestion -- see datasets table for the specific file license_notes.')
            ON CONFLICT (name) DO UPDATE SET updated_at = now()
            RETURNING id
            """,
            (name, f"dataset://{name}"),
        )
        source_id = cur.fetchone()["id"]
    conn.commit()
    return source_id
