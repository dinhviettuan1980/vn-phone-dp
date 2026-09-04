"""Unit tests for /proc + statvfs parsing -- fixture strings only, never
dependent on the actual machine running the test (per Phase 2.6 spec)."""
from monitoring.system_metrics import (
    cpu_percent_from_samples,
    parse_loadavg,
    parse_meminfo,
    read_disk,
)

PROC_STAT_A = "cpu  100 0 50 800 10 0 5 0 0 0\ncpu0 50 0 25 400 5 0 2 0 0 0\n"
PROC_STAT_B = "cpu  120 0 60 880 12 0 6 0 0 0\ncpu0 60 0 30 440 6 0 3 0 0 0\n"

PROC_LOADAVG = "0.32 0.41 0.38 1/420 12345\n"

PROC_MEMINFO = (
    "MemTotal:        1965964 kB\n"
    "MemFree:          186552 kB\n"
    "MemAvailable:     879960 kB\n"
    "Buffers:           64168 kB\n"
    "Cached:           593760 kB\n"
)

PROC_MEMINFO_NO_AVAILABLE = "MemTotal:        1000000 kB\nMemFree:          200000 kB\n"


def test_cpu_percent_from_samples_computes_busy_ratio():
    # total_delta = (120+0+60+880+12+0+6) - (100+0+50+800+10+0+5) = 1078-965=113
    # idle_delta = 880-800 = 80
    # busy = 1 - 80/113 = ~0.2920 -> 29.2%
    result = cpu_percent_from_samples(PROC_STAT_A, PROC_STAT_B)
    assert 29.0 < result < 29.5


def test_cpu_percent_from_samples_no_delta_returns_zero():
    result = cpu_percent_from_samples(PROC_STAT_A, PROC_STAT_A)
    assert result == 0.0


def test_parse_loadavg():
    load_1, load_5, load_15 = parse_loadavg(PROC_LOADAVG)
    assert (load_1, load_5, load_15) == (0.32, 0.41, 0.38)


def test_parse_meminfo_prefers_mem_available():
    total, available = parse_meminfo(PROC_MEMINFO)
    assert total == 1965964 * 1024
    assert available == 879960 * 1024


def test_parse_meminfo_falls_back_to_mem_free():
    total, available = parse_meminfo(PROC_MEMINFO_NO_AVAILABLE)
    assert total == 1000000 * 1024
    assert available == 200000 * 1024


def test_read_disk_returns_positive_values_for_root():
    total, available = read_disk("/")
    assert total > 0
    assert 0 <= available <= total
