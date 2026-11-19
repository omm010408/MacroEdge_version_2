"""
Single-Term Variance Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Step 3 (Calculate Near- and Next-Term Variances).
- Document 2: Section 3(a)(iv) (Calculating Volatility).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List
from gold_vol_replica.forward_strikes import SelectedStrike


@dataclass(frozen=True)
class StrikeContribution:
    """Detailed audit record for a single strike's contribution to variance."""
    strike: float
    option_type: str
    price_q: float
    delta_k: float
    contribution: float


@dataclass(frozen=True)
class SingleTermVarianceResult:
    """Complete calculation result for a single expiration term."""
    time_to_expiration_t: float
    risk_free_rate_r: float
    forward_price_f: float
    k0: float
    contributions: List[StrikeContribution]
    sum_contributions: float
    scaled_sum_term: float         # (2 / T) * sum_contributions
    forward_adjustment_term: float # (1 / T) * (F / K0 - 1)^2
    variance: float                # sigma^2
    num_strikes_used: int


def calculate_delta_k(strikes: List[float]) -> List[float]:
    """
    Calculates Delta K_i for each selected strike according to Document 2, Section 3(a)(iv):
    - Lowest OTM Strike K_0:  K_1 - K_0 (distance to single upper neighbor)
    - Highest OTM Strike K_N: K_N - K_{N-1} (distance to single lower neighbor)
    - Otherwise (interior):   (K_{i+1} - K_{i-1}) / 2 (half distance between neighbors)
    """
    n = len(strikes)
    if n < 2:
        raise ValueError("Cannot calculate Delta K with fewer than 2 strikes.")

    delta_k: List[float] = [0.0] * n
    # Lowest strike
    delta_k[0] = strikes[1] - strikes[0]
    # Highest strike
    delta_k[-1] = strikes[-1] - strikes[-2]
    # Interior strikes
    for i in range(1, n - 1):
        delta_k[i] = (strikes[i + 1] - strikes[i - 1]) / 2.0

    return delta_k


def calculate_single_term_variance(
    selected_strikes: List[SelectedStrike],
    forward_price: float,
    k0: float,
    risk_free_rate_r: float,
    time_to_expiration_t: float,
) -> SingleTermVarianceResult:
    """
    Calculates single-term variance sigma^2.
    Formula (Document 2, Section 3(a)(iv), Equation 1):
    sigma^2 = (2 / T) * Sum [ (Delta K_i / K_i^2) * e^(R * T) * Q(K_i) ] - (1 / T) * (F / K0 - 1)^2
    """
    if not selected_strikes:
        raise ValueError("Cannot calculate variance: no constituent strikes provided.")
    if time_to_expiration_t <= 0:
        raise ValueError(f"Time to expiration T must be positive, got {time_to_expiration_t}.")

    # Strikes must be sorted ascending
    ordered = sorted(selected_strikes, key=lambda s: s.strike)
    strikes = [s.strike for s in ordered]
    delta_ks = calculate_delta_k(strikes)

    compounded_factor = math.exp(risk_free_rate_r * time_to_expiration_t)
    contributions: List[StrikeContribution] = []
    sum_contributions = 0.0

    for s, dk in zip(ordered, delta_ks):
        strike = s.strike
        q = s.price_q
        # Contribution formula: (Delta K_i / K_i^2) * e^(R * T) * Q(K_i)
        contr = (dk / (strike ** 2)) * compounded_factor * q
        sum_contributions += contr
        contributions.append(
            StrikeContribution(
                strike=strike,
                option_type=s.option_type,
                price_q=q,
                delta_k=dk,
                contribution=contr,
            )
        )

    # Scaled sum term: (2 / T) * Sum
    scaled_sum = (2.0 / time_to_expiration_t) * sum_contributions

    # Forward adjustment term: (1 / T) * (F / K0 - 1)^2
    f_ratio = forward_price / k0 - 1.0
    forward_adjustment = (1.0 / time_to_expiration_t) * (f_ratio ** 2)

    # Total variance
    variance = scaled_sum - forward_adjustment

    return SingleTermVarianceResult(
        time_to_expiration_t=time_to_expiration_t,
        risk_free_rate_r=risk_free_rate_r,
        forward_price_f=forward_price,
        k0=k0,
        contributions=contributions,
        sum_contributions=sum_contributions,
        scaled_sum_term=scaled_sum,
        forward_adjustment_term=forward_adjustment,
        variance=variance,
        num_strikes_used=len(strikes),
    )
