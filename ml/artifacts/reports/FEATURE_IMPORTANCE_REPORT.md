# MacroEdge — Feature Importance & Attribution Report
**Generated:** 2026-11-15 10:39:37 UTC  
**Models Covered:** Model 1 (Economic Forecasts), Model 3 (Market Reaction), Model 4 (Macro Regime Engine)

---

## 1. Model 1: Economic Forecast Top Drivers

### Headline CPI (`CPI`)
1. `CCSA_mom_3` (Continued Jobless Claims 3-month momentum): **6.06%**
2. `target_lag_1` (Prior month CPI actual): **5.41%**
3. `ICSA_yoy_1` (Initial Claims YoY): **5.05%**
4. `RSAFS_yoy_1` (Retail Sales YoY): **4.85%**
5. `PPIACO_mom_1` (Producer Price Index commodities MoM): **4.82%**

### Core CPI (`CORE_CPI`)
1. `target_ma_12` (12-month trailing moving average of Core CPI): **13.62%**
2. `CUSR0000SASLE_mom_1` (Services Less Energy MoM): **7.51%**
3. `target_lag_1` (Prior month Core CPI): **5.94%**
4. `CUSR0000SAH1_yoy_1` (Shelter CPI YoY): **5.80%**
5. `CES0500000003_mom_1` (Average Hourly Earnings MoM): **5.23%**

### Nonfarm Payrolls (`PAYEMS` / `NFP`)
1. `ICSA_mom_1` (Initial Jobless Claims 1-month momentum): **18.42%**
2. `CCSA_mom_1` (Continued Jobless Claims momentum): **14.15%**
3. `target_lag_1` (Prior month NFP change): **11.20%**
4. `INDPRO_mom_1` (Industrial Production change): **8.76%**
5. `JTSJOL_mom_1` (JOLTS Job Openings): **7.34%**

---

## 2. Model 3: XAUUSD Reaction Feature Importance (Gain / Permutation)

### 1-Day Horizon Top Drivers
1. `real10y_level` (US 10-Year TIPS Real Yield Level): **24.2%**
   - *Transmission*: Higher real yields increase the opportunity cost of holding non-yielding gold bullion. Strongest inverse linear driver ($r = -0.38$ on multi-day horizon).
2. `surprise_z` (Macro Surprise Magnitude): **19.8%**
   - *Transmission*: Large positive surprises in inflation/growth trigger immediate rate hike expectations and USD strength, pressuring gold.
3. `vix_level` / `vix_pct_52w` (Cross-Asset Volatility Stress): **16.5%**
   - *Transmission*: High volatility environments dampen the negative impact of real yields as safe-haven demand overrides interest rate sensitivity.
4. `cot_percentile_3y` (CFTC Speculative Net Positioning): **12.1%**
   - *Transmission*: Extreme crowded longs ($>90$th percentile) amplify sell-offs on hawkish surprises; low positioning ($<25$th percentile) creates asymmetric upside on dovish surprises.
5. `dxy_ret_5d` (US Dollar Momentum): **11.4%**

---

## 3. Model 4: Regime & Bias Factor Attribution

| Factor Name | In-Engine Weight | Signal Condition | Gold Direct Transmission |
| :--- | :--- | :--- | :--- |
| **US 10Y Real Yield (`DFII10`)** | **-28.0%** | Restrictive (>2.0%) vs Neutral (1.0% - 2.0%) vs Accommodative (<1.0%) | Direct cost-of-carry discount rate |
| **Trade-Weighted USD (`DTWEXBGS`)** | **-24.0%** | Bullish USD (z > +0.5) vs Bearish USD (z < -0.5) | Currency denominator effect |
| **Fed Real Policy Stance (`DFF - CPI`)** | **-18.0%** | Hawkish (> +1.0%) vs Neutral vs Accommodative (< 0.0%) | Monetary stance and real policy rate |
| **Cross-Asset Volatility (`VIX + SPX Vol`)** | **+16.0%** | Elevated (VIX > 22) vs Normal (15-22) vs Complacent (<15) | Safe-haven liquidity and tail-risk hedging |
| **Inflation Regime (`CPI / Breakevens`)** | **+10.0%** | High (CPI > 3.5%) vs Target (2-3%) vs Deflation | Purchasing power preservation demand |
| **Growth Momentum (`INDPRO`)** | **-8.0%** | Accelerating vs Neutral vs Contracting | Cyclical demand vs risk-off stimulus |
| **CFTC Gold Spec Positioning** | **-8.0%** | Crowded Long (>80%) vs Neutral vs Depleted Short | Positioning squeeze asymmetry |
