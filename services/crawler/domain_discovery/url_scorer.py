"""Config-driven URL relevance scoring. No business logic hard-coded here --
edit config/url_scoring.yaml to change what "relevant" means."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "url_scoring.yaml"


@dataclass
class UrlScore:
    url: str
    score: int
    matched_keywords: list[str]
    reason: str


class UrlScorer:
    def __init__(self, config_path: Path = CONFIG_PATH):
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        self.high_priority = config.get("high_priority", [])
        self.medium_priority = config.get("medium_priority", [])
        self.low_priority = config.get("low_priority", [])
        self.default_score = config.get("default_score", 10)
        self.deny_patterns = [p.lower() for p in config.get("deny", [])]

    def score(self, url: str) -> UrlScore:
        lowered = url.lower()

        for deny in self.deny_patterns:
            if deny in lowered:
                return UrlScore(url=url, score=0, matched_keywords=[deny], reason=f"denied by pattern '{deny}'")

        for tier_name, tier in (
            ("high_priority", self.high_priority),
            ("medium_priority", self.medium_priority),
            ("low_priority", self.low_priority),
        ):
            for rule in tier:
                if rule["pattern"].lower() in lowered:
                    return UrlScore(
                        url=url,
                        score=rule["score"],
                        matched_keywords=[rule["pattern"]],
                        reason=f"matched {tier_name} pattern '{rule['pattern']}'",
                    )

        return UrlScore(url=url, score=self.default_score, matched_keywords=[], reason="no pattern matched, default score")


def url_score(url: str, scorer: Optional[UrlScorer] = None) -> UrlScore:
    """Convenience function-style entrypoint matching the spec's
    `url_score(url)` signature; reuses a cached scorer for repeated calls."""
    return (scorer or _default_scorer()).score(url)


_cached_scorer: Optional[UrlScorer] = None


def _default_scorer() -> UrlScorer:
    global _cached_scorer
    if _cached_scorer is None:
        _cached_scorer = UrlScorer()
    return _cached_scorer
