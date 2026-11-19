"""
Constant Maturity Interpolation Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Step 4 (Calculate the Volatility Index).
- Document 2: Section 3(b) (Constant Maturity Term).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

MINUTES_PER_YEAR: float = 525600.0  # M_365
CONSTANT_MATURITY_30_DAYS_MINUTES: float = 43200.0  # M_CM (30 * 1440)


@dataclass(frozen=True)
class ConstantMaturityResult:
    """Result of 30-day constant maturity interpolation."""
    n_t1: int
    n_t2: int
    n_30: float
    t1: float
    t2: float
    sigma1_sq: float
    sigma2_sq: float
    w1: float
    w2: float
    v_weighted_variance: float
    sigma_30_sq: float
    index_value: float
    rounded_index_value: float


def calculate_constant_maturity_index(
    minutes_t1: int,
    minutes_t2: int,
    sigma1_sq: float,
    sigma2_sq: float,
    constant_maturity_minutes: float = CONSTANT_MATURITY_30_DAYS_MINUTES,
    decimals: int = 2,
) -> ConstantMaturityResult:
    """
    Interpolates 30-day constant-maturity volatility index.
    Formula (Document 2, Section 3(b)):
    Index = 100 * sqrt( { T1*sigma1^2 * [(MT2 - MCM)/(MT2 - MT1)] + T2*sigma2^2 * [(MCM - MT1)/(MT2 - MT1)] } * (M365 / MCM) )

    Bracketing Rule:
    The near-term (MT1) and next-term (MT2) must bracket MCM:
    MT1 <= MCM <= MT2.
    Document 2 provides no extrapolation rule if terms do not bracket MCM;
    therefore, an explicit ValueError is raised rather than extrapolating.
    """
    m_t1 = float(minutes_t1)
    m_t2 = float(minutes_t2)
    m_cm = float(constant_maturity_minutes)
    m_365 = MINUTES_PER_YEAR

    if m_t2 <= m_t1:
        raise ValueError(f"Next-term minutes ({m_t2}) must be strictly greater than near-term minutes ({m_t1}).")

    # Bracketing check
    if m_t1 > m_cm or m_t2 < m_cm:
        raise ValueError(
            f"Selected terms do not bracket {m_cm:.0f} minutes (30 days): "
            f"near-term N_T1={m_t1:.0f}, next-term N_T2={m_t2:.0f}. "
            f"Document 2 gives no extrapolation rule for non-bracketing terms; extrapolation is prohibited."
        )

    t1 = m_t1 / m_365
    t2 = m_t2 / m_365

    # Weight factors
    span = m_t2 - m_t1
    w1 = (m_t2 - m_cm) / span
    w2 = (m_cm - m_t1) / span

    # Weighted variance component V
    v_weighted = t1 * sigma1_sq * w1 + t2 * sigma2_sq * w2

    if v_weighted < 0:
        raise ValueError(f"Interpolated variance V is negative ({v_weighted}); cannot compute square root.")

    # Annualized 30-day variance
    sigma_30_sq = v_weighted * (m_365 / m_cm)
    index_raw = 100.0 * math.sqrt(sigma_30_sq)
    index_rounded = round(index_raw, decimals)

    return ConstantMaturityResult(
        n_t1=minutes_t1,
        n_t2=minutes_t2,
        n_30=m_cm,
        t1=t1,
        t2=t2,
        sigma1_sq=sigma1_sq,
        sigma2_sq=sigma2_sq,
        w1=w1,
        w2=w2,
        v_weighted_variance=v_weighted,
        sigma_30_sq=sigma_30_sq,
        index_value=index_raw,
        rounded_index_value=index_rounded,
    )
