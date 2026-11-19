"""
Test Suite B: Synthetic Edge Cases for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Sections 2.1, 2.2, 3, 4, 5.
- Document 2: Sections 2(b), 2.1, 3(a), 3(b), 5(a), 5(b).

Coverage of 8 Mandatory Edge Cases:
1. Two consecutive zero-bid strikes stop the scan and exclude all subsequent strikes beyond them.
2. Forward price F exactly on a strike (F=160.0 -> K0=160.0) vs between two strikes (F=158.95 -> K0=157.5).
3. 7-day exclusion rule: Expiry with 6 days remaining is excluded; expiry with 7 days remaining is included.
4. Holiday Friday moves expiration to Thursday (e.g. Good Friday on April 15, 2022 / April 18, 2025).
5. Settlement at 16:00 ET is counted correctly across daylight-saving transitions (EST <-> EDT).
6. All strikes zero-bid: no value published, last valid value republished and flagged stale.
7. Rate requested outside curve range (t > 10950 days) raises explicit error.
8. Move of 0.50 points within 30 seconds triggers index-level filter and republishes baseline.
"""

from __future__ import annotations

import datetime
import math
import unittest
from zoneinfo import ZoneInfo

from gold_vol_replica.constant_maturity import calculate_constant_maturity_index
from gold_vol_replica.expiry_selection import (
    ET_TZ,
    UTC_TZ,
    calculate_minutes_to_expiration,
    get_third_friday_expiration,
    select_near_and_next_terms,
)
from gold_vol_replica.filters import IndexLevelFilter
from gold_vol_replica.forward_strikes import (
    OptionQuote,
    StrikeQuotePair,
    calculate_forward_price_and_k0,
    select_constituent_strikes,
)
from gold_vol_replica.pipeline import (
    GoldVolReplicaEngine,
    OptionQuoteInput,
)
from gold_vol_replica.rates import BoundedCubicSplineYieldCurve


