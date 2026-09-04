import gzip

from domain_discovery.sitemap_parser import parse_sitemap_xml


def test_parses_flat_urlset():
    xml = b"""<?xml version="1.0"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.vn/lien-he</loc></url>
      <url><loc>https://example.vn/blog/1</loc></url>
    </urlset>"""
    result = parse_sitemap_xml(xml)
    assert result.urls == ["https://example.vn/lien-he", "https://example.vn/blog/1"]
    assert result.is_index is False
    assert result.error is None


def test_parses_sitemap_index():
    xml = b"""<?xml version="1.0"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.vn/post-sitemap.xml</loc></sitemap>
      <sitemap><loc>https://example.vn/page-sitemap.xml</loc></sitemap>
    </sitemapindex>"""
    result = parse_sitemap_xml(xml)
    assert result.is_index is True
    assert result.nested_sitemap_urls == [
        "https://example.vn/post-sitemap.xml",
        "https://example.vn/page-sitemap.xml",
    ]
    assert result.urls == []


def test_parses_sitemap_without_namespace():
    # Real-world sitemaps sometimes omit the xmlns despite the spec.
    xml = b"<urlset><url><loc>https://example.vn/a</loc></url></urlset>"
    result = parse_sitemap_xml(xml)
    assert result.urls == ["https://example.vn/a"]


def test_invalid_xml_returns_error_not_exception():
    result = parse_sitemap_xml(b"not xml at all <<<")
    assert result.error is not None
    assert result.urls == []


def test_unrecognized_root_element_returns_error():
    result = parse_sitemap_xml(b"<somethingelse></somethingelse>")
    assert result.error is not None


def test_gzip_compressed_sitemap_is_decompressed():
    xml = b"""<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.vn/gz</loc></url>
    </urlset>"""
    result = parse_sitemap_xml(gzip.compress(xml))
    assert result.urls == ["https://example.vn/gz"]


def test_empty_urlset():
    xml = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
    result = parse_sitemap_xml(xml)
    assert result.urls == []
    assert result.error is None
