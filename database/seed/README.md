# Seed data

There are no static `INSERT`-based seed SQL files here on purpose. Static
seed data can't exercise the crawler, extractor, or normalizer — and this
platform's value is that pipeline, not the schema alone.

Instead, `scripts/seed.sh` runs the **real pipeline** against
`services/crawler/fixtures/` (3 synthetic sources — an official org, a
business directory, a low-trust blog — served locally by
`services/crawler/tools/serve_fixtures.py`, entirely fake data, nothing
scraped from any real site or person):

```
1. crawl (real HTTP requests, real robots.txt, real rate limiting)
2. extract phone candidates + context
3. normalize to E.164
4. aggregate into identity candidates
```

Produces (matching the spec's minimum): 10 raw_documents, 50 phone
observations, 20 unique phone numbers — with built-in cases for the same
phone in multiple formats across sources, and a genuinely conflicting
identity (a phone claimed as a legitimate insurance business on one source,
flagged as spam/scam on another). See root `README.md` for the exact
commands.
