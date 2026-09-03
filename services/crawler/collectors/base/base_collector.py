"""Generic collector interface. No crawler in this project should be
hard-coded to a specific website — every source implements this interface
and is registered in config/sources.yaml."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional

from extractors.phone_extractor import PhoneCandidate, extract_phone_candidates_from_html


@dataclass
class FetchedDocument:
    url: str
    final_url: str
    http_status: int
    content_type: str
    raw_content: str
    fetched_at: str  # ISO8601


@dataclass
class DocumentMetadata:
    title: Optional[str] = None


class BaseCollector(ABC):
    """One collector instance is bound to one data_sources row."""

    def __init__(self, source_id: str, source_name: str, base_url: str, crawl_policy: dict):
        self.source_id = source_id
        self.source_name = source_name
        self.base_url = base_url
        self.crawl_policy = crawl_policy or {}

    @abstractmethod
    def discover_urls(self) -> List[str]:
        """Return the list of URLs this source wants crawled. Phase 1 sources
        are config-driven (a fixed URL list), not link-following spiders."""
        raise NotImplementedError

    @abstractmethod
    def fetch(self, url: str) -> FetchedDocument:
        raise NotImplementedError

    def parse(self, document: FetchedDocument) -> str:
        """Return the raw content to persist (HTML as-is in phase 1)."""
        return document.raw_content

    def extract_metadata(self, document: FetchedDocument) -> DocumentMetadata:
        import re

        match = re.search(r"<title[^>]*>([\s\S]*?)</title>", document.raw_content, re.IGNORECASE)
        return DocumentMetadata(title=match.group(1).strip() if match else None)

    def extract_phone_candidates(self, document: FetchedDocument) -> List[PhoneCandidate]:
        return extract_phone_candidates_from_html(document.raw_content)