class TestSyntheticEdgeCases(unittest.TestCase):
    """Synthetic unit test cases verifying Cboe methodology compliance."""

    def test_case_1_two_consecutive_zero_bids_stops_scan(self):
        """
        Case 1: Document 2 Section 3(a)(iii) & Document 1 Step 3.
        Verify that once two consecutive strikes have zero bids, those two and all
        subsequent strikes beyond them are excluded, even if further strikes have positive bids.
        """
        # Base strike setup centered around K0 = 100.0
        # Puts below 100: 95, 90, 85, 80, 75
        # 95: bid=1.0 (valid)
        # 90: bid=0.0 (zero bid #1)
        # 85: bid=0.0 (zero bid #2 -> scan stops)
        # 80: bid=2.0 (positive bid, but must be excluded!)
        # 75: bid=2.0 (positive bid, but must be excluded!)
        # Calls above 100: 105, 110, 115, 120, 125
        # 105: bid=1.0 (valid)
        # 110: bid=0.0 (zero bid #1)
        # 115: bid=0.0 (zero bid #2 -> scan stops)
        # 120: bid=2.0 (positive bid, must be excluded!)
        # 125: bid=2.0 (positive bid, must be excluded!)

        strikes = [75.0, 80.0, 85.0, 90.0, 95.0, 100.0, 105.0, 110.0, 115.0, 120.0, 125.0]
        pairs = []
        for k in strikes:
            # At K0=100, both valid
            if k == 100.0:
                c = OptionQuote(bid=3.0, ask=3.2)
                p = OptionQuote(bid=3.0, ask=3.2)
            elif k < 100.0:
                c = OptionQuote(bid=5.0, ask=5.2)  # ITM call (not used)
                if k == 95.0:
                    p = OptionQuote(bid=1.0, ask=1.2)  # OTM put valid
                elif k in (90.0, 85.0):
                    p = OptionQuote(bid=0.0, ask=0.5)  # Zero bids
                else:
                    p = OptionQuote(bid=2.0, ask=2.2)  # Downstream positive bid
            else:
                p = OptionQuote(bid=5.0, ask=5.2)  # ITM put (not used)
                if k == 105.0:
                    c = OptionQuote(bid=1.0, ask=1.2)  # OTM call valid
                elif k in (110.0, 115.0):
                    c = OptionQuote(bid=0.0, ask=0.5)  # Zero bids
                else:
                    c = OptionQuote(bid=2.0, ask=2.2)  # Upstream positive bid
            pairs.append(StrikeQuotePair(strike=k, call=c, put=p))

        res = select_constituent_strikes(pairs, forward_price=100.0, k0=100.0)
        selected_strikes_list = [s.strike for s in res.selected_strikes]

        # Selected should ONLY be [95.0, 100.0, 105.0]
        self.assertEqual(selected_strikes_list, [95.0, 100.0, 105.0])

        # Verify that strikes 80.0 and 75.0 were excluded
        self.assertNotIn(80.0, selected_strikes_list)
        self.assertNotIn(75.0, selected_strikes_list)

        # Verify that strikes 120.0 and 125.0 were excluded
        self.assertNotIn(120.0, selected_strikes_list)
        self.assertNotIn(125.0, selected_strikes_list)

        # Excluded puts should track 90.0 and 85.0
        self.assertIn(90.0, res.excluded_put_strikes)
        self.assertIn(85.0, res.excluded_put_strikes)

    def test_case_2_forward_price_on_strike_vs_between_strikes(self):
        """
        Case 2: Document 2 Section 3(a)(ii).
        Verify K0 selection:
        - When F is exactly on a strike (F=160.0 -> K0=160.0)
        - When F is between strikes (F=158.95 -> K0=157.5)
        """
        # Subcase A: F exactly on strike 160.0
        # ATM strike = 160.0 with Call mid == Put mid => F = 160.0
        pairs_a = [
            StrikeQuotePair(strike=155.0, call=OptionQuote(6.0, 6.2), put=OptionQuote(1.0, 1.2)),
            StrikeQuotePair(strike=157.5, call=OptionQuote(4.5, 4.7), put=OptionQuote(2.0, 2.2)),
            StrikeQuotePair(strike=160.0, call=OptionQuote(3.0, 3.2), put=OptionQuote(3.0, 3.2)),
            StrikeQuotePair(strike=162.5, call=OptionQuote(1.8, 2.0), put=OptionQuote(4.5, 4.7)),
            StrikeQuotePair(strike=165.0, call=OptionQuote(0.8, 1.0), put=OptionQuote(6.0, 6.2)),
        ]
        atm_a, f_a, k0_a = calculate_forward_price_and_k0(
            pairs_a, risk_free_rate_r=0.03, time_to_expiration_t=0.1
        )
        self.assertAlmostEqual(f_a, 160.0, places=5)
        self.assertEqual(k0_a, 160.0)

        # Subcase B: F between strikes (e.g. F=158.94998 with grid [..., 155.0, 157.5, 160.0, ...])
        # ATM strike = 160.0, Call mid = 3.10, Put mid = 4.15
        # e^(R*T) = 1.0, F = 160.0 + (3.10 - 4.15) = 158.95
        pairs_b = [
            StrikeQuotePair(strike=155.0, call=OptionQuote(6.0, 6.2), put=OptionQuote(1.0, 1.2)),
            StrikeQuotePair(strike=157.5, call=OptionQuote(4.5, 4.7), put=OptionQuote(2.0, 2.2)),
            StrikeQuotePair(strike=160.0, call=OptionQuote(3.0, 3.2), put=OptionQuote(4.1, 4.2)),  # mid C=3.1, P=4.15 => diff=1.05
            StrikeQuotePair(strike=162.5, call=OptionQuote(1.8, 2.0), put=OptionQuote(5.5, 5.7)),
        ]
        atm_b, f_b, k0_b = calculate_forward_price_and_k0(
            pairs_b, risk_free_rate_r=0.0, time_to_expiration_t=0.1
        )
        self.assertAlmostEqual(f_b, 158.95, places=4)
        self.assertEqual(k0_b, 157.5)

    def test_case_3_seven_day_exclusion_rule(self):
        """
        Case 3: Document 1 Section 2.1 (GVZ Row) & Step 1.
        Expiry with 6 days remaining is excluded (< 7 days);
        Expiry with 7 days remaining is included (>= 7 days).
        """
        calc_dt = datetime.datetime(2026, 4, 10, 10, 0, 0, tzinfo=ET_TZ)
        calc_date = calc_dt.date()  # 2026-04-10

        exp_6_days = calc_date + datetime.timedelta(days=6)   # 2026-04-16 (6 days)
        exp_7_days = calc_date + datetime.timedelta(days=7)   # 2026-04-17 (7 days)
        exp_35_days = calc_date + datetime.timedelta(days=35) # 2026-05-15 (35 days)

        candidates = [exp_6_days, exp_7_days, exp_35_days]
        near_term, next_term = select_near_and_next_terms(
            calc_datetime_et=calc_dt,
            candidate_expiries=candidates,
            min_days_to_expiration=7,
        )

        # exp_6_days must be excluded; near-term must be exp_7_days
        self.assertEqual(near_term, exp_7_days)
        self.assertEqual(next_term, exp_35_days)

        # When only 6-day and 35-day expiries are provided, an error must be raised
        # because only 1 valid expiry remains after the 7-day filter
        with self.assertRaises(ValueError):
            select_near_and_next_terms(
                calc_datetime_et=calc_dt,
                candidate_expiries=[exp_6_days, exp_35_days],
                min_days_to_expiration=7,
            )

    def test_case_4_holiday_friday_moves_expiry_to_thursday(self):
        """
        Case 4: Document 1 Section 2.1 Table.
        PM-settled GLD options expiring on third Friday of the month, or
        the Thursday before if that Friday is an exchange holiday.
        """
        # Test Good Friday in 2022: April 15, 2022 was Good Friday.
        # The third Friday expiration must move to Thursday, April 14, 2022.
        exp_2022_04 = get_third_friday_expiration(2022, 4)
        self.assertEqual(exp_2022_04, datetime.date(2022, 4, 14))
        self.assertEqual(exp_2022_04.weekday(), 3)  # Thursday

        # Test Good Friday in 2025: April 18, 2025 is Good Friday.
        # The third Friday expiration must move to Thursday, April 17, 2025.
        exp_2025_04 = get_third_friday_expiration(2025, 4)
        self.assertEqual(exp_2025_04, datetime.date(2025, 4, 17))
        self.assertEqual(exp_2025_04.weekday(), 3)  # Thursday

        # Test normal month without holiday: May 2026
        # Third Friday of May 2026 is May 15, 2026.
        exp_2026_05 = get_third_friday_expiration(2026, 5)
        self.assertEqual(exp_2026_05, datetime.date(2026, 5, 15))
        self.assertEqual(exp_2026_05.weekday(), 4)  # Friday

    def test_case_5_settlement_minutes_across_dst_transitions(self):
        """
        Case 5: Document 2 Section 3(a)(i).
        Settlement at 16:00 ET counted correctly across DST transitions:
        - Spring forward (March): loss of 1 hour (60 minutes).
        - Fall back (November): gain of 1 hour (60 minutes).
        """
        # 1. Spring Forward 2026: March 8, 2026 (clocks jump 02:00 -> 03:00 EST to EDT)
        # From Friday 2026-03-06 16:00 ET (EST, UTC-5) to Monday 2026-03-09 16:00 ET (EDT, UTC-4)
        # Wall clock says 72 hours, but actual elapsed time is 71 hours = 4,260 minutes.
        start_spring = datetime.datetime(2026, 3, 6, 16, 0, 0, tzinfo=ET_TZ)
        expiry_spring = datetime.date(2026, 3, 9)
        minutes_spring = calculate_minutes_to_expiration(start_spring, expiry_spring)
        self.assertEqual(minutes_spring, 4260)

        # 2. Fall Back 2026: November 1, 2026 (clocks fall back 02:00 -> 01:00 EDT to EST)
        # From Friday 2026-10-30 16:00 ET (EDT, UTC-4) to Monday 2026-11-02 16:00 ET (EST, UTC-5)
        # Wall clock says 72 hours, but actual elapsed time is 73 hours = 4,380 minutes.
        start_fall = datetime.datetime(2026, 10, 30, 16, 0, 0, tzinfo=ET_TZ)
        expiry_fall = datetime.date(2026, 11, 2)
        minutes_fall = calculate_minutes_to_expiration(start_fall, expiry_fall)
        self.assertEqual(minutes_fall, 4380)

        # 3. Standard Non-DST Day: exactly 24 hours = 1440 minutes
        start_normal = datetime.datetime(2026, 5, 14, 16, 0, 0, tzinfo=ET_TZ)
        expiry_normal = datetime.date(2026, 5, 15)
        minutes_normal = calculate_minutes_to_expiration(start_normal, expiry_normal)
        self.assertEqual(minutes_normal, 1440)

    def test_case_6_all_strikes_zero_bid_republishes_stale(self):
        """
        Case 6: Document 2 Section 5(b)(2).
        If all strikes are zero-bid, the index cannot be calculated;
        pipeline republishes the last valid value and flags it as stale.
        """
        pipeline = GoldVolReplicaEngine(archive_raw=False)

        # Normal CMT yields
        cmt_yields = {
            "DGS1MO": 5.20,
            "DGS3MO": 5.25,
            "DGS6MO": 5.30,
            "DGS1": 5.10,
            "DGS2": 4.80,
            "DGS5": 4.50,
            "DGS10": 4.25,
            "DGS30": 4.40,
        }
        yc_date = datetime.date(2026, 5, 1)
        calc_time = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=ET_TZ)

        exp1 = datetime.date(2026, 5, 22)  # 18 days
        exp2 = datetime.date(2026, 6, 19)  # 46 days

        def make_valid_quotes():
            quotes = []
            for k in [180.0, 185.0, 190.0, 195.0, 200.0, 205.0, 210.0, 215.0, 220.0]:
                c_mid = max(0.1, 200.0 - k + 3.0)
                p_mid = max(0.1, k - 200.0 + 3.0)
                quotes.append(
                    OptionQuoteInput(
                        strike=k,
                        call_bid=round(c_mid - 0.05, 2),
                        call_ask=round(c_mid + 0.05, 2),
                        put_bid=round(p_mid - 0.05, 2),
                        put_ask=round(p_mid + 0.05, 2),
                    )
                )
            return quotes

        # Tick 1: Valid market data
        chain_valid = {exp1: make_valid_quotes(), exp2: make_valid_quotes()}
        rec1 = pipeline.calculate_replica(
            calc_time_utc=calc_time.astimezone(UTC_TZ),
            chain_by_expiry=chain_valid,
            cmt_yields_prior_close=cmt_yields,
            yield_curve_date=yc_date,
        )
        self.assertFalse(rec1.stale)
        self.assertTrue(math.isfinite(rec1.index_value))
        initial_val = rec1.index_value

        # Tick 2: All strikes have zero bid (market outage / halt)
        def make_zero_bid_quotes():
            return [
                OptionQuoteInput(strike=k, call_bid=0.0, call_ask=1.2, put_bid=0.0, put_ask=1.2)
                for k in [180.0, 185.0, 190.0, 195.0, 200.0, 205.0, 210.0, 215.0, 220.0]
            ]

        chain_zero_bids = {exp1: make_zero_bid_quotes(), exp2: make_zero_bid_quotes()}
        calc_time_2 = calc_time + datetime.timedelta(seconds=15)
        rec2 = pipeline.calculate_replica(
            calc_time_utc=calc_time_2.astimezone(UTC_TZ),
            chain_by_expiry=chain_zero_bids,
            cmt_yields_prior_close=cmt_yields,
            yield_curve_date=yc_date,
        )

        # Must republish previous valid value and be flagged as stale
        self.assertTrue(rec2.stale)
        self.assertEqual(rec2.index_value, initial_val)
        self.assertEqual(
            rec2.filter_status["status_reason"],
            "uncalculable_republished_stale_last_valid",
        )

    def test_case_7_rate_outside_curve_range_raises_error(self):
        """
        Case 7: Document 2 Section 2.1.
        Requested maturity outside maximum available CMT maturity (t > 10950 days)
        raises an explicit ValueError.
        """
        cmt_yields = {
            "DGS1MO": 5.0,
            "DGS3MO": 5.1,
            "DGS6MO": 5.2,
            "DGS1": 5.0,
            "DGS10": 4.2,
            "DGS30": 4.5,  # 30 Yr = 10,950 days
        }
        curve = BoundedCubicSplineYieldCurve(cmt_yields)

        # Within bounds: 10,950 days should evaluate
        bey_max, _, _ = curve.interpolate_bey(10950.0)
        self.assertTrue(math.isfinite(bey_max))

        # Outside bounds: 10,951 days (> 10,950 days) must raise ValueError
        with self.assertRaises(ValueError) as ctx:
            curve.interpolate_bey(10951.0)
        self.assertIn("beyond the maximum available CMT curve maturity", str(ctx.exception))

        # Continuously compounded rate must also raise ValueError
        with self.assertRaises(ValueError):
            curve.get_continuously_compounded_rate(10951.0)

    def test_case_8_move_of_half_point_triggers_filter(self):
        """
        Case 8: Document 1 Section 4 Table & Document 2 Section 5(a).
        Index-level filter threshold = 0.50 points, period = 30 seconds.
        A drop >= 0.50 points within 30 seconds triggers the filter and republishes baseline.
        """
        idx_filter = IndexLevelFilter(threshold_points=0.50, threshold_period_seconds=30.0)
        t0 = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=ET_TZ)

        # Tick 1 (t0): Initial value 20.00 sets session baseline
        res1 = idx_filter.process_calculation(20.00, t0)
        self.assertEqual(res1.published_value, 20.00)
        self.assertFalse(res1.filter_triggered)
        self.assertEqual(res1.baseline_value, 20.00)

        # Tick 2 (t0 + 15s): Drop by 0.60 points (to 19.40) within 30s
        # Must trigger filter: suppress 19.40, republish baseline 20.00
        t1 = t0 + datetime.timedelta(seconds=15)
        res2 = idx_filter.process_calculation(19.40, t1)
        self.assertTrue(res2.filter_triggered)
        self.assertEqual(res2.published_value, 20.00)
        self.assertEqual(res2.baseline_value, 20.00)
        self.assertEqual(len(idx_filter.trigger_log), 1)

        # Tick 3 (t0 + 35s): Drop remains 19.40, but threshold period (30s) has elapsed
        # Rule 4: First subsequent value becomes new baseline
        t2 = t0 + datetime.timedelta(seconds=35)
        res3 = idx_filter.process_calculation(19.40, t2)
        self.assertFalse(res3.filter_triggered)
        self.assertEqual(res3.published_value, 19.40)
        self.assertEqual(res3.baseline_value, 19.40)


if __name__ == "__main__":
    unittest.main()
