"""
Expiry Selection Module for GLD 30-Day Implied Volatility Replica.

Methodology Mapping:
- Document 1: Section 2.1 (GVZ row), Step 1 (Select Near- and Next-Term).
- Document 2: Section 2(b) (Nearest Term Method), Section 3(a)(i) (Time to Expiration).
"""

from __future__ import annotations

import datetime
from typing import List, Tuple
from zoneinfo import ZoneInfo

# US Eastern Timezone
ET_TZ = ZoneInfo("America/New_York")
UTC_TZ = datetime.timezone.utc
MINUTES_PER_YEAR = 525600.0
SETTLEMENT_HOUR_ET = 16
SETTLEMENT_MINUTE_ET = 0


def get_us_exchange_holidays(year: int) -> set[datetime.date]:
    """
    Standard US equity and options market holidays for a given year.
    Reference: Cboe / NYSE Holiday Schedule.
    """
    holidays = set()

    # 1. New Year's Day (Jan 1, observed on Friday Dec 31 if Saturday, or Monday Jan 2 if Sunday)
    nyd = datetime.date(year, 1, 1)
    if nyd.weekday() == 5:  # Saturday
        holidays.add(datetime.date(year - 1, 12, 31))
    elif nyd.weekday() == 6:  # Sunday
        holidays.add(datetime.date(year, 1, 2))
    else:
        holidays.add(nyd)

    # 2. Martin Luther King Jr. Day (3rd Monday in January)
    first_jan = datetime.date(year, 1, 1)
    mon_offset = (0 - first_jan.weekday()) % 7
    mlk = datetime.date(year, 1, 1 + mon_offset + 14)
    holidays.add(mlk)

    # 3. Washington's Birthday / Presidents' Day (3rd Monday in February)
    first_feb = datetime.date(year, 2, 1)
    mon_offset = (0 - first_feb.weekday()) % 7
    pres = datetime.date(year, 2, 1 + mon_offset + 14)
    holidays.add(pres)

    # 4. Good Friday (Friday before Easter) - Anonymous Gregorian algorithm
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    easter = datetime.date(year, month, day)
    good_friday = easter - datetime.timedelta(days=2)
    holidays.add(good_friday)

    # 5. Memorial Day (Last Monday in May)
    last_may = datetime.date(year, 5, 31)
    mem_day = last_may - datetime.timedelta(days=(last_may.weekday() - 0) % 7)
    holidays.add(mem_day)

    # 6. Juneteenth National Independence Day (June 19, established 2021/2022)
    if year >= 2022:
        june19 = datetime.date(year, 6, 19)
        if june19.weekday() == 5:
            holidays.add(datetime.date(year, 6, 18))
        elif june19.weekday() == 6:
            holidays.add(datetime.date(year, 6, 20))
        else:
            holidays.add(june19)

    # 7. Independence Day (July 4)
    july4 = datetime.date(year, 7, 4)
    if july4.weekday() == 5:
        holidays.add(datetime.date(year, 7, 3))
    elif july4.weekday() == 6:
        holidays.add(datetime.date(year, 7, 5))
    else:
        holidays.add(july4)

    # 8. Labor Day (1st Monday in September)
    first_sep = datetime.date(year, 9, 1)
    mon_offset = (0 - first_sep.weekday()) % 7
    labor = datetime.date(year, 9, 1 + mon_offset)
    holidays.add(labor)

    # 9. Thanksgiving Day (4th Thursday in November)
    first_nov = datetime.date(year, 11, 1)
    thu_offset = (3 - first_nov.weekday()) % 7
    thanksgiving = datetime.date(year, 11, 1 + thu_offset + 21)
    holidays.add(thanksgiving)

    # 10. Christmas Day (Dec 25)
    xmas = datetime.date(year, 12, 25)
    if xmas.weekday() == 5:
        holidays.add(datetime.date(year, 12, 24))
    elif xmas.weekday() == 6:
        holidays.add(datetime.date(year, 12, 26))
    else:
        holidays.add(xmas)

    return holidays


