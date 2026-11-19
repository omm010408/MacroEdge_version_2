"""
Calculation Pipeline Module for GLD 30-Day Implied Volatility Replica.

Coordinates the end-to-end execution across:
1. Expiry Selection (Nearest Term Method, 7-day exclusion).
2. Time to Expiration (N_T, T).
3. Rates (Bounded Cubic Spline on CMT curve).
4. Forward and K0 calculation.
5. Strike Selection (OTM puts and calls with 2-consecutive zero-bid termination).
6. Single-Term Variances.
7. Constant Maturity Interpolation (30-day).
8. Index-Level Filtering and Stale Republication.
9. Output Record generation and Archival.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from gold_vol_replica.constant_maturity import calculate_constant_maturity_index
from gold_vol_replica.expiry_selection import (
    calculate_minutes_to_expiration,
    calculate_time_to_expiration,
    select_near_and_next_terms,
)
from gold_vol_replica.filters import IndexLevelFilter
from gold_vol_replica.forward_strikes import (
    OptionQuote,
    StrikeQuotePair,
    calculate_forward_price_and_k0,
    select_constituent_strikes,
)
from gold_vol_replica.publish import (
    OutputRecord,
    archive_raw_snapshot,
    compute_snapshot_hash,
    format_output_record,
)
from gold_vol_replica.rates import BoundedCubicSplineYieldCurve

ET_TZ = ZoneInfo("America/New_York")
UTC_TZ = datetime.timezone.utc


@dataclass
class OptionQuoteInput:
    strike: float
    call_bid: Optional[float]
    call_ask: Optional[float]
    put_bid: Optional[float]
    put_ask: Optional[float]
    quote_time_utc: Optional[datetime.datetime] = None
    source_id: Optional[str] = None
    capture_time_utc: Optional[datetime.datetime] = None


class GoldVolReplicaEngine:
    """
    Main calculation engine for GLD 30-day implied volatility replica.
    """

    def __init__(
        self,
        index_filter: Optional[IndexLevelFilter] = None,
        archive_raw: bool = True,
    ):
        self.index_filter = index_filter or IndexLevelFilter(
            threshold_points=0.50,
            threshold_period_seconds=30.0,
        )
        self.archive_raw = archive_raw

    def calculate_replica(
        self,
        calc_time_utc: datetime.datetime,
        chain_by_expiry: Dict[datetime.date, List[OptionQuoteInput]],
        cmt_yields_prior_close: Dict[str, Optional[float]],
        yield_curve_date: datetime.date,
        raw_snapshot_payload: Optional[Dict[str, Any]] = None,
    ) -> OutputRecord:
        """
        Executes a single point-in-time index calculation.
        """
        if calc_time_utc.tzinfo is None:
            calc_time_utc = calc_time_utc.replace(tzinfo=UTC_TZ)
        calc_time_et = calc_time_utc.astimezone(ET_TZ)

        # Snapshot hash
        if raw_snapshot_payload is not None:
            snapshot_hash = compute_snapshot_hash(raw_snapshot_payload)
            if self.archive_raw:
                try:
                    archive_raw_snapshot(raw_snapshot_payload, calc_time_utc)
                except Exception:
                    pass
        else:
            snapshot_hash = "no_raw_payload_provided"

        # Fit Bounded Cubic Spline on CMT curve
        yield_curve = BoundedCubicSplineYieldCurve(cmt_yields_prior_close)

        # 1. Expiry Selection (Nearest Term Method, 7-day exclusion)
        candidate_expiries = list(chain_by_expiry.keys())
        near_term_date, next_term_date = select_near_and_next_terms(
            calc_datetime_et=calc_time_et,
            candidate_expiries=candidate_expiries,
            min_days_to_expiration=7,
        )

        # 2. Time to Expiration
        n_t1 = calculate_minutes_to_expiration(calc_time_et, near_term_date)
        n_t2 = calculate_minutes_to_expiration(calc_time_et, next_term_date)
        t1 = calculate_time_to_expiration(n_t1)
        t2 = calculate_time_to_expiration(n_t2)

        # 3. Interest Rates
        # Days from prior business day's yield curve date to expiration
        days_r1 = (near_term_date - yield_curve_date).days
        days_r2 = (next_term_date - yield_curve_date).days
        r1 = yield_curve.get_continuously_compounded_rate(float(days_r1))
        r2 = yield_curve.get_continuously_compounded_rate(float(days_r2))

        # Build StrikeQuotePairs
        def to_pairs(raw_list: List[OptionQuoteInput]) -> List[StrikeQuotePair]:
            return [
                StrikeQuotePair(
                    strike=item.strike,
                    call=OptionQuote(bid=item.call_bid, ask=item.call_ask),
                    put=OptionQuote(bid=item.put_bid, ask=item.put_ask),
                )
                for item in raw_list
            ]

        pairs_term1 = to_pairs(chain_by_expiry[near_term_date])
        pairs_term2 = to_pairs(chain_by_expiry[next_term_date])

        # Try computing single-term variances
        calc_succeeded = False
        raw_index_val: Optional[float] = None
        f1 = 0.0
        f2 = 0.0
        k0_1 = 0.0
        k0_2 = 0.0
        strikes_used1 = 0
        strikes_used2 = 0
        sigma1_sq = 0.0
        sigma2_sq = 0.0

        try:
            # 4. Forward Price & K0
            from gold_vol_replica.forward_strikes import (
                calculate_forward_price_and_k0,
                select_constituent_strikes,
            )
            from gold_vol_replica.variance import calculate_single_term_variance

            _, f1, k0_1 = calculate_forward_price_and_k0(pairs_term1, r1, t1)
            sel_res1 = select_constituent_strikes(pairs_term1, f1, k0_1)
            var_res1 = calculate_single_term_variance(sel_res1.selected_strikes, f1, k0_1, r1, t1)
            sigma1_sq = var_res1.variance
            strikes_used1 = var_res1.num_strikes_used

            _, f2, k0_2 = calculate_forward_price_and_k0(pairs_term2, r2, t2)
            sel_res2 = select_constituent_strikes(pairs_term2, f2, k0_2)
            var_res2 = calculate_single_term_variance(sel_res2.selected_strikes, f2, k0_2, r2, t2)
            sigma2_sq = var_res2.variance
            strikes_used2 = var_res2.num_strikes_used

            # 8. Constant Maturity Term (30 days)
            cm_res = calculate_constant_maturity_index(n_t1, n_t2, sigma1_sq, sigma2_sq)
            raw_index_val = cm_res.index_value
            calc_succeeded = True
        except Exception:
            # Document 2, Section 5(b): Spot value cannot be calculated
            calc_succeeded = False
            raw_index_val = None

        # 9. Apply Index-Level Filter
        filter_res = self.index_filter.process_calculation(raw_index_val, calc_time_et)

        # 10. Format Output Record
        filter_status_meta = {
            "filter_triggered": filter_res.filter_triggered,
            "status_reason": filter_res.status_reason,
            "raw_calculated_value": (
                round(raw_index_val, 4) if raw_index_val is not None else None
            ),
            "baseline_value": (
                round(filter_res.baseline_value, 4)
                if filter_res.baseline_value is not None
                else None
            ),
        }

        return format_output_record(
            calc_time_utc=calc_time_utc,
            index_value=filter_res.published_value,
            near_expiry=near_term_date,
            next_expiry=next_term_date,
            n_t1=n_t1,
            n_t2=n_t2,
            t1=t1,
            t2=t2,
            r1=r1,
            r2=r2,
            f1=f1,
            f2=f2,
            k0_1=k0_1,
            k0_2=k0_2,
            strikes_used_term1=strikes_used1,
            strikes_used_term2=strikes_used2,
            sigma1_sq=sigma1_sq,
            sigma2_sq=sigma2_sq,
            filter_status=filter_status_meta,
            stale=filter_res.stale,
            input_snapshot_hash=snapshot_hash,
        )
