from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class DataSourceContract:
    """Strict point-in-time metadata contract for all financial & macroeconomic data sources."""

    source_identifier: str
    dataset_name: str
    original_timezone: str
    storage_timezone: str = "UTC"
    frequency: str = "daily"
    publication_lag_rule: str = "none"
    vintage_type: str = "revised_latest"  # "initial_alfred" or "revised_latest"
    as_of_consensus_available: bool = False
    strict_cutoff_enforced: bool = True
    metadata_fields: list[str] = field(
        default_factory=lambda: [
            "observation_date",
            "publication_timestamp_utc",
            "ingestion_timestamp_utc",
            "vintage",
            "prediction_cutoff",
            "source_identifier",
            "original_timezone",
        ]
    )


DATA_CONTRACTS: dict[str, DataSourceContract] = {
    "FRED_MACRO_DAILY": DataSourceContract(
        source_identifier="FRED_MACRO_DAILY",
        dataset_name="fred_macro_daily.csv",
        original_timezone="America/New_York",
        frequency="business_daily",
        publication_lag_rule="1bd_lag_for_daily_financials_release_date_for_monthly_indicators",
        vintage_type="revised_latest",
        as_of_consensus_available=False,
    ),
    "FRED_MACRO_MONTHLY": DataSourceContract(
        source_identifier="FRED_MACRO_MONTHLY",
        dataset_name="fred_macro_monthly.csv",
        original_timezone="America/New_York",
        frequency="monthly_start",
        publication_lag_rule="official_release_date_next_month",
        vintage_type="revised_latest",
        as_of_consensus_available=False,
    ),
    "FRED_RELEASE_DATES": DataSourceContract(
        source_identifier="FRED_RELEASE_DATES",
        dataset_name="fred_release_dates.csv",
        original_timezone="America/New_York",
        frequency="event_cadence",
        publication_lag_rule="exact_release_time_0830_et",
        vintage_type="historical_calendar",
        as_of_consensus_available=False,
    ),
    "YAHOO_MARKET_DAILY": DataSourceContract(
        source_identifier="YAHOO_MARKET_DAILY",
        dataset_name="market_daily.csv",
        original_timezone="America/New_York",
        frequency="daily_close",
        publication_lag_rule="market_close_1700_et",
        vintage_type="unadjusted_and_adjusted",
        as_of_consensus_available=False,
    ),
    "YAHOO_MARKET_1H": DataSourceContract(
        source_identifier="YAHOO_MARKET_1H",
        dataset_name="market_1h.csv",
        original_timezone="UTC",
        frequency="hourly_bar_open",
        publication_lag_rule="bar_close_equals_bar_start_plus_1h",
        vintage_type="intraday_730d",
        as_of_consensus_available=False,
    ),
    "YAHOO_MARKET_INTRADAY_M5_M30": DataSourceContract(
        source_identifier="YAHOO_MARKET_INTRADAY_M5_M30",
        dataset_name="market_5m.csv / market_30m.csv",
        original_timezone="UTC",
        frequency="5m_and_30m_bar_open",
        publication_lag_rule="bar_close_equals_bar_start_plus_interval",
        vintage_type="intraday_60d_insufficient",
        as_of_consensus_available=False,
    ),
    "CFTC_COT_GOLD": DataSourceContract(
        source_identifier="CFTC_COT_GOLD",
        dataset_name="cftc_gold_weekly.csv",
        original_timezone="America/New_York",
        frequency="weekly_tuesday_report",
        publication_lag_rule="friday_1530_et_lag (+3 days minimum)",
        vintage_type="point_in_time_publication",
        as_of_consensus_available=False,
    ),
    "FED_NEWS_RSS": DataSourceContract(
        source_identifier="FED_NEWS_RSS",
        dataset_name="fed_news.json",
        original_timezone="America/New_York",
        frequency="real_time_rss",
        publication_lag_rule="rss_pubdate_parsed_to_utc",
        vintage_type="unversioned_text",
        as_of_consensus_available=False,
    ),
}


def build_audit_record(
    source_id: str,
    obs_date: str,
    cutoff_utc: str,
    pub_ts_utc: str | None = None,
    vintage: str = "latest",
) -> dict[str, Any]:
    contract = DATA_CONTRACTS.get(source_id)
    if not contract:
        raise ValueError(f"Unknown data source: {source_id}")
    return {
        "source_identifier": contract.source_identifier,
        "dataset_name": contract.dataset_name,
        "observation_date": obs_date,
        "publication_timestamp_utc": pub_ts_utc or obs_date,
        "ingestion_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "vintage": vintage,
        "prediction_cutoff": cutoff_utc,
        "original_timezone": contract.original_timezone,
        "storage_timezone": contract.storage_timezone,
        "publication_lag_rule": contract.publication_lag_rule,
    }


def get_all_data_contracts() -> dict[str, dict[str, Any]]:
    return {k: asdict(v) for k, v in DATA_CONTRACTS.items()}
