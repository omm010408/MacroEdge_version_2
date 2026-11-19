"""
Forward Price and Strike Selection Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Step 3 (Calculate Near- and Next-Term Variances).
- Document 2: Section 3(a)(ii) (Forward Price and K0), Section 3(a)(iii) (Strike Selection),
              Section 5(b) (Volatility Index Spot Value Cannot be Calculated).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class OptionQuote:
    """Represents a bid/ask quote for a single option contract."""
    bid: Optional[float]
    ask: Optional[float]

    @property
    def is_valid(self) -> bool:
        """A quote is valid if bid >= 0, ask > bid, and both are finite numbers."""
        if self.bid is None or self.ask is None:
            return False
        if not (math.isfinite(self.bid) and math.isfinite(self.ask)):
            return False
        return self.bid >= 0 and self.ask > self.bid

    @property
    def midpoint(self) -> Optional[float]:
        if not self.is_valid:
            return None
        return (self.bid + self.ask) / 2.0


@dataclass(frozen=True)
class StrikeQuotePair:
    """Represents Call and Put quotes at a specific strike price."""
    strike: float
    call: OptionQuote
    put: OptionQuote


@dataclass(frozen=True)
class SelectedStrike:
    """Represents a strike selected for the volatility summation."""
    strike: float
    option_type: str  # "Put", "Call", or "Put/Call Average"
    price_q: float    # Q(K_i)


@dataclass(frozen=True)
class ForwardStrikeSelectionResult:
    """Complete result of forward price and constituent strike selection for a term."""
    atm_strike: float
    forward_price: float
    k0: float
    selected_strikes: List[SelectedStrike]
    all_available_strikes: List[float]
    excluded_put_strikes: List[float]
    excluded_call_strikes: List[float]


def calculate_forward_price_and_k0(
    strike_pairs: List[StrikeQuotePair],
    risk_free_rate_r: float,
    time_to_expiration_t: float,
) -> Tuple[float, float, float]:
    """
    Calculates option-implied forward price F and strike K0.
    Methodology: Document 2, Section 3(a)(ii).

    Steps:
    1. Identify strike price where |Call_mid - Put_mid| is smallest.
       Only considers candidate pairs with valid quotes where bid <= ask and neither is null.
       If multiple pairs share the minimum absolute difference, select the lowest strike.
    2. Forward price:
       F = Strike_ATM + e^(R * T) * (Call_mid_ATM - Put_mid_ATM)
    3. K0:
       First strike price equal to or immediately below F.
       Validation (Document 2, Section 5(b)(1)):
       If quotes of K0 put or K0 call are null or bid > ask, index cannot be calculated.
    """
    if not strike_pairs:
        raise ValueError("Cannot calculate forward price: strike pairs list is empty.")

    sorted_pairs = sorted(strike_pairs, key=lambda p: p.strike)
    eligible_atm_candidates = []

    for pair in sorted_pairs:
        if pair.call.is_valid and pair.put.is_valid:
            diff = abs(pair.call.midpoint - pair.put.midpoint)
            eligible_atm_candidates.append((diff, pair.strike, pair.call.midpoint, pair.put.midpoint))

    if not eligible_atm_candidates:
        raise ValueError("No eligible ATM candidate pairs with valid call and put quotes found.")

    # Sort by minimum difference, tie-break by lowest strike
    eligible_atm_candidates.sort(key=lambda x: (x[0], x[1]))
    min_diff, atm_strike, call_mid_atm, put_mid_atm = eligible_atm_candidates[0]

    # Forward price formula: F = Strike + e^(R*T) * (Call - Put)
    compounded_factor = math.exp(risk_free_rate_r * time_to_expiration_t)
    forward_price = atm_strike + compounded_factor * (call_mid_atm - put_mid_atm)

    # K0: first strike equal to or immediately below F
    strikes_below_or_equal = [p.strike for p in sorted_pairs if p.strike <= forward_price]
    if not strikes_below_or_equal:
        raise ValueError(
            f"Forward price {forward_price:.5f} is lower than the lowest strike {sorted_pairs[0].strike}."
        )

    k0 = max(strikes_below_or_equal)

    # Document 2, Section 5(b)(1): Verify K0 quotes are valid
    k0_pair = next((p for p in sorted_pairs if math.isclose(p.strike, k0, abs_tol=1e-6)), None)
    if k0_pair is None or not k0_pair.call.is_valid or not k0_pair.put.is_valid:
        raise ValueError(
            f"K0={k0} put or call quotes are null or invalid (bid > ask). "
            f"Per Document 2 Section 5(b)(1), volatility index cannot be calculated."
        )

    return atm_strike, forward_price, k0


def select_constituent_strikes(
    strike_pairs: List[StrikeQuotePair],
    forward_price: float,
    k0: float,
) -> ForwardStrikeSelectionResult:
    """
    Selects constituent option strikes for single-term volatility calculation.
    Methodology: Document 2, Section 3(a)(iii); Document 1, Step 3.

    Selection Rules:
    1. OTM Put options (strikes < K0):
       Start with the put strike immediately lower than K0 and move to successively lower strikes.
       Exclude any put option that has a bid price equal to zero (bid == 0).
       Once two put options with consecutive strike prices have zero bids, exclude those two
       and consider NO put options with lower strikes for inclusion.
       Validation (Document 2, Section 5(b)(2)):
       If all OTM put options have been excluded, the index cannot be calculated.

    2. OTM Call options (strikes > K0):
       Start with the call strike immediately higher than K0 and move to successively higher strikes.
       Exclude any call option that has a bid price equal to zero (bid == 0).
       Once two call options with consecutive strike prices have zero bids, exclude those two
       and consider NO call options with higher strikes for inclusion.
       Validation (Document 2, Section 5(b)(2)):
       If all OTM call options have been excluded, the index cannot be calculated.

    3. At K0:
       Both put and call options are selected.
       Q(K0) is the average of the K0 put option price and K0 call option price.
    """
    sorted_pairs = sorted(strike_pairs, key=lambda p: p.strike)
    pair_map = {p.strike: p for p in sorted_pairs}

    # Find pair for K0
    k0_pair = next((p for p in sorted_pairs if math.isclose(p.strike, k0, abs_tol=1e-6)), None)
    if k0_pair is None:
        raise ValueError(f"Strike K0={k0} not found in available option chain.")

    # 1. Select OTM Puts (strikes < K0) descending
    put_strikes = [p.strike for p in sorted_pairs if p.strike < k0 - 1e-6]
    put_strikes.sort(reverse=True)  # Start immediately below K0 moving downwards

    selected_puts: List[SelectedStrike] = []
    excluded_puts: List[float] = []
    consecutive_zero_bids = 0

    for strike in put_strikes:
        pair = pair_map[strike]
        put_quote = pair.put

        if not put_quote.is_valid or put_quote.bid == 0:
            consecutive_zero_bids += 1
            excluded_puts.append(strike)
            if consecutive_zero_bids >= 2:
                # Two consecutive zero-bid strikes: exclude remaining lower strikes
                break
        else:
            consecutive_zero_bids = 0
            selected_puts.append(
                SelectedStrike(strike=strike, option_type="Put", price_q=put_quote.midpoint)
            )

    # Document 2, Section 5(b)(2): Verify at least one OTM put is selected
    if not selected_puts:
        raise ValueError(
            "All out-of-the-money put options have been excluded (zero bids / invalid). "
            "Per Document 2 Section 5(b)(2), volatility index cannot be calculated."
        )

    # Put strikes were scanned descending; order them ascending for integration
    selected_puts.sort(key=lambda s: s.strike)

    # 2. At K0: Average of put and call midpoints
    q_k0 = (k0_pair.call.midpoint + k0_pair.put.midpoint) / 2.0
    selected_k0 = SelectedStrike(strike=k0, option_type="Put/Call Average", price_q=q_k0)

    # 3. Select OTM Calls (strikes > K0) ascending
    call_strikes = [p.strike for p in sorted_pairs if p.strike > k0 + 1e-6]
    call_strikes.sort()  # Start immediately above K0 moving upwards

    selected_calls: List[SelectedStrike] = []
    excluded_calls: List[float] = []
    consecutive_zero_bids = 0

    for strike in call_strikes:
        pair = pair_map[strike]
        call_quote = pair.call

        if not call_quote.is_valid or call_quote.bid == 0:
            consecutive_zero_bids += 1
            excluded_calls.append(strike)
            if consecutive_zero_bids >= 2:
                # Two consecutive zero-bid strikes: exclude remaining higher strikes
                break
        else:
            consecutive_zero_bids = 0
            selected_calls.append(
                SelectedStrike(strike=strike, option_type="Call", price_q=call_quote.midpoint)
            )

    # Document 2, Section 5(b)(2): Verify at least one OTM call is selected
    if not selected_calls:
        raise ValueError(
            "All out-of-the-money call options have been excluded (zero bids / invalid). "
            "Per Document 2 Section 5(b)(2), volatility index cannot be calculated."
        )

    # Full set of selected constituent strikes ordered ascending
    all_selected = selected_puts + [selected_k0] + selected_calls

    return ForwardStrikeSelectionResult(
        atm_strike=k0_pair.strike,
        forward_price=forward_price,
        k0=k0,
        selected_strikes=all_selected,
        all_available_strikes=[p.strike for p in sorted_pairs],
        excluded_put_strikes=excluded_puts,
        excluded_call_strikes=excluded_calls,
    )
