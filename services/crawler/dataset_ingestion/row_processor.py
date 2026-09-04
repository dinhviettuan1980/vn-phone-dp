"""Converts one dataset row into the SAME evidence shape Phase 1's HTML
crawler produces: a raw_document (immutable, one per row) + phone_observation
per detected phone column, run through the EXISTING normalizer. Reuses
storage.postgres_repository verbatim -- no parallel pipeline.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import psycopg

from normalizers.vietnam_phone import normalize_vietnam_phone
from storage import postgres_repository as repo


def _national_number_of(normalized: str, phone_type: str) -> str:
    if phone_type in ("MOBILE", "LANDLINE") and normalized.startswith("+84"):
        return "0" + normalized[3:]
    return normalized


def process_row(
    conn: psycopg.Connection,
    source_id: str,
    dataset_id: str,
    row_index: int,
    row: dict,
    phone_columns: list[str],
) -> int:
    """Returns the number of phone observations created for this row."""
    context_parts = [f"{k}: {v}" for k, v in row.items() if k not in phone_columns and v not in (None, "")]
    context_text = ", ".join(context_parts)

    raw_content = json.dumps(row, ensure_ascii=False)
    content_hash = repo.content_hash_of(f"{dataset_id}:{row_index}:{raw_content}")

    raw_document_id = repo.insert_raw_document(
        conn,
        source_id=source_id,
        crawl_target_id=None,
        url=f"dataset://{dataset_id}/row/{row_index}",
        final_url=f"dataset://{dataset_id}/row/{row_index}",
        title=None,
        content_type="application/dataset-row",
        http_status=None,
        content_hash=content_hash,
        raw_content=raw_content,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    conn.commit()

    observations_created = 0
    for col in phone_columns:
        phone_raw = str(row.get(col, "")).strip()
        if not phone_raw:
            continue

        normalized = normalize_vietnam_phone(phone_raw)
        repo.insert_phone_observation(
            conn,
            raw_document_id=raw_document_id,
            phone_raw=phone_raw,
            phone_normalized=normalized.normalized,
            context_text=context_text,
            context_before="",
            context_after=context_text,
            extraction_method="DATASET_ROW",
            # Structured column data is more reliable than regex-scraped HTML text.
            confidence=0.85,
            position_start=0,
            position_end=len(phone_raw),
        )
        observations_created += 1

        if normalized.normalized:
            national_number = _national_number_of(normalized.normalized, normalized.type)
            repo.upsert_phone_number(
                conn,
                phone_e164=normalized.normalized,
                country_code="84",
                national_number=national_number,
                phone_type=normalized.type,
            )

    conn.commit()
    return observations_created
