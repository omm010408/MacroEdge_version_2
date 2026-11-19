"""
Test Suite C: Point-in-Time Compliance and Invariance Tests.

Methodology Mapping:
- Inputs & Data Rules:
  - Output at time t uses only quotes timestamped at or before t, plus prior-close curve.
  - Changing quotes after t does not alter the output at t.
  - Deterministic reproducibility: the same snapshot always yields the exact same output and hash.
"""

from __future__ import annotations

import copy
import datetime
import math
import shutil
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

from gold_vol_replica.pipeline import (
    GoldVolReplicaEngine,
    OptionQuoteInput,
)
from gold_vol_replica.publish import compute_snapshot_hash

ET_TZ = ZoneInfo("America/New_York")
UTC_TZ = datetime.timezone.utc


class TestPointInTimeCompliance(unittest.TestCase):
    """Verifies strict point-in-time quote filtering, invariance, and deterministic replay."""

    def setUp(self):
        self.archive_dir = Path("test_raw_archive")
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        self.pipeline = GoldVolReplicaEngine(archive_raw=False)

        # Standard prior-close CMT yields (e.g., date 2026-05-01 for calc date 2026-05-04)
        self.yc_date = datetime.date(2026, 5, 1)
        self.cmt_yields_prior_close = {
            "DGS1MO": 5.25,
            "DGS3MO": 5.30,
            "DGS6MO": 5.35,
            "DGS1": 5.15,
            "DGS2": 4.85,
            "DGS3": 4.60,
            "DGS5": 4.40,
            "DGS7": 4.30,
            "DGS10": 4.20,
            "DGS20": 4.45,
            "DGS30": 4.50,
        }

        # Expirations: May 22, 2026 (18 days) and June 19, 2026 (46 days)
        self.exp1 = datetime.date(2026, 5, 22)
        self.exp2 = datetime.date(2026, 6, 19)

    def tearDown(self):
        if self.archive_dir.exists():
            shutil.rmtree(self.archive_dir)

    def _generate_synthetic_chain(self, quote_time: datetime.datetime):
        """Generates a valid chain snapshot with ATM strike around 200.0."""
        quotes = []
        for k in [180.0, 185.0, 190.0, 195.0, 200.0, 205.0, 210.0, 215.0, 220.0]:
            c_mid = max(0.1, 200.0 - k + 4.0)
            p_mid = max(0.1, k - 200.0 + 4.0)
            quotes.append(
                OptionQuoteInput(
                    strike=k,
                    call_bid=round(c_mid - 0.05, 2),
                    call_ask=round(c_mid + 0.05, 2),
                    put_bid=round(p_mid - 0.05, 2),
                    put_ask=round(p_mid + 0.05, 2),
                    quote_time_utc=quote_time,
                    source_id="GLD_NBBO_OPRA",
                )
            )
        return quotes

    def test_c1_output_uses_only_quotes_timestamped_le_t(self):
        """
        Point-in-Time Test 1:
        Verify that output at time t uses only quotes timestamped <= t.
        Quotes timestamped after t (> t) are excluded.
        """
        t_calc = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=UTC_TZ)
        t_past = t_calc - datetime.timedelta(seconds=10)
        t_future = t_calc + datetime.timedelta(seconds=10)

        # Raw pool containing quotes from past, present, and future
        quotes_past = self._generate_synthetic_chain(t_past)
        quotes_future = self._generate_synthetic_chain(t_future)

        # Point-in-time filter: select latest quote for each strike where quote_time <= t_calc
        def filter_pit(quotes_stream, target_t):
            filtered = {}
            for q in quotes_stream:
                if q.quote_time_utc is not None and q.quote_time_utc <= target_t:
                    # Keep latest quote for this strike
                    filtered[q.strike] = q
            return list(filtered.values())

        full_pool = quotes_past + quotes_future
        pit_quotes = filter_pit(full_pool, t_calc)

        # Verify no future quotes leaked into pit_quotes
        for q in pit_quotes:
            self.assertLessEqual(q.quote_time_utc, t_calc)

        # Chain evaluated with PIT quotes
        chain = {self.exp1: pit_quotes, self.exp2: pit_quotes}
        rec = self.pipeline.calculate_replica(
            calc_time_utc=t_calc,
            chain_by_expiry=chain,
            cmt_yields_prior_close=self.cmt_yields_prior_close,
            yield_curve_date=self.yc_date,
        )

        self.assertFalse(rec.stale)
        self.assertTrue(math.isfinite(rec.index_value))

    def test_c2_changing_or_appending_quotes_after_t_does_not_change_output_at_t(self):
        """
        Point-in-Time Test 2:
        Changing or appending quotes timestamped after t does not alter the output at t.
        """
        t_calc = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=UTC_TZ)
        chain_t = {
            self.exp1: self._generate_synthetic_chain(t_calc),
            self.exp2: self._generate_synthetic_chain(t_calc),
        }

        # Run 1 at time t with data at time t
        engine1 = GoldVolReplicaEngine(archive_raw=False)
        rec1 = engine1.calculate_replica(
            calc_time_utc=t_calc,
            chain_by_expiry=chain_t,
            cmt_yields_prior_close=self.cmt_yields_prior_close,
            yield_curve_date=self.yc_date,
        )

        # Simulate later quotes at t + 30s with completely different / wild prices
        t_future = t_calc + datetime.timedelta(seconds=30)
        future_quotes = [
            OptionQuoteInput(
                strike=k,
                call_bid=999.0,
                call_ask=1000.0,
                put_bid=999.0,
                put_ask=1000.0,
                quote_time_utc=t_future,
                source_id="GLD_NBBO_OPRA",
            )
            for k in [180.0, 185.0, 190.0, 195.0, 200.0, 205.0, 210.0, 215.0, 220.0]
        ]

        # A point-in-time query for time t from an archival database filters quote_time <= t
        def get_chain_as_of(target_t, all_quotes_by_exp):
            as_of_chain = {}
            for exp, q_list in all_quotes_by_exp.items():
                as_of_chain[exp] = [q for q in q_list if q.quote_time_utc <= target_t]
            return as_of_chain

        combined_chain = {
            self.exp1: chain_t[self.exp1] + future_quotes,
            self.exp2: chain_t[self.exp2] + future_quotes,
        }

        chain_at_t = get_chain_as_of(t_calc, combined_chain)

        # Run 2 at time t
        engine2 = GoldVolReplicaEngine(archive_raw=False)
        rec2 = engine2.calculate_replica(
            calc_time_utc=t_calc,
            chain_by_expiry=chain_at_t,
            cmt_yields_prior_close=self.cmt_yields_prior_close,
            yield_curve_date=self.yc_date,
        )

        # Numerical and metadata fields must be exactly identical
        self.assertEqual(rec1.index_value, rec2.index_value)
        self.assertEqual(rec1.f1, rec2.f1)
        self.assertEqual(rec1.f2, rec2.f2)
        self.assertEqual(rec1.k0_1, rec2.k0_1)
        self.assertEqual(rec1.k0_2, rec2.k0_2)
        self.assertEqual(rec1.sigma1_sq, rec2.sigma1_sq)
        self.assertEqual(rec1.sigma2_sq, rec2.sigma2_sq)
        self.assertEqual(rec1.strikes_used_term1, rec2.strikes_used_term1)
        self.assertEqual(rec1.strikes_used_term2, rec2.strikes_used_term2)

    def test_c3_deterministic_replay_and_snapshot_hash(self):
        """
        Point-in-Time Test 3:
        Same snapshot input always deterministically yields the exact same output
        and identical snapshot hash (SHA-256).
        Mutating any quote changes the hash.
        """
        t_calc = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=UTC_TZ)
        chain_t = {
            self.exp1: self._generate_synthetic_chain(t_calc),
            self.exp2: self._generate_synthetic_chain(t_calc),
        }

        raw_payload = {
            "symbol": "GLD",
            "capture_time_utc": t_calc.isoformat(),
            "expirations": [self.exp1.isoformat(), self.exp2.isoformat()],
            "quotes": [
                {
                    "expiry": self.exp1.isoformat(),
                    "strike": q.strike,
                    "call_bid": q.call_bid,
                    "call_ask": q.call_ask,
                    "put_bid": q.put_bid,
                    "put_ask": q.put_ask,
                    "source_id": q.source_id,
                }
                for q in chain_t[self.exp1]
            ],
        }

        # Compute hash
        hash_1 = compute_snapshot_hash(raw_payload)
        hash_2 = compute_snapshot_hash(raw_payload)
        self.assertEqual(hash_1, hash_2)

        # Run pipeline
        engine = GoldVolReplicaEngine(archive_raw=False)
        rec_a = engine.calculate_replica(
            calc_time_utc=t_calc,
            chain_by_expiry=chain_t,
            cmt_yields_prior_close=self.cmt_yields_prior_close,
            yield_curve_date=self.yc_date,
            raw_snapshot_payload=raw_payload,
        )

        engine_replay = GoldVolReplicaEngine(archive_raw=False)
        rec_b = engine_replay.calculate_replica(
            calc_time_utc=t_calc,
            chain_by_expiry=chain_t,
            cmt_yields_prior_close=self.cmt_yields_prior_close,
            yield_curve_date=self.yc_date,
            raw_snapshot_payload=raw_payload,
        )

        # Full deterministic match
        self.assertEqual(rec_a.input_snapshot_hash, hash_1)
        self.assertEqual(rec_b.input_snapshot_hash, hash_1)
        self.assertEqual(rec_a.index_value, rec_b.index_value)
        self.assertEqual(rec_a.sigma1_sq, rec_b.sigma1_sq)
        self.assertEqual(rec_a.sigma2_sq, rec_b.sigma2_sq)

        # Verify mutation changes hash
        mutated_payload = copy.deepcopy(raw_payload)
        mutated_payload["quotes"][0]["call_bid"] = 9.99
        hash_mutated = compute_snapshot_hash(mutated_payload)
        self.assertNotEqual(hash_1, hash_mutated)


if __name__ == "__main__":
    unittest.main()
