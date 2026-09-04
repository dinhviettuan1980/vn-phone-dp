from dataset_ingestion.column_detector import detect_phone_columns, normalize_column_name


def test_normalizes_vietnamese_diacritics():
    assert normalize_column_name("Điện thoại") == "dien_thoai"
    assert normalize_column_name("SĐT") == "sdt"
    assert normalize_column_name("Số điện thoại") == "so_dien_thoai"


def test_detects_english_phone_column():
    assert detect_phone_columns(["company_name", "phone", "address"]) == ["phone"]


def test_detects_vietnamese_phone_column():
    assert detect_phone_columns(["ten_cong_ty", "Điện thoại", "dia_chi"]) == ["Điện thoại"]


def test_detects_hotline_column():
    assert detect_phone_columns(["name", "Hotline", "category"]) == ["Hotline"]


def test_detects_sdt_abbreviation():
    assert detect_phone_columns(["ten", "SĐT", "dia_chi"]) == ["SĐT"]


def test_no_phone_column_returns_empty():
    assert detect_phone_columns(["name", "address", "category"]) == []


def test_detects_multiple_phone_columns():
    result = detect_phone_columns(["mobile", "hotline", "address"])
    assert set(result) == {"mobile", "hotline"}
