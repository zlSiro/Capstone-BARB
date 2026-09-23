from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from barb.utils import (
    humanize_status,
    iso_z,
    normalize_db_status,
    normalize_priority,
    parse_optional_datetime,
    parse_work_order_status,
    safe_int,
    safe_text,
)


@pytest.mark.parametrize(
    "raw,expected",
    [("normal", "medium"), ("critical", "urgent"), ("HIGH", "high"), ("", "medium"), (None, "medium")],
)
def test_normalize_priority(raw, expected):
    assert normalize_priority(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [("open", "pending"), ("Closed", "completed"), ("in progress", "in_progress"), ("overdue", "overdue")],
)
def test_normalize_db_status(raw, expected):
    assert normalize_db_status(raw) == expected


def test_humanize_status_default():
    assert humanize_status("unknown") == "Open"
    assert humanize_status("completed") == "Closed"


def test_parse_optional_datetime_none_variants():
    assert parse_optional_datetime(None) is None
    assert parse_optional_datetime("") is None
    assert parse_optional_datetime("null") is None


def test_parse_optional_datetime_iso_with_z():
    result = parse_optional_datetime("2026-01-01T10:00:00Z")
    assert isinstance(result, datetime)


def test_safe_int_missing_raises_400():
    with pytest.raises(HTTPException) as exc_info:
        safe_int(None, "maquina_id")
    assert exc_info.value.status_code == 400


def test_safe_int_non_numeric_raises_400():
    with pytest.raises(HTTPException):
        safe_int("abc", "maquina_id")


def test_safe_text_default():
    assert safe_text(None, "fallback") == "fallback"
    assert safe_text("  hola  ") == "hola"


def test_iso_z_appends_suffix():
    assert iso_z("2026-01-01T00:00:00") == "2026-01-01T00:00:00Z"
    assert iso_z("2026-01-01T00:00:00Z") == "2026-01-01T00:00:00Z"
    assert iso_z(None) is None


def test_parse_work_order_status_invalid():
    with pytest.raises(HTTPException) as exc_info:
        parse_work_order_status("not-a-status")
    assert exc_info.value.status_code == 400


def test_parse_work_order_status_valid():
    assert parse_work_order_status("closed") == "completed"