def get_third_friday_expiration(year: int, month: int) -> datetime.date:
    """
    Computes the standard monthly options expiration date for a given year and month.
    Methodology: PM-settled GLD option contracts expiring on the third Friday
    of the month, or the Thursday before if that Friday is an exchange holiday.
    Reference: Document 1, Section 2.1 table.
    """
    first_of_month = datetime.date(year, month, 1)
    # Friday weekday is 4 (Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4)
    friday_offset = (4 - first_of_month.weekday()) % 7
    first_friday = first_of_month + datetime.timedelta(days=friday_offset)
    third_friday = first_friday + datetime.timedelta(days=14)

    holidays = get_us_exchange_holidays(year)
    if third_friday in holidays:
        # Move to Thursday before if Friday is a holiday
        return third_friday - datetime.timedelta(days=1)
    return third_friday


def calculate_minutes_to_expiration(
    calc_time_et: datetime.datetime,
    expiry_date: datetime.date,
) -> int:
    """
    Calculates the exact integer number of calendar minutes until expiration.
    Methodology: Document 2, Section 3(a)(i).
    Minutes from calculation time until expiration (rounded down to the nearest minute).
    PM settlement is at 16:00 ET (4:00 p.m. ET).
    Accurately handles daylight saving time transitions across America/New_York.
    """
    if calc_time_et.tzinfo is None:
        calc_time_et = calc_time_et.replace(tzinfo=ET_TZ)
    else:
        calc_time_et = calc_time_et.astimezone(ET_TZ)

    expiry_datetime_et = datetime.datetime(
        expiry_date.year,
        expiry_date.month,
        expiry_date.day,
        SETTLEMENT_HOUR_ET,
        SETTLEMENT_MINUTE_ET,
        0,
        tzinfo=ET_TZ,
    )

    delta_seconds = (
        expiry_datetime_et.astimezone(UTC_TZ) - calc_time_et.astimezone(UTC_TZ)
    ).total_seconds()
    if delta_seconds < 0:
        return 0
    # Rounded down to the nearest minute as specified in Document 2, Section 3(a)(i)
    return int(delta_seconds // 60)


def calculate_time_to_expiration(minutes_to_expiry: int) -> float:
    """
    Calculates T in calendar years: T = M_Time_to_Expiry / M_365.
    Methodology: Document 2, Section 3(a)(i). M_365 = 525,600.
    """
    return minutes_to_expiry / MINUTES_PER_YEAR


def select_near_and_next_terms(
    calc_datetime_et: datetime.datetime,
    candidate_expiries: List[datetime.date],
    min_days_to_expiration: int = 7,
) -> Tuple[datetime.date, datetime.date]:
    """
    Selects the near-term and next-term expirations using the Nearest Term Method.
    Methodology Mapping:
    - Document 1: Step 1; Section 2.1 (GVZ Row).
    - Document 2: Section 2(b) Nearest Term Method.

    Rules:
    1. Exclude any option series where Days to Expiration is less than 7 days:
       (expiry_date - calc_date).days < min_days_to_expiration
    2. Near-term options: expiring closest to the current date among the remaining set.
    3. Next-term options: expiring closest to and after the near-term expiration date.
    """
    if calc_datetime_et.tzinfo is None:
        calc_datetime_et = calc_datetime_et.replace(tzinfo=ET_TZ)
    else:
        calc_datetime_et = calc_datetime_et.astimezone(ET_TZ)

    calc_date = calc_datetime_et.date()

    # Step 1: Apply the exclusion criteria (exclude series with < 7 days to expiration)
    valid_expiries = [
        exp
        for exp in sorted(set(candidate_expiries))
        if (exp - calc_date).days >= min_days_to_expiration
    ]

    if len(valid_expiries) < 2:
        raise ValueError(
            f"Insufficient valid expirations available (found {len(valid_expiries)}, "
            f"minimum required 2) after applying {min_days_to_expiration}-day exclusion rule."
        )

    # Step 2: Nearest Term Method:
    # Near-term is closest to calculation date
    near_term = valid_expiries[0]
    # Next-term is closest to and after near-term
    next_term = valid_expiries[1]

    return near_term, next_term
