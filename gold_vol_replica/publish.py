"""
Publication and Snapshot Archival Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Section 5 (Calculation and Publication Schedule), Section 6 (Index Information).
- Document 2: Section 5 (Calculation, Dissemination and Republication of Volatility Index Spot Values).
"""

from __future__ import annotations

import datetime
import hashlib
import json
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

ET_TZ = ZoneInfo("America/New_York")
UTC_TZ = datetime.timezone.utc
RAW_ARCHIVE_DIR = Path("raw_archive")


@dataclass(frozen=True)
class OutputRecord:
    """Standardized output record produced per calculation clock tick."""
    index_name: str
    timestamp_utc: str
    timestamp_et: str
    index_value: float
    near_expiry: str
    next_expiry: str
    days_to_near_expiry: int
    days_to_next_expiry: int
    n_t1: int
    n_t2: int
    t1: float
    t2: float
    r1: float
    r2: float
    f1: float
    f2: float
    k0_1: float
    k0_2: float
    strikes_used_term1: int
    strikes_used_term2: int
    sigma1_sq: float
    sigma2_sq: float
    filter_status: Dict[str, Any]
    stale: bool
    input_snapshot_hash: str


def compute_snapshot_hash(snapshot_payload: Dict[str, Any]) -> str:
    """
    Computes deterministic SHA-256 hash of an option chain snapshot payload.
    """
    canonical_json = json.dumps(snapshot_payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def archive_raw_snapshot(
    snapshot_payload: Dict[str, Any],
    capture_time_utc: datetime.datetime,
    archive_dir: Path = RAW_ARCHIVE_DIR,
) -> Path:
    """
    Archives raw option chain snapshot under raw_archive/ with its capture timestamp.
    Data Rule: Live snapshots cannot be backfilled; must be archived at ingestion.
    """
    archive_dir.mkdir(parents=True, exist_ok=True)
    time_str = capture_time_utc.strftime("%Y%m%d_%H%M%S_%f")
    snapshot_hash = compute_snapshot_hash(snapshot_payload)[:12]
    filename = f"snapshot_gld_{time_str}_{snapshot_hash}.json"
    target_path = archive_dir / filename

    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "capture_time_utc": capture_time_utc.isoformat(),
                "snapshot_hash": compute_snapshot_hash(snapshot_payload),
                "payload": snapshot_payload,
            },
            f,
            indent=2,
            sort_keys=True,
            default=str,
        )

    return target_path


def format_output_record(
    calc_time_utc: datetime.datetime,
    index_value: float,
    near_expiry: datetime.date,
    next_expiry: datetime.date,
    n_t1: int,
    n_t2: int,
    t1: float,
    t2: float,
    r1: float,
    r2: float,
    f1: float,
    f2: float,
    k0_1: float,
    k0_2: float,
    strikes_used_term1: int,
    strikes_used_term2: int,
    sigma1_sq: float,
    sigma2_sq: float,
    filter_status: Dict[str, Any],
    stale: bool,
    input_snapshot_hash: str,
    index_name: str = "GLD 30-day implied volatility (VIX-methodology replica)",
    decimals: int = 2,
) -> OutputRecord:
    """
    Formats the complete traceable output record as specified by requirements.
    """
    if calc_time_utc.tzinfo is None:
        calc_time_utc = calc_time_utc.replace(tzinfo=UTC_TZ)
    calc_time_et = calc_time_utc.astimezone(ET_TZ)

    days_to_near = (near_expiry - calc_time_et.date()).days
    days_to_next = (next_expiry - calc_time_et.date()).days

    rounded_val = round(index_value, decimals) if math.isfinite(index_value) else float("nan")

    return OutputRecord(
        index_name=index_name,
        timestamp_utc=calc_time_utc.isoformat(),
        timestamp_et=calc_time_et.isoformat(),
        index_value=rounded_val,
        near_expiry=near_expiry.isoformat(),
        next_expiry=next_expiry.isoformat(),
        days_to_near_expiry=days_to_near,
        days_to_next_expiry=days_to_next,
        n_t1=n_t1,
        n_t2=n_t2,
        t1=round(t1, 7),
        t2=round(t2, 7),
        r1=round(r1, 8),
        r2=round(r2, 8),
        f1=round(f1, 5),
        f2=round(f2, 5),
        k0_1=k0_1,
        k0_2=k0_2,
        strikes_used_term1=strikes_used_term1,
        strikes_used_term2=strikes_used_term2,
        sigma1_sq=round(sigma1_sq, 8),
        sigma2_sq=round(sigma2_sq, 8),
        filter_status=filter_status,
        stale=stale,
        input_snapshot_hash=input_snapshot_hash,
    )
