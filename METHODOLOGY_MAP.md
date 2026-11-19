# METHODOLOGY MAP — GLD 30-DAY IMPLIED VOLATILITY REPLICA (VIX METHODOLOGY)

This document provides a comprehensive, formula-by-formula and function-by-function mapping of the Python replica implementation to the governing Cboe methodology documents:
1. **Document 1**: *Volatility Index Methodology: Selected Broad-Based Index, Equity and ETF Volatility Indices* (v9.0, revised 30 March 2026).
2. **Document 2**: *Cboe Volatility Index Mathematics Methodology*.

---

## 1. Parameters Summary (GVZ Specifications in Document 1)

| Parameter | Cboe Document 1 Specification | Implementation Mapping |
| :--- | :--- | :--- |
| **Index Name** | "GLD 30-day implied volatility (VIX-methodology replica)" | `gold_vol_replica/publish.py` (`DEFAULT_INDEX_NAME`) |
| **Constant Maturity** | 30 calendar days ($N_{30} = 43,200$ minutes) | `gold_vol_replica/constant_maturity.py` |
| **Underlying Contracts** | PM-settled GLD options expiring on the 3rd Friday of the month (or Thursday prior if Friday is an exchange holiday) | `gold_vol_replica/expiry_selection.py` (`get_third_friday_expiration`) |
| **Exclusion Rule** | Exclude any series with $< 7$ days to expiration | `gold_vol_replica/expiry_selection.py` (`select_near_and_next_terms`) |
| **Constituent Selection** | Nearest Term Method (Document 2 Section 2(b)) | `gold_vol_replica/expiry_selection.py` (`select_near_and_next_terms`) |
| **Quote Input** | NBBO midpoint ($Q = (\text{bid} + \text{ask})/2$) | `gold_vol_replica/forward_strikes.py` (`OptionQuote.midpoint`) |
| **Series-Level Filter** | Not listed for GVZ in Document 1 Table (Page 8); Document 2 Section 6 states it applies only if specified | Confirmed NOT applicable to GVZ. Documented in `REPORT.md`. |
| **Index-Level Filter** | RTH: 0.50 volatility points over 30 seconds | `gold_vol_replica/filters.py` (`IndexLevelFilter`) |
| **Calculation Schedule** | Every 15 seconds during RTH (09:31 to 16:00 ET) | `gold_vol_replica/config.yaml` & `pipeline.py` |
| **Stale Handling** | Republish last valid value flagged as stale if spot value cannot be calculated | `gold_vol_replica/filters.py` (Document 2 Section 5(b)) |

---

## 2. Module & Function-Level Methodology Mapping

### 2.1 Expiry Selection & Expiration Timing (`gold_vol_replica/expiry_selection.py`)

- **`get_us_exchange_holidays(year: int) -> set[datetime.date]`**
  - **Source**: Document 1, Section 2.1 Table (Page 7).
  - **Rule**: Standard US exchange holidays (New Year's, Martin Luther King Jr. Day, Presidents' Day, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas). Used to determine whether the 3rd Friday of a month is a market holiday.
- **`get_third_friday_expiration(year: int, month: int) -> datetime.date`**
  - **Source**: Document 1, Section 2.1 Table (GVZ Row).
  - **Rule**: PM-settled options expiring on the third Friday of each month. If the third Friday is an exchange holiday (e.g., Good Friday), expiration moves to the Thursday immediately prior.
- **`calculate_minutes_to_expiration(calc_time_et: datetime.datetime, expiry_date: datetime.date) -> int`**
  - **Source**: Document 2, Section 3(a)(i) (*Time to Expiration*).
  - **Rule**: $M_{\text{Time to Expiry}} =$ integer number of calendar minutes from the calculation time until 16:00 ET (close of regular trading) on the expiration date, rounded down to the nearest minute. Uses UTC-converted time differences to preserve exact physical elapsed time across daylight-saving transitions (EST $\leftrightarrow$ EDT).
- **`calculate_time_to_expiration(minutes_to_expiry: int) -> float`**
  - **Source**: Document 2, Section 3(a)(i), Equation:
    $$T = \frac{M_{\text{Time to Expiry}}}{M_{365}} = \frac{M_{\text{Time to Expiry}}}{525,600}$$
