from extractors.phone_extractor import extract_phone_candidates_from_text, extract_phone_candidates_from_html


def test_extracts_phone_with_context():
    text = (
        "Công ty ABC cung cấp dịch vụ bảo hiểm. "
        "Hotline chăm sóc khách hàng: 0912 345 678. Địa chỉ tại Hà Nội."
    )
    candidates = extract_phone_candidates_from_text(text)
    assert len(candidates) == 1
    assert candidates[0].phone_raw == "0912 345 678"
    assert "Hotline chăm sóc khách hàng" in candidates[0].context_before
    assert "Địa chỉ tại Hà Nội" in candidates[0].context_after
    assert candidates[0].extraction_method == "REGEX_TEXT"


def test_extracts_multiple_numbers():
    text = "Liên hệ 0912345678 hoặc 0987654321 để được tư vấn."
    candidates = extract_phone_candidates_from_text(text)
    assert [c.phone_raw for c in candidates] == ["0912345678", "0987654321"]


def test_keyword_raises_confidence():
    with_kw = extract_phone_candidates_from_text("Hotline: 0912345678")
    without_kw = extract_phone_candidates_from_text("Mã đơn hàng liên quan 0912345678 abc")
    assert with_kw[0].confidence > without_kw[0].confidence


def test_no_candidates_for_phoneless_text():
    candidates = extract_phone_candidates_from_text("Không có số điện thoại nào ở đây cả.")
    assert candidates == []


def test_tel_href_extraction():
    html = '<a href="tel:0912345678">Gọi ngay</a>'
    candidates = extract_phone_candidates_from_html(html)
    tel_candidate = next(c for c in candidates if c.extraction_method == "TEL_HREF")
    assert tel_candidate.phone_raw == "0912345678"
    assert tel_candidate.confidence >= 0.9


def test_ignores_script_and_style_content():
    html = """
      <html><head><style>.x{content:"0999999999"}</style></head>
      <body><script>var fake = "0888888888";</script>
      <p>Hotline: 0912345678</p></body></html>
    """
    candidates = extract_phone_candidates_from_html(html)
    raws = [c.phone_raw.replace(" ", "") for c in candidates]
    assert "0912345678" in raws
    assert "0999999999" not in raws
    assert "0888888888" not in raws


def test_extracts_from_title():
    html = "<html><head><title>Liên hệ 0912345678</title></head><body></body></html>"
    candidates = extract_phone_candidates_from_html(html)
    title_candidate = next(c for c in candidates if c.extraction_method == "REGEX_TITLE")
    assert title_candidate.phone_raw == "0912345678"


def test_extracts_from_meta_description():
    html = '<html><head><meta name="description" content="Gọi 0912345678 để đặt hàng"></head><body></body></html>'
    candidates = extract_phone_candidates_from_html(html)
    meta_candidate = next(c for c in candidates if c.extraction_method == "REGEX_META_DESCRIPTION")
    assert meta_candidate.phone_raw == "0912345678"
