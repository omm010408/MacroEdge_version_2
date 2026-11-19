"""
Index-Level Filtering and Stale Republication Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Section 4 / Page 12 Table (GVZ: RTH, 0.50 points, 30 seconds).
- Document 2: Section 5(a) (Index Level Filtering Algorithm),
              Section 5(b) (Volatility Index Spot Value Cannot be Calculated).
"""

from __future__ import annotations

import datetime
import logging
import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

logger = logging.getLogger("gold_vol_replica.filters")


@dataclass
class FilterTriggerEvent:
    """Record of an index-level filter trigger event for audit compliance."""
    timestamp: datetime.datetime
    calculated_value: float
    baseline_value: float
    drop: float
    threshold_points: float
    action: str
    republished_value: float


@dataclass
class IndexFilterResult:
    """Result of applying the index-level filter to a calculated value."""
    published_value: float
    raw_calculated_value: Optional[float]
    filter_triggered: bool
    stale: bool
    status_reason: str
    baseline_value: Optional[float]
    baseline_timestamp: Optional[datetime.datetime]


class IndexLevelFilter:
    """
    Implements Document 2, Section 5(a) & 5(b):
    - Session baseline tracking with 0.50 point threshold and 30-second window.
    - Upward moves immediately become new baseline.
    - Downward moves < 0.50 points become new baseline.
    - Downward moves >= 0.50 points within 30s are filtered; baseline is republished.
    - After 30s of suppressed drops, the first subsequent value becomes the new baseline.
    - If spot value cannot be calculated, republish last valid value and flag as stale.
    """

    def __init__(
        self,
        threshold_points: float = 0.50,
        threshold_period_seconds: float = 30.0,
    ):
        self.threshold_points = threshold_points
        self.threshold_period_seconds = threshold_period_seconds

        self.current_session_id: Optional[datetime.date] = None
        self.baseline_value: Optional[float] = None
        self.baseline_timestamp: Optional[datetime.datetime] = None
        self.last_valid_published_value: Optional[float] = None
        self.last_valid_published_timestamp: Optional[datetime.datetime] = None

        self.trigger_log: List[FilterTriggerEvent] = []

    def reset_session(self, session_date: datetime.date) -> None:
        """Resets filter baseline state for a new trading day/session."""
        self.current_session_id = session_date
        self.baseline_value = None
        self.baseline_timestamp = None
        self.last_valid_published_value = None
        self.last_valid_published_timestamp = None

    def process_calculation(
        self,
        calculated_value: Optional[float],
        calc_timestamp: datetime.datetime,
    ) -> IndexFilterResult:
        """
        Processes a calculation tick through Document 2, Section 5(a) and 5(b) filters.
        """
        # Auto-reset session if calculation date moves to a new trading day
        calc_date = calc_timestamp.date()
        if self.current_session_id != calc_date:
            self.reset_session(calc_date)

        # Document 2, Section 5(b): Volatility Index Spot Value Cannot be Calculated
        if calculated_value is None or not math.isfinite(calculated_value):
            if self.last_valid_published_value is not None:
                return IndexFilterResult(
                    published_value=self.last_valid_published_value,
                    raw_calculated_value=None,
                    filter_triggered=False,
                    stale=True,
                    status_reason="uncalculable_republished_stale_last_valid",
                    baseline_value=self.baseline_value,
                    baseline_timestamp=self.baseline_timestamp,
                )
            else:
                return IndexFilterResult(
                    published_value=float("nan"),
                    raw_calculated_value=None,
                    filter_triggered=False,
                    stale=True,
                    status_reason="uncalculable_no_prior_valid_value",
                    baseline_value=None,
                    baseline_timestamp=None,
                )

        # Document 2, Section 5(a), Rule 1 & 5:
        # First value calculated in session is deemed the initial baseline
        if self.baseline_value is None or self.baseline_timestamp is None:
            self.baseline_value = calculated_value
            self.baseline_timestamp = calc_timestamp
            self.last_valid_published_value = calculated_value
            self.last_valid_published_timestamp = calc_timestamp
            return IndexFilterResult(
                published_value=calculated_value,
                raw_calculated_value=calculated_value,
                filter_triggered=False,
                stale=False,
                status_reason="first_session_baseline",
                baseline_value=self.baseline_value,
                baseline_timestamp=self.baseline_timestamp,
            )

        elapsed_seconds = (calc_timestamp - self.baseline_timestamp).total_seconds()

        # Rule 2: Values higher than baseline are not filtered; become new baseline
        if calculated_value >= self.baseline_value:
            self.baseline_value = calculated_value
            self.baseline_timestamp = calc_timestamp
            self.last_valid_published_value = calculated_value
            self.last_valid_published_timestamp = calc_timestamp
            return IndexFilterResult(
                published_value=calculated_value,
                raw_calculated_value=calculated_value,
                filter_triggered=False,
                stale=False,
                status_reason="normal_update_increase",
                baseline_value=self.baseline_value,
                baseline_timestamp=self.baseline_timestamp,
            )

        # Calculated value is below baseline
        drop = self.baseline_value - calculated_value

        # Rule 2: Lower by less than x points becomes new baseline
        if drop < self.threshold_points:
            self.baseline_value = calculated_value
            self.baseline_timestamp = calc_timestamp
            self.last_valid_published_value = calculated_value
            self.last_valid_published_timestamp = calc_timestamp
            return IndexFilterResult(
                published_value=calculated_value,
                raw_calculated_value=calculated_value,
                filter_triggered=False,
                stale=False,
                status_reason="normal_update_decrease_within_threshold",
                baseline_value=self.baseline_value,
                baseline_timestamp=self.baseline_timestamp,
            )

        # Drop is >= x points
        # Rule 4: If threshold period has elapsed (> 30s), first value becomes new baseline
        if elapsed_seconds > self.threshold_period_seconds:
            self.baseline_value = calculated_value
            self.baseline_timestamp = calc_timestamp
            self.last_valid_published_value = calculated_value
            self.last_valid_published_timestamp = calc_timestamp
            return IndexFilterResult(
                published_value=calculated_value,
                raw_calculated_value=calculated_value,
                filter_triggered=False,
                stale=False,
                status_reason="baseline_reset_after_threshold_period",
                baseline_value=self.baseline_value,
                baseline_timestamp=self.baseline_timestamp,
            )

        # Rule 3: Within threshold period (<= 30s) and drop >= x: FILTER TRIGGERED!
        event = FilterTriggerEvent(
            timestamp=calc_timestamp,
            calculated_value=calculated_value,
            baseline_value=self.baseline_value,
            drop=drop,
            threshold_points=self.threshold_points,
            action="suppress_calculated_value_republish_baseline",
            republished_value=self.baseline_value,
        )
        self.trigger_log.append(event)
        logger.warning(
            f"Index-level filter triggered at {calc_timestamp.isoformat()}: "
            f"calculated={calculated_value:.2f}, baseline={self.baseline_value:.2f}, "
            f"drop={drop:.2f} >= {self.threshold_points:.2f} within {elapsed_seconds:.1f}s <= {self.threshold_period_seconds:.1f}s. "
            f"Republishing baseline {self.baseline_value:.2f}."
        )

        return IndexFilterResult(
            published_value=self.baseline_value,
            raw_calculated_value=calculated_value,
            filter_triggered=True,
            stale=False,
            status_reason="filter_triggered_large_drop_suppressed",
            baseline_value=self.baseline_value,
            baseline_timestamp=self.baseline_timestamp,
        )
