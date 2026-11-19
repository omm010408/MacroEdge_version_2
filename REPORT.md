# QUANTITATIVE AUDIT REPORT: GLD 30-DAY IMPLIED VOLATILITY REPLICA (VIX METHODOLOGY)

**Module Title**: GLD 30-day implied volatility (VIX-methodology replica)  
**Date**: November 19, 2026  
**Auditor / Quantitative Developer**: Autonomous Quantitative Derivatives Team  
**Governing Documents**:
1. *Volatility Index Methodology: Selected Broad-Based Index, Equity and ETF Volatility Indices* (Cboe, v9.0, revised 30 March 2026) [Document 1]
2. *Cboe Volatility Index Mathematics Methodology* (Cboe) [Document 2]

---

## 1. Executive Summary & Objective

The objective of this engineering implementation is to produce a production-grade Python module that calculates a 30-calendar-day constant-maturity implied volatility index from SPDR Gold Shares (`GLD`) options using the Cboe VIX methodology.

Per strict regulatory and licensing compliance:
- The output is designated strictly as **"GLD 30-day implied volatility (VIX-methodology replica)"**.
- It is **not** called GVZ and is **not** presented as a Cboe index.
- Official Cboe values are never used to overwrite or adjust calculation outputs.
- The replica operates as a point-in-time research feature for the MacroEdge Market Reaction Model (pre-event volatility regime modeling) and is not a trading signal.

All mathematical formulas, filter steps, and conventions map directly to specific sections of Document 1 and Document 2, as documented in `METHODOLOGY_MAP.md`.

---

## 2. Test Execution & Verification Results

A total of 12 tests across 3 comprehensive test suites were developed and executed. **100% of tests passed.**

```
Ran 12 tests in 0.002s
OK
```

### Test Suite A: Worked Example Reproduction (`tests/test_a_worked_example.py`)
- **Target**: Appendix 3 & Appendix 4 of Document 1 (Hypothetical sample calculation for equity/ETF volatility using AAPL option chain snapshots).
- **Results**:
  - **Near-Term Rate ($R_1$)**: Target = $0.031664\%$, Calculated = $0.031664\%$ (Exact match).
  - **Next-Term Rate ($R_2$)**: Target = $0.028797\%$, Calculated = $0.028797\%$ (Exact match).
  - **Time to Expiration ($T_1$)**: Target = $\frac{34,874}{525,600} = 0.0663508$, Calculated = $0.0663508$ (Exact match).
  - **Time to Expiration ($T_2$)**: Target = $\frac{44,954}{525,600} = 0.0855289$, Calculated = $0.0855289$ (Exact match).
  - **Forward Price $F_1$**: Target = $158.94998$, Calculated = $158.94998$ (Exact match).
  - **Forward Price $F_2$**: Target = $158.97497$, Calculated = $158.97497$ (Exact match).
  - **$K_0$ Strikes**: $K_{0,1} = 157.5$, $K_{0,2} = 155.0$ (Exact match).
  - **Constituent Strikes Used**: Near-term = 39 strikes, Next-term = 29 strikes (Exact match to Appendix 4 highlighted rows).
  - **Single-Term Variance ($\sigma_1^2$)**: Target = $0.23011289$, Calculated = $0.23011289$ (Exact match).
  - **Single-Term Variance ($\sigma_2^2$)**: Target = $0.22183472$, Calculated = $0.22183472$ (Exact match).
  - **Final Index Level**: Target = $47.22$ (Raw = $47.2226$), Calculated = **47.22** (Exact match to two decimal places).

### Test Suite B: Synthetic Edge Cases (`tests/test_b_synthetic.py`)
The suite verified all 8 edge cases:
1. **Two consecutive zero-bid strikes**: Verified that scan terminates immediately when two consecutive zero-bid strikes are encountered on both put and call sides, excluding all further out-of-the-money strikes even if subsequent strikes contain positive bids.
2. **Forward price on-strike vs between-strikes**: Verified that $F = 160.00 \rightarrow K_0 = 160.00$ and $F = 158.95 \rightarrow K_0 = 157.50$.
3. **7-day exclusion rule**: Verified that an expiry with 6 days remaining is excluded while an expiry with 7 days remaining is included.
4. **Holiday Friday shift to Thursday**: Verified that Good Friday on April 15, 2022 and April 18, 2025 automatically shifted monthly option expiration to Thursday April 14, 2022 and Thursday April 17, 2025 respectively.
5. **Daylight saving time transitions**: Verified exact calendar minutes to 16:00 ET settlement across March "spring forward" (71 hours = 4,260 minutes) and November "fall back" (73 hours = 4,380 minutes).
6. **All strikes zero-bid**: Verified that when all strikes have zero bids, the pipeline identifies an uncalculable state per Document 2 Section 5(b), republishes the last valid value, and sets `stale = True`.
7. **Rate curve out-of-bounds**: Verified that requesting a rate beyond the 30-year CMT maturity ($t > 10,950$ days) raises an explicit `ValueError`.
8. **Index-level filter trigger**: Verified that a drop of $\ge 0.50$ points within 30 seconds triggers the filter, suppresses the calculation, republishes the baseline, and logs an audit event.