- **`select_near_and_next_terms(calc_datetime_et, candidate_expiries, min_days_to_expiration=7)`**
  - **Source**: Document 1, Step 1 (Page 9) & Section 2.1; Document 2, Section 2(b) (*Nearest Term Method*).
  - **Rule**:
    1. Filter out all options where $(\text{expiry} - \text{calc\_date}).\text{days} < 7$.
    2. Near-term: expiry closest to current date among the remaining set.
    3. Next-term: expiry closest to and after the near-term expiration date.

---

### 2.2 Yield Curve & Interest Rates (`gold_vol_replica/rates.py`)

- **`fit_natural_cubic_spline(x_points, y_points)`**
  - **Source**: Document 2, Section 2.1 (*Bounded Cubic Spline APY Rate*).
  - **Rule**: Natural cubic spline with boundary condition $S''(x_0) = 0$ and $S''(x_n) = 0$. Piecewise polynomial:
    $$S_i(t) = a_i + b_i(t - x_i) + c_i(t - x_i)^2 + d_i(t - x_i)^3$$
- **`BoundedCubicSplineYieldCurve.interpolate_bey(t_days: float) -> Tuple[float, float, float]`**
  - **Source**: Document 2, Section 2.1.
  - **Interpolation Bounds**: For $t_i \le t \le t_{i+1}$, clamped to $[\min(\text{CMT}_i, \text{CMT}_{i+1}), \max(\text{CMT}_i, \text{CMT}_{i+1})]$.
  - **Extrapolation Bounds ($t < t_1$)**:
    - Lower linear bound: $m_{0, \text{lower}} \cdot t + b_{\text{lower}}$ where $(t_x, \text{CMT}_x)$ is next shortest point with $\text{CMT}_x \ge \text{CMT}_1$.
    - Upper linear bound: $m_{0, \text{upper}} \cdot t + b_{\text{upper}}$ where $(t_y, \text{CMT}_y)$ is next shortest point with $\text{CMT}_y \le \text{CMT}_1$.
  - **Out-of-Bounds ($t > t_n$)**: Explicit `ValueError` raised if $t > 10,950$ days.
- **`BoundedCubicSplineYieldCurve.get_continuously_compounded_rate(t_days: float) -> float`**
  - **Source**: Document 2, Section 2.1 (*Continuous Rate Conversion*).
  - **Formula**:
    $$R = \ln(1 + \text{APY})$$
    where $\text{APY} = \text{BEY}_{\text{bounded}} / 100$.

---

### 2.3 Forward Price & Strike Selection (`gold_vol_replica/forward_strikes.py`)

- **`calculate_forward_price_and_k0(strike_pairs, risk_free_rate_r, time_to_expiration_t)`**
  - **Source**: Document 2, Section 3(a)(ii) (*Forward Price and $K_0$*).
  - **Steps**:
    1. Identify ATM strike with minimum $|C - P|$ midpoint difference. If tied, pick lowest strike.
    2. Forward price formula:
       $$F = K_{\text{ATM}} + e^{R \cdot T} (C_{\text{ATM}} - P_{\text{ATM}})$$
    3. $K_0$: First strike price equal to or immediately below $F$.
    4. Validation per Document 2 Section 5(b)(1): verify quotes for $K_0$ put and $K_0$ call are non-null and $\text{bid} \le \text{ask}$.
- **`select_constituent_strikes(strike_pairs, forward_price, k0)`**
  - **Source**: Document 1, Step 3; Document 2, Section 3(a)(iii) (*Strike Selection*).
  - **Rules**:
    1. OTM Puts ($K < K_0$): scanned descending from $K_0$. Exclude zero bids ($\text{bid} = 0$). Terminate scan immediately when 2 consecutive zero-bid strikes occur; exclude those two and all lower strikes.
    2. At $K_0$: select both Put and Call; $Q(K_0) = \frac{C_{\text{mid}}(K_0) + P_{\text{mid}}(K_0)}{2}$.
    3. OTM Calls ($K > K_0$): scanned ascending from $K_0$. Exclude zero bids ($\text{bid} = 0$). Terminate scan immediately when 2 consecutive zero-bid strikes occur; exclude those two and all higher strikes.
    4. Validation per Document 2 Section 5(b)(2): if all OTM puts or all OTM calls are excluded, raise uncalculable condition.

