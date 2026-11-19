"""
GLD 30-Day Implied Volatility Replica (VIX Methodology).

A Python package implementing the constant-maturity implied volatility index
from SPDR Gold Shares (GLD) options using Cboe VIX methodology.
"""

from gold_vol_replica.constant_maturity import calculate_constant_maturity_index
from gold_vol_replica.expiry_selection import (
    calculate_minutes_to_expiration,
    calculate_time_to_expiration,
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
from gold_vol_replica.pipeline import GoldVolReplicaEngine, OptionQuoteInput
from gold_vol_replica.publish import OutputRecord, format_output_record
from gold_vol_replica.rates import BoundedCubicSplineYieldCurve

__all__ = [
    "GoldVolReplicaEngine",
    "OptionQuoteInput",
    "OptionQuote",
    "StrikeQuotePair",
    "BoundedCubicSplineYieldCurve",
    "IndexLevelFilter",
    "OutputRecord",
    "calculate_forward_price_and_k0",
    "select_constituent_strikes",
    "calculate_constant_maturity_index",
    "calculate_minutes_to_expiration",
    "calculate_time_to_expiration",
    "get_third_friday_expiration",
    "select_near_and_next_terms",
    "format_output_record",
]
