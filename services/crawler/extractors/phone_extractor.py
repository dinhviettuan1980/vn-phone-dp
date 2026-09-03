"""Phone extraction pipeline: regex candidate detection + context window.

Mirrors apps/api/src/extractors/phoneExtractor.ts. Not a single regex pass —
separate handling for visible body text, tel: hrefs, <title>, and meta
description, each tagged with its own extraction_method for provenance.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

from bs4 import BeautifulSoup

PHONE_CANDIDATE_REGEX = re.compile(r"(\+?84|0)(?:[\s.-]?\d){8,10}|1[89]00(?:[\s.-]?\d){4,7}")
CONTEXT_WINDOW_CHARS = 80

_KEYWORD_REGEX = re.compile(r"(hotline|đt|đường dây|liên hệ|sđt|tel|phone|gọi)", re.IGNORECASE)


@dataclass
class PhoneCandidate:
    phone_raw: str
    context_text: str
    context_before: str
    context_after: str
    extraction_method: str
    position_start: int
    position_end: int
    confidence: float


def _clamp_to_paragraph(slice_: str, side: str) -> str:
    """Clamp a context slice to the nearest paragraph boundary within it, so
    a window never bleeds across unrelated <li>/<p> blocks."""
    idx = slice_.rfind("\n") if side == "before" else slice_.find("\n")
    if idx == -1:
        clamped = slice_
    else:
        clamped = slice_[idx + 1:] if side == "before" else slice_[:idx]
    return re.sub(r"\s+", " ", clamped).strip()


def extract_phone_candidates_from_text(text: str, extraction_method: str = "REGEX_TEXT") -> List[PhoneCandidate]:
    candidates: List[PhoneCandidate] = []
    for match in PHONE_CANDIDATE_REGEX.finditer(text):
        phone_raw = match.group(0).strip()
        start, end = match.start(), match.end()

        context_before = _clamp_to_paragraph(text[max(0, start - CONTEXT_WINDOW_CHARS):start], "before")
        context_after = _clamp_to_paragraph(text[end:end + CONTEXT_WINDOW_CHARS], "after")
        context_text = f"{context_before} {phone_raw} {context_after}".strip()

        looks_formatted = bool(re.search(r"[\s.\-]", phone_raw))
        has_keyword = bool(_KEYWORD_REGEX.search(context_text))
        confidence = 0.5
        if looks_formatted:
            confidence += 0.2
        if has_keyword:
            confidence += 0.2
        confidence = min(confidence, 0.95)

        candidates.append(
            PhoneCandidate(
                phone_raw=phone_raw,
                context_text=context_text,
                context_before=context_before,
                context_after=context_after,
                extraction_method=extraction_method,
                position_start=start,
                position_end=end,
                confidence=confidence,
            )
        )
    return candidates


def extract_phone_candidates_from_html(html: str) -> List[PhoneCandidate]:
    soup = BeautifulSoup(html, "html.parser")

    tel_href_candidates: List[PhoneCandidate] = []
    for a in soup.find_all("a", href=True):
        if a["href"].lower().startswith("tel:"):
            phone_raw = a["href"][4:].strip()
            tel_href_candidates.append(
                PhoneCandidate(
                    phone_raw=phone_raw,
                    context_text=phone_raw,
                    context_before="",
                    context_after="",
                    extraction_method="TEL_HREF",
                    position_start=0,
                    position_end=len(phone_raw),
                    confidence=0.9,
                )
            )

    for tag in soup(["script", "style"]):
        tag.decompose()
    # "\n" separator keeps block-level text chunks (li/p/h1/...) distinct so
    # context windows below don't bleed across unrelated list items.
    visible_text = re.sub(r"\n+", "\n", soup.get_text("\n")).strip()
    from_body = extract_phone_candidates_from_text(visible_text, "REGEX_TEXT")

    from_title: List[PhoneCandidate] = []
    if soup.title and soup.title.string:
        from_title = extract_phone_candidates_from_text(soup.title.string, "REGEX_TITLE")

    from_meta: List[PhoneCandidate] = []
    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc and meta_desc.get("content"):
        from_meta = extract_phone_candidates_from_text(meta_desc["content"], "REGEX_META_DESCRIPTION")

    return tel_href_candidates + from_body + from_title + from_meta