---

### 2.4 Single-Term Variance (`gold_vol_replica/variance.py`)

- **`calculate_delta_k(strikes: List[float]) -> List[float]`**
  - **Source**: Document 2, Section 3(a)(iv) (*Calculating Volatility*).
  - **Formula**:
    $$\Delta K_0 = K_1 - K_0 \quad (\text{lowest strike})$$
    $$\Delta K_i = \frac{K_{i+1} - K_{i-1}}{2} \quad (\text{interior strikes})$$
    $$\Delta K_N = K_N - K_{N-1} \quad (\text{highest strike})$$
- **`calculate_single_term_variance(...) -> SingleTermVarianceResult`**
  - **Source**: Document 2, Section 3(a)(iv), Equation 1:
    $$\sigma^2 = \frac{2}{T} \sum_i \frac{\Delta K_i}{K_i^2} e^{R \cdot T} Q(K_i) - \frac{1}{T}\left(\frac{F}{K_0} - 1\right)^2$$

---

### 2.5 Constant-Maturity Interpolation (`gold_vol_replica/constant_maturity.py`)

- **`calculate_constant_maturity_index(...) -> ConstantMaturityResult`**
  - **Source**: Document 1, Step 4; Document 2, Section 3(b) (*Constant Maturity Term*).
  - **Constants**: $N_{30} = 43,200$ minutes (30 days $\times$ 1,440), $M_{365} = 525,600$ minutes.
  - **Formulas**:
    $$w_1 = \frac{N_{T2} - N_{30}}{N_{T2} - N_{T1}}, \quad w_2 = \frac{N_{30} - N_{T1}}{N_{T2} - N_{T1}}$$
    $$V = T_1 \sigma_1^2 w_1 + T_2 \sigma_2^2 w_2$$
    $$\sigma_{30}^2 = V \times \left(\frac{525,600}{43,200}\right)$$
    $$\text{Index} = 100 \times \sqrt{\sigma_{30}^2}$$
  - **Bracketing Rule**: $N_{T1} \le 43,200 \le N_{T2}$. Document 2 gives no extrapolation rule for non-bracketing terms; extrapolation is strictly prohibited and raises an explicit `ValueError`.

---

### 2.6 Index-Level Filtering & Republication (`gold_vol_replica/filters.py`)

- **`IndexLevelFilter.process_calculation(calculated_value, calc_timestamp)`**
  - **Source**: Document 1, Section 4 Table (GVZ row); Document 2, Section 5(a) & Section 5(b).
  - **Parameters**: Threshold $= 0.50$ points, Period $= 30$ seconds, RTH.
  - **Algorithm**:
    - Rule 1: First calculated value in session establishes the initial baseline.
    - Rule 2: Calculated value $\ge$ baseline, or drop $< 0.50$ points: updates baseline immediately.
    - Rule 3: Drop $\ge 0.50$ points within $\le 30$ seconds of baseline: filter triggers, calculated value suppressed, baseline republished, audit event logged.
    - Rule 4: If $\ge 30$ seconds have elapsed under suppression, the first subsequent value resets the baseline.
    - Rule 5: Section 5(b) — if spot value cannot be calculated (market outage / invalid quotes), republish the last valid published value and flag `stale = True`.

---

### 2.7 Pipeline Orchestration & Archival (`gold_vol_replica/pipeline.py` & `publish.py`)

- **`compute_snapshot_hash(snapshot_payload)`**: SHA-256 canonical hash of the raw input snapshot for deterministic audit verification.
- **`archive_raw_snapshot(snapshot_payload, capture_time_utc)`**: Ingestion archive written to `raw_archive/` with UTC ISO timestamp.
- **`format_output_record(...)`**: Generates standardized output record schema containing all required tracing fields, rounded to two decimals as demonstrated in Cboe worked examples.
