"""
Interest Rates Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Step 2 (Calculate the Interest Rates).
- Document 2: Section 2.1 (Bounded Cubic Spline APY Rate).
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple
import numpy as np

# Standard Fixed Maturity Days defined in Document 2, Section 2.1
STANDARD_CMT_MATURITY_DAYS: Dict[str, float] = {
    "1 Mo": 30.0,
    "2 Mo": 60.0,
    "3 Mo": 91.0,
    "6 Mo": 182.0,
    "1 Yr": 365.0,
    "2 Yr": 730.0,
    "3 Yr": 1095.0,
    "5 Yr": 1825.0,
    "7 Yr": 2555.0,
    "10 Yr": 3650.0,
    "20 Yr": 7300.0,
    "30 Yr": 10950.0,
}

FRED_CMT_SERIES_MAP: Dict[str, str] = {
    "DGS1MO": "1 Mo",
    "DGS2MO": "2 Mo",
    "DGS3MO": "3 Mo",
    "DGS6MO": "6 Mo",
    "DGS1": "1 Yr",
    "DGS2": "2 Yr",
    "DGS3": "3 Yr",
    "DGS5": "5 Yr",
    "DGS7": "7 Yr",
    "DGS10": "10 Yr",
    "DGS20": "20 Yr",
    "DGS30": "30 Yr",
}


def fit_natural_cubic_spline(
    x_points: np.ndarray, y_points: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Fits a natural cubic spline with zero second derivatives at boundaries
    (S''(x_0) = 0, S''(x_n) = 0).
    Returns coefficients (a, b, c, d) for piecewise polynomials:
    S_i(t) = a_i + b_i*(t - x_i) + c_i*(t - x_i)^2 + d_i*(t - x_i)^3.
    """
    n = len(x_points)
    if n < 2:
        raise ValueError("At least 2 points are required to fit a cubic spline.")

    h = np.diff(x_points)
    if np.any(h <= 0):
        raise ValueError("x points must be strictly increasing.")

    alpha = np.zeros(n)
    for i in range(1, n - 1):
        alpha[i] = (3.0 / h[i]) * (y_points[i + 1] - y_points[i]) - (
            3.0 / h[i - 1]
        ) * (y_points[i] - y_points[i - 1])

    l = np.zeros(n)
    mu = np.zeros(n)
    z = np.zeros(n)
    l[0] = 1.0
    mu[0] = 0.0
    z[0] = 0.0

    for i in range(1, n - 1):
        l[i] = 2.0 * (x_points[i + 1] - x_points[i - 1]) - h[i - 1] * mu[i - 1]
        mu[i] = h[i] / l[i]
        z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i]

    l[n - 1] = 1.0
    z[n - 1] = 0.0
    c = np.zeros(n)
    b = np.zeros(n)
    d = np.zeros(n)
    a = y_points.copy()

    for j in range(n - 2, -1, -1):
        c[j] = z[j] - mu[j] * c[j + 1]
        b[j] = (y_points[j + 1] - y_points[j]) / h[j] - h[j] * (c[j + 1] + 2.0 * c[j]) / 3.0
        d[j] = (c[j + 1] - c[j]) / (3.0 * h[j])

    return a, b, c, d


def evaluate_natural_cubic_spline(
    t: float,
    x_points: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
) -> float:
    """
    Evaluates the natural cubic spline at point t.
    """
    n = len(x_points)
    if t < x_points[0]:
        dt = t - x_points[0]
        return float(a[0] + b[0] * dt + c[0] * dt**2 + d[0] * dt**3)
    elif t > x_points[-1]:
        dt = t - x_points[-1]
        return float(a[-1] + b[-1] * dt + c[-1] * dt**2 + d[-1] * dt**3)
    else:
        idx = int(np.searchsorted(x_points, t) - 1)
        idx = max(0, min(idx, n - 2))
        dt = t - x_points[idx]
        return float(a[idx] + b[idx] * dt + c[idx] * dt**2 + d[idx] * dt**3)


