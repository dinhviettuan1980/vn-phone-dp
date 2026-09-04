"""Pure /proc + os.statvfs parsing -- no psutil (not in requirements.txt,
and three numbers don't justify adding a dependency). Each function is
independently testable against fixture strings, not the real machine."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Optional


@dataclass
class Snapshot:
    cpu_percent: Optional[float]
    load_1: float
    load_5: float
    load_15: float
    memory_total_bytes: int
    memory_available_bytes: int
    disk_total_bytes: int
    disk_available_bytes: int


def _read_cpu_line(proc_stat_text: str) -> list[int]:
    """First line of /proc/stat: 'cpu  user nice system idle iowait irq softirq ...'"""
    first_line = proc_stat_text.splitlines()[0]
    return [int(x) for x in first_line.split()[1:]]


def cpu_percent_from_samples(sample_a: str, sample_b: str) -> float:
    """Standard /proc/stat delta method: %busy = 1 - (idle_delta / total_delta)
    between two samples of the same machine taken some time apart."""
    a = _read_cpu_line(sample_a)
    b = _read_cpu_line(sample_b)
    idle_a, idle_b = a[3], b[3]
    total_a, total_b = sum(a), sum(b)

    total_delta = total_b - total_a
    idle_delta = idle_b - idle_a
    if total_delta <= 0:
        return 0.0
    return round((1 - idle_delta / total_delta) * 100, 2)


def read_cpu_percent(sample_interval_seconds: float = 1.0) -> Optional[float]:
    try:
        with open("/proc/stat") as f:
            sample_a = f.read()
        time.sleep(sample_interval_seconds)
        with open("/proc/stat") as f:
            sample_b = f.read()
        return cpu_percent_from_samples(sample_a, sample_b)
    except (FileNotFoundError, IndexError, ValueError):
        return None


def parse_loadavg(proc_loadavg_text: str) -> tuple[float, float, float]:
    parts = proc_loadavg_text.split()
    return float(parts[0]), float(parts[1]), float(parts[2])


def read_loadavg() -> tuple[float, float, float]:
    try:
        with open("/proc/loadavg") as f:
            return parse_loadavg(f.read())
    except (FileNotFoundError, IndexError, ValueError):
        return (0.0, 0.0, 0.0)


def parse_meminfo(proc_meminfo_text: str) -> tuple[int, int]:
    """Returns (total_bytes, available_bytes). MemAvailable (kernel >= 3.14)
    is preferred over MemFree -- it accounts for reclaimable cache/buffers,
    which MemFree does not, so it reflects what's actually usable."""
    values: dict[str, int] = {}
    for line in proc_meminfo_text.splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        digits = rest.strip().split()[0]
        values[key] = int(digits) * 1024  # /proc/meminfo is in kB

    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", values.get("MemFree", 0))
    return total, available


def read_memory() -> tuple[int, int]:
    try:
        with open("/proc/meminfo") as f:
            return parse_meminfo(f.read())
    except FileNotFoundError:
        return (0, 0)


def read_disk(path: str = "/") -> tuple[int, int]:
    """Returns (total_bytes, available_bytes) for the filesystem containing
    path. os.statvfs.f_bavail (available to unprivileged users) rather than
    f_bfree (includes root-reserved blocks) -- matches what the app's own
    disk-writing process could actually use."""
    st = os.statvfs(path)
    total = st.f_frsize * st.f_blocks
    available = st.f_frsize * st.f_bavail
    return total, available


def collect_snapshot() -> Snapshot:
    cpu = read_cpu_percent()
    load_1, load_5, load_15 = read_loadavg()
    mem_total, mem_available = read_memory()
    disk_total, disk_available = read_disk()
    return Snapshot(
        cpu_percent=cpu,
        load_1=load_1,
        load_5=load_5,
        load_15=load_15,
        memory_total_bytes=mem_total,
        memory_available_bytes=mem_available,
        disk_total_bytes=disk_total,
        disk_available_bytes=disk_available,
    )
