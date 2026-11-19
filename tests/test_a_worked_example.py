"""
Test A: Worked Example Verification.

Methodology Mapping:
- Document 1: Appendix 3 (Sample Calculation for VXAPL Index),
              Appendix 4 (Complete Option Data),
              Appendix 5 (Individual Contributions).

Requirement:
Reproduce F1, F2, K0 for each term, sigma1^2, sigma2^2, and the final value of 47.22
to two decimal places.
"""

import math
import unittest
from gold_vol_replica.constant_maturity import calculate_constant_maturity_index
from gold_vol_replica.forward_strikes import (
    OptionQuote,
    StrikeQuotePair,
    calculate_forward_price_and_k0,
    select_constituent_strikes,
)
from gold_vol_replica.rates import BoundedCubicSplineYieldCurve
from gold_vol_replica.variance import calculate_single_term_variance


class TestWorkedExample(unittest.TestCase):
    """
    Tests the mathematical replication against the official Cboe worked example
    in Appendix 3 of Document 1.
    """

    def setUp(self):
        # Appendix 3 CMT Yields on 9/26/2022
        self.cmt_yields_9_26_2022 = {
            "1 Mo": 0.03,
            "2 Mo": 0.02,
            "3 Mo": 0.04,
            "6 Mo": 0.05,
            "1 Yr": 0.08,
            "2 Yr": 0.11,
            "3 Yr": 0.22,
            "5 Yr": 0.59,
            "7 Yr": 1.00,
            "10 Yr": 1.37,
            "20 Yr": 2.03,
            "30 Yr": 2.21,
        }

        # Near-term and Next-term raw options from Appendix 4
        # Format: (strike, call_bid, call_ask, put_bid, put_ask)
        self.near_term_raw = [
            (55.0, 103.95, 104.2, 0.0, 0.01),
            (60.0, 98.95, 99.2, 0.0, 0.01),
            (65.0, 93.95, 94.2, 0.01, 0.02),
            (70.0, 88.95, 89.2, 0.0, 0.02),
            (75.0, 83.95, 84.2, 0.0, 0.02),
            (80.0, 78.95, 79.2, 0.01, 0.03),
            (85.0, 73.95, 74.25, 0.02, 0.04),
            (90.0, 68.95, 69.25, 0.04, 0.05),
            (95.0, 63.95, 64.25, 0.06, 0.07),
            (100.0, 59.0, 59.3, 0.09, 0.1),
            (105.0, 54.1, 54.3, 0.14, 0.15),
            (110.0, 49.15, 49.35, 0.2, 0.21),
            (115.0, 44.15, 44.45, 0.29, 0.3),
            (120.0, 39.25, 39.55, 0.42, 0.43),
            (125.0, 34.5, 34.75, 0.62, 0.63),
            (130.0, 29.75, 30.0, 0.91, 0.93),
            (135.0, 25.15, 25.4, 1.34, 1.36),
            (140.0, 20.85, 21.0, 1.96, 1.98),
            (145.0, 16.7, 16.85, 2.83, 2.85),
            (150.0, 12.9, 13.0, 4.0, 4.05),
            (152.5, 11.15, 11.25, 4.75, 4.8),
            (155.0, 9.5, 9.6, 5.6, 5.65),
            (157.5, 7.95, 8.1, 6.55, 6.6),
            (160.0, 6.6, 6.65, 7.65, 7.7),
            (162.5, 5.3, 5.4, 8.85, 8.95),
            (165.0, 4.2, 4.25, 10.25, 10.35),
            (167.5, 3.25, 3.3, 11.75, 11.9),
            (170.0, 2.48, 2.5, 13.5, 13.65),
            (172.5, 1.84, 1.86, 15.35, 15.5),
            (175.0, 1.35, 1.36, 17.35, 17.5),
            (177.5, 0.97, 0.99, 19.45, 19.65),
            (180.0, 0.7, 0.71, 21.65, 21.95),
            (182.5, 0.5, 0.51, 24.0, 24.25),
            (185.0, 0.36, 0.37, 26.3, 26.6),
            (187.5, 0.26, 0.27, 28.75, 28.95),
            (190.0, 0.2, 0.21, 31.15, 31.4),
            (192.5, 0.14, 0.15, 33.6, 33.9),
            (195.0, 0.11, 0.12, 36.1, 36.4),
            (200.0, 0.07, 0.08, 41.05, 41.3),
            (205.0, 0.05, 0.06, 46.05, 46.3),
            (210.0, 0.04, 0.05, 51.0, 51.3),
            (215.0, 0.02, 0.03, 56.0, 56.3),
            (220.0, 0.02, 0.03, 61.0, 61.3),
            (225.0, 0.01, 0.02, 66.0, 66.3),
            (230.0, 0.0, 0.04, 71.0, 71.3),
            (235.0, 0.0, 0.04, 76.0, 76.3),
            (240.0, 0.01, 0.03, 81.0, 81.25),
            (245.0, 0.0, 0.03, 86.0, 86.25),
            (250.0, 0.0, 0.02, 91.0, 91.25),
            (255.0, 0.0, 0.03, 96.0, 96.25),
        ]

        self.next_term_raw = [
            (85.0, 74.0, 74.3, 0.1, 0.15),
            (90.0, 69.1, 69.4, 0.3, 0.35),
            (95.0, 64.5, 64.7, 0.6, 0.7),
            (100.0, 59.0, 59.35, 0.12, 0.16),
            (105.0, 54.05, 54.35, 0.18, 0.21),
            (110.0, 49.1, 49.45, 0.27, 0.3),
            (115.0, 44.2, 44.55, 0.39, 0.42),
            (120.0, 39.35, 39.7, 0.55, 0.59),
            (125.0, 34.6, 34.95, 0.79, 0.85),
            (130.0, 29.95, 30.25, 1.14, 1.2),
            (135.0, 25.45, 25.75, 1.63, 1.69),
            (140.0, 21.2, 21.4, 2.31, 2.38),
            (145.0, 17.15, 17.3, 3.2, 3.35),
            (150.0, 13.35, 13.55, 4.45, 4.6),
            (155.0, 10.0, 10.15, 6.1, 6.2),
            (160.0, 7.15, 7.25, 8.15, 8.3),
            (165.0, 4.7, 4.85, 10.7, 10.9),
            (170.0, 2.93, 3.0, 13.9, 14.1),
            (175.0, 1.69, 1.75, 17.65, 17.9),
            (180.0, 0.93, 0.97, 21.9, 22.1),
            (185.0, 0.51, 0.54, 26.45, 26.75),
            (190.0, 0.28, 0.32, 31.2, 31.55),
            (195.0, 0.17, 0.18, 36.1, 36.45),
            (200.0, 0.11, 0.12, 41.05, 41.4),
            (205.0, 0.07, 0.08, 46.0, 46.35),
            (210.0, 0.04, 0.07, 51.0, 51.35),
            (215.0, 0.02, 0.06, 56.0, 56.35),
            (220.0, 0.04, 0.05, 61.0, 61.3),
            (225.0, 0.01, 0.04, 65.95, 66.3),
            (230.0, 0.0, 0.04, 71.0, 71.25),
            (235.0, 0.0, 0.05, 75.95, 76.3),
            (240.0, 0.01, 0.04, 80.95, 81.3),
            (245.0, 0.0, 0.04, 85.95, 86.3),
            (250.0, 0.0, 0.02, 90.95, 91.3),
        ]

    def test_reproduce_appendix3_vxapl(self):
        # 1. Rates verification from Bounded Cubic Spline
        curve = BoundedCubicSplineYieldCurve(self.cmt_yields_9_26_2022)
        # Near-term: 25 days from curve date 9/26 to expiry 10/21
        # Next-term: 32 days from curve date 9/26 to expiry 10/28
        r1 = curve.get_continuously_compounded_rate(25.0)
        r2 = curve.get_continuously_compounded_rate(32.0)

        # Expected in Appendix 3: R1 = 0.031664% = 0.00031664, R2 = 0.028797% = 0.00028797
        self.assertAlmostEqual(r1 * 100.0, 0.031664, places=5)
        self.assertAlmostEqual(r2 * 100.0, 0.028797, places=5)

        # 2. Time to expiration
        n_t1 = 34874
        n_t2 = 44954
        t1 = n_t1 / 525600.0
        t2 = n_t2 / 525600.0
        self.assertAlmostEqual(t1, 0.0663508, places=6)
        self.assertAlmostEqual(t2, 0.0855289, places=6)

        # 3. Forward Price and K0 for Term 1 (Near-term)
        pairs1 = [
            StrikeQuotePair(strike=k, call=OptionQuote(cb, ca), put=OptionQuote(pb, pa))
            for k, cb, ca, pb, pa in self.near_term_raw
        ]
        atm1, f1, k0_1 = calculate_forward_price_and_k0(pairs1, r1, t1)
        self.assertEqual(atm1, 160.0)
        self.assertAlmostEqual(f1, 158.94998, places=4)
        self.assertEqual(k0_1, 157.5)

        # 4. Strike selection & Single-term variance for Term 1
        sel1 = select_constituent_strikes(pairs1, f1, k0_1)
        # Verify 39 strikes selected as in Appendix 5
        self.assertEqual(len(sel1.selected_strikes), 39)
        var1 = calculate_single_term_variance(sel1.selected_strikes, f1, k0_1, r1, t1)
        self.assertAlmostEqual(var1.sum_contributions, 0.007676468, places=7)
        self.assertAlmostEqual(var1.scaled_sum_term, 0.231390, places=5)
        self.assertAlmostEqual(var1.forward_adjustment_term, 0.00127737, places=7)
        self.assertAlmostEqual(var1.variance, 0.23011289, places=6)

        # 5. Forward Price and K0 for Term 2 (Next-term)
        pairs2 = [
            StrikeQuotePair(strike=k, call=OptionQuote(cb, ca), put=OptionQuote(pb, pa))
            for k, cb, ca, pb, pa in self.next_term_raw
        ]
        atm2, f2, k0_2 = calculate_forward_price_and_k0(pairs2, r2, t2)
        self.assertEqual(atm2, 160.0)
        self.assertAlmostEqual(f2, 158.97497, places=4)
        self.assertEqual(k0_2, 155.0)

        # 6. Strike selection & Single-term variance for Term 2
        sel2 = select_constituent_strikes(pairs2, f2, k0_2)
        # Verify 29 strikes selected as in Appendix 5
        self.assertEqual(len(sel2.selected_strikes), 29)
        var2 = calculate_single_term_variance(sel2.selected_strikes, f2, k0_2, r2, t2)
        self.assertAlmostEqual(var2.sum_contributions, 0.009815475, places=7)
        self.assertAlmostEqual(var2.scaled_sum_term, 0.229524, places=5)
        self.assertAlmostEqual(var2.forward_adjustment_term, 0.00768940, places=7)
        self.assertAlmostEqual(var2.variance, 0.22183472, places=6)

        # 7. Constant Maturity Interpolation (30-day)
        cm = calculate_constant_maturity_index(n_t1, n_t2, var1.variance, var2.variance)
        self.assertAlmostEqual(cm.v_weighted_variance, 0.01832857, places=6)
        self.assertAlmostEqual(cm.sigma_30_sq, 0.22299756, places=6)
        # Expected final value: 47.22
        self.assertEqual(cm.rounded_index_value, 47.22)
        self.assertAlmostEqual(cm.index_value, 47.2226, places=2)


if __name__ == "__main__":
    unittest.main()