class BoundedCubicSplineYieldCurve:
    """
    Implements Document 2, Section 2.1:
    - Natural cubic spline interpolation of Constant Maturity Treasury (CMT) yields.
    - Interpolation bounding: min/max of neighboring CMT points.
    - Extrapolation bounding for t < t1 (shortest maturity) via linear boundary equations.
    - Explicit error for t outside the maximum curve range.
    - Conversion of BEY to continuous APY rate.
    """

    def __init__(self, raw_cmt_yields: Dict[str, Optional[float]]):
        """
        raw_cmt_yields maps maturity labels (e.g. '1 Mo', '2 Mo', '1 Yr' or FRED keys 'DGS1MO')
        to percentage yields (e.g. 0.03 for 0.03% or 4.50 for 4.50%).
        """
        valid_points: List[Tuple[float, float]] = []

        for key, val in raw_cmt_yields.items():
            if val is None or not math.isfinite(val):
                continue
            # Normalize label
            label = FRED_CMT_SERIES_MAP.get(key, key)
            if label in STANDARD_CMT_MATURITY_DAYS:
                days = STANDARD_CMT_MATURITY_DAYS[label]
                valid_points.append((days, float(val)))

        if len(valid_points) < 2:
            raise ValueError(
                f"Insufficient non-null CMT yields to construct curve (got {len(valid_points)})."
            )

        valid_points.sort(key=lambda p: p[0])
        self.days = np.array([p[0] for p in valid_points], dtype=float)
        self.yields = np.array([p[1] for p in valid_points], dtype=float)

        self.a, self.b, self.c, self.d = fit_natural_cubic_spline(self.days, self.yields)

    def interpolate_bey(self, t_days: float) -> Tuple[float, float, float]:
        """
        Calculates the Bond Equivalent Yield (BEY) at t_days, applying Document 2 Section 2.1 bounds.
        Returns: (bounded_bey_pct, lower_bound_pct, upper_bound_pct).
        """
        if t_days <= 0:
            raise ValueError(f"Time to maturity in days must be positive, got {t_days}.")

        t1 = self.days[0]
        cmt1 = self.yields[0]
        tn = self.days[-1]

        # Explicit error if requested beyond maximum curve range
        if t_days > tn:
            raise ValueError(
                f"Requested maturity t={t_days:.1f} days is beyond the maximum available "
                f"CMT curve maturity tn={tn:.1f} days ({tn/365:.1f} years)."
            )

        raw_val = evaluate_natural_cubic_spline(
            t_days, self.days, self.a, self.b, self.c, self.d
        )

        if t_days < t1:
            # Extrapolated period t < t1 (Document 2, Section 2.1)
            # Find (tx, CMTx): next shortest maturity data point such that CMTx >= CMT1
            tx_idx = None
            for idx in range(1, len(self.days)):
                if self.yields[idx] >= cmt1:
                    tx_idx = idx
                    break

            if tx_idx is not None:
                tx = self.days[tx_idx]
                cmtx = self.yields[tx_idx]
                m0_lower = (cmtx - cmt1) / (tx - t1)
                b_lower = cmt1 - m0_lower * t1
            else:
                m0_lower = 0.0
                b_lower = cmt1

            lower_bound = m0_lower * t_days + b_lower

            # Find (tz, CMTz): next shortest maturity data point such that CMTz <= CMT1
            tz_idx = None
            for idx in range(1, len(self.days)):
                if self.yields[idx] <= cmt1:
                    tz_idx = idx
                    break

            if tz_idx is not None:
                tz = self.days[tz_idx]
                cmtz = self.yields[tz_idx]
                m0_upper = (cmtz - cmt1) / (tz - t1)
                b_upper = cmt1 - m0_upper * t1
            else:
                m0_upper = 0.0
                b_upper = cmt1

            upper_bound = m0_upper * t_days + b_upper

            # Ensure lower <= upper
            if lower_bound > upper_bound:
                lower_bound, upper_bound = upper_bound, lower_bound

        else:
            # Interpolated period ti <= t <= ti+1
            idx = int(np.searchsorted(self.days, t_days) - 1)
            idx = max(0, min(idx, len(self.days) - 2))
            cmti = self.yields[idx]
            cmti_next = self.yields[idx + 1]
            lower_bound = min(cmti, cmti_next)
            upper_bound = max(cmti, cmti_next)

        bounded_val = max(lower_bound, min(upper_bound, raw_val))
        return bounded_val, lower_bound, upper_bound

    def get_continuously_compounded_rate(self, t_days: float) -> float:
        """
        Converts bounded BEY to continuously compounded APY rate R_t.
        Methodology: Document 2, Section 2.1:
        APY_t = (1 + BEY_t / 2)^2 - 1
        R_t = ln(1 + APY_t)
        Returns R_t as a decimal (e.g. 0.00031664 for 0.031664%).
        """
        bounded_bey_pct, _, _ = self.interpolate_bey(t_days)
        bey_decimal = bounded_bey_pct / 100.0

        # Converting BEY to continuously compounded APY
        apy = (1.0 + bey_decimal / 2.0) ** 2 - 1.0
        r_cont = math.log(1.0 + apy)
        return r_cont