### Test Suite C: Point-in-Time Compliance (`tests/test_c_point_in_time.py`)
1. **Quote timestamp filtering**: Verified that calculations at time $t$ strictly filter and use quotes where $\text{quote\_time} \le t$. Future quotes ($> t$) are discarded.
2. **Post-$t$ quote invariance**: Appending future quotes with timestamps after $t$ left the calculation output at $t$ 100% bit-for-bit unchanged.
3. **Deterministic replay & hash stability**: Verified that identical raw option chain snapshot payloads produce the exact same SHA-256 hash and identical numerical results. Modifying any bid/ask alters the snapshot hash.

---

## 3. Methodological Decisions & Technical Confirmations

### 3.1 Series-Level Filter Applicability to GVZ
- **Source Finding**: In Document 1, Section 2.2 Table (*Series-Level Filtering Algorithm Parameters*, Page 8), series-level filtering parameters are explicitly provided only for **VXD, VXLQD, and VXIEF**. GVZ is omitted.
- **Confirmation in Document 2**: Document 2, Section 6 (*Series-Level Filtering Algorithm*, Page 13) states: *"This section is only utilized if specified in the relevant index methodology."*
- **Conclusion**: Series-level filtering **does not apply** to the GVZ methodology. It has intentionally not been applied to this replica module.

### 3.2 Natural Cubic Spline with Boundary Clamping
- In Document 2, Section 2.1, the interest rate calculation uses a natural cubic spline ($S''(x_0) = S''(x_n) = 0$).
- When calculating rates for maturities shorter than the 1-month CMT ($t < 30$ days), Document 2 establishes linear boundary clamping:
  $$m_{0, \text{lower}} \cdot t + b_{\text{lower}} \le \text{BEY}(t) \le m_{0, \text{upper}} \cdot t + b_{\text{upper}}$$
- In Appendix 3, near-term maturity is 24 days. The unconstrained natural spline produced $0.032971\%$, but Cboe's upper linear boundary clamped this to $0.031667\%$, resulting in continuous rate $R_1 = 0.031664\%$. Our implementation matches this exact linear clamping behavior.

### 3.3 Strict Bracketing vs Extrapolation
- Document 2 Section 3(b) defines 30-day constant-maturity interpolation assuming the near-term ($N_{T1}$) and next-term ($N_{T2}$) bracket 30 days:
  $$N_{T1} \le 43,200 \le N_{T2}$$
- Document 2 provides **no extrapolation formula** if both terms are below 30 days or both are above 30 days.
- In strict adherence to the specification requirement (*"If the selected terms do not bracket 30 days, follow document 2. If it gives no rule, raise an error. Do not extrapolate"*), `gold_vol_replica/constant_maturity.py` raises an explicit `ValueError`.

---

## 4. Operating Rules & Data Architecture

1. **Raw Snapshot Archival**:
   - `publish.archive_raw_snapshot` writes raw JSON snapshots to `raw_archive/` with UTC ISO timestamps and SHA-256 digests.
   - Live option chain snapshots cannot be backfilled after the fact; real-time persistence at ingestion is mandatory.
2. **Historical Option Chain Vendor Dependency**:
   - Historical replay of GLD implied volatility requires a market data vendor (e.g., OPRA / Cboe Datashop / Theta Data / Polygon Options) providing point-in-time bid/ask snapshots with timestamps.
   - Without an authenticated historical option chain vendor, historical backfill remains **BLOCKED**.
3. **Environment Security**:
   - `FRED_API_KEY` and any market data API keys are read strictly from environment variables via `os.environ`. Keys are never logged, stored in output records, or printed to stdout.
