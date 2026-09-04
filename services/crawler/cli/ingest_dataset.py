"""python -m cli.ingest_dataset --file data.csv --source example_dataset"""
from __future__ import annotations

import argparse
from pathlib import Path

from dataset_ingestion.dataset_service import ingest_dataset
from storage import postgres_repository as repo


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--source", required=True, help="Dataset source name (provenance)")
    parser.add_argument("--license-notes", default=None)
    args = parser.parse_args()

    conn = repo.get_connection()
    try:
        result = ingest_dataset(conn, Path(args.file), args.source, args.license_notes)
    finally:
        conn.close()

    print("=====================================")
    print()
    print("DATASET INGESTION REPORT")
    print()
    print("File:")
    print(args.file)
    print()
    print("Status:")
    print(result["status"])
    print()
    print("Rows processed:")
    print(f"{result['rows_processed']:,}")
    print()
    print("Phone observations created:")
    print(f"{result['phones_found']:,}")
    print()
    print("=====================================")


if __name__ == "__main__":
    main()
