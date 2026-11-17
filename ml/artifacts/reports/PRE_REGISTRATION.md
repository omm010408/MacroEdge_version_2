# MacroEdge — Pre-Registration Protocol (v3)

**Document Status:** LOCKED & PRE-REGISTERED  
**Protocol Version:** `v3.0.0-preregistration`  
**Registration Date:** 2026-11-16T01:15:00Z  
**Holdout Index Path:** `ml/artifacts/holdout_index.json`  
**Holdout Index SHA-256 Hash:** `f8a5e709ce0fdcca626e3de69c49de3b096a6dbb2d3e8a133e8876d4e6128432`  
**Accountability Standard:** Scientific Integrity, Out-of-Sample Calibration, and Zero Leakage. Opening or viewing the holdout seals all configuration. Any post-holdout parameter or feature adjustment invalidates the audit.

---

## 1. Components, Targets and Horizons

| Component | Target Identifier | Target Description | Horizons Evaluated | Primary Metric | Secondary Metric(s) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Model 1: Economic Forecast** | `CPIAUCSL`, `CPILFESL` | US Headline & Core CPI (% MoM) | 1 Month Ahead | **MASE** (vs Seasonal Naive) | Pinball Loss ($q_{10}, q_{50}, q_{90}$), MAE, 80% Coverage |
| Model 1: Economic Forecast | `PCEPI`, `PCEPILFE` | US Headline & Core PCE (% MoM) | 1 Month Ahead | **MASE** (vs Seasonal Naive) | Pinball Loss ($q_{10}, q_{50}, q_{90}$), MAE, 80% Coverage |
| Model 1: Economic Forecast | `PAYEMS` | Nonfarm Payrolls Change (Thousands) | 1 Month Ahead | **MASE** (vs Seasonal Naive) | Pinball Loss ($q_{10}, q_{50}, q_{90}$), MAE, 80% Coverage |
| Model 1: Economic Forecast | `UNRATE` | US Civilian Unemployment Rate (%) | 1 Month Ahead | **MASE** (vs Seasonal Naive) | Pinball Loss ($q_{10}, q_{50}, q_{90}$), MAE, 80% Coverage |
| Model 1: Economic Forecast | `GDPC1` | US Real GDP (% QoQ Annualized) | 1 Quarter Ahead | **MASE** (vs Seasonal Naive) | Pinball Loss ($q_{10}, q_{50}, q_{90}$), MAE, 80% Coverage |
| **Model 2: News Intelligence** | Topic & Stance | Financial text macro extraction | Immediate | **Macro F1 Score** | Per-Class P/R, Structured Validity Rate, Agreement |
| Model 2: News Intelligence | Sentiment | ProsusAI/FinBERT 3-class sentiment | Immediate | **3-Class Accuracy** | Vendor Baseline Agreement, Non-Hallucination Rate |
| **Model 3: Market Reaction** | $P(z_h > 0)$ | Directional post-release standardized return | 4h, 1d (5m, 30m BLOCKED) | **Brier Score & Log Loss** | Directional Accuracy, Reliability ECE |
| Model 3: Market Reaction | $z_h$ Quantiles | Standardized return quantiles ($q_{05}, q_{25}, q_{50}, q_{75}, q_{95}$) | 4h, 1d (5m, 30m BLOCKED) | **Mean Pinball Loss** | Realized Volatility Calibration |
| **Model 4: Macro Regime** | Macro State | Point-in-time regime state ($K=4$) | Weekly (W-FRI) | **Out-of-Sample Log-Likelihood** | Regime Flip Rate (/yr), Spell Duration, Brier Score |
| **Aggregation Engine** | Overall Bias & Conf | Deterministic macro reasoning & gating | Live As-Of Cutoff | **Conflict Gating Reliability** | Sizing Multiplier Calibration, Zero Unhandled States |

---

## 2. Pre-Registered Numeric Promotion Gates

A component is promoted to the production registry if and only if it satisfies all pre-registered gates:

1. **Gate 1: Skill Superiority over Baseline (Proper Scoring):**
   - For point/value forecasts: Holdout **MASE < 1.000** and beats baseline on at least **70%** of walk-forward validation folds.
   - For directional probability forecasts: Holdout **Brier Score < Baseline Brier Score** with Diebold–Mariano test $p < 0.05$ (using Newey–West HAC covariance and Harvey–Leybourne–Newbold small-sample correction).
   - If an ML model fails to beat the baseline, the baseline model is promoted and the ML architecture is rejected.
2. **Gate 2: Interval & Distribution Calibration:**
   - Empirical prediction interval coverage must fall within **$\pm 3.0$ percentage points** of nominal level on out-of-fold validation (e.g. nominal 80.0% coverage must achieve empirical coverage $\in [77.0\%, 83.0\%]$).
3. **Gate 3: Probability Calibration:**
   - Expected Calibration Error (**ECE**) must be **$\le 0.050$** on out-of-fold probability predictions after Platt scaling / isotonic regression.
4. **Gate 4: Multi-Regime Consistency:**
   - The component must demonstrate positive skill across at least **two separate macroeconomic regimes** (e.g. Expansion vs Stress), or else its registry scope is strictly marked "RESTRICTED" to its validated regimes.
5. **Gate 5: Point-in-Time Data Integrity:**
   - Zero tolerance for lookahead leakage. 100% of automated point-in-time unit tests must pass in CI without warnings or exceptions.

---

## 3. Multiple-Testing Correction & Significance Levels

- **Nominal Significance Level:** $\alpha = 0.05$.
- **Family-Wise Error Rate (FWER) Control:** Holm–Bonferroni step-down correction applied across horizons and economic slices.
- **False Discovery Rate (FDR) Control:** Benjamini–Hochberg procedure applied across all candidate models for each target.
- **Multiple Testing Accounting:** The total trial budget $N_{trials}$ is recorded and factored into statistical significance assessments to avoid selection bias.
- **Model Confidence Set (MCS):** Hansen's MCS evaluated at $\alpha = 0.10$ to isolate the superior set of models.

---

## 4. Declared Trial Budgets ($N_{trials}$)

Hyperparameter search budgets are strictly declared in advance to bound data mining:

- **Model 1 (Economic Forecast):** 20 trials per target $\times$ 7 targets = **140 trials** (Tree-structured Parzen Estimator / Optuna-style TPE sampler, random seed 42).
- **Model 2 (News Intelligence):** **10 prompt / heuristic configurations** evaluated on validation slice.
- **Model 3 (Market Reaction):** 25 trials per horizon $\times$ 2 evaluated horizons (4h, 1d) = **50 trials**.
- **Model 4 (Macro Regime):** **15 configurations** ($K \in \{3, 4, 5\}$, feature subsets, sticky priors).
- **Total Project Trial Budget:** $N_{trials} = 140 + 10 + 50 + 15 = \mathbf{215}$ trials.

---

## 5. Minimum Event Counts & Slice Reporting

- **Reporting Threshold:** A macroeconomic slice (event category, regime, volatility environment, surprise magnitude) is reported if and only if it contains at least **30 unique dates** and **50 total events**.
- **Insufficient Sample Handling:** Any slice with $<50$ events must be marked **"INSUFFICIENT"** and cannot be used for model promotion.
- **Minimum Detectable Effect (MDE):** Reported for all evaluated slices given sample size and historical standard deviation.

---

## 6. Shadow Deployment & Live Promotion Requirements

Before any component is marked **"LIVE"** in production:
1. **Shadow Deployment Window:** Minimum **30 calendar days** of forward operation in shadow mode.
2. **Minimum Scored Events:** Minimum **20 live macroeconomic events** scored.
3. **Immutability Contract:** Every live prediction must be recorded with its prediction cutoff timestamp, input feature SHA-256 hash, and model version before the release outcome is published. No retrospective edits are allowed.
4. **Drift Monitoring Triggers:**
   - Rolling ECE $> 0.08$ triggers automated calibration warning.
   - Population Stability Index (PSI) $> 0.25$ triggers feature drift alert.
   - CUSUM forecast error detector crossing 3 standard deviations triggers scheduled retraining.

---

## 7. Frozen Holdout Definitions & Index Verification

- **Monthly Economic Holdout:** `2024-11-01` to `2026-10-01` ($n=24$ months).
- **Weekly Macro Regime Holdout:** `2024-10-18` to `2026-10-09` ($n=104$ weeks).
- **Market Reaction Holdout:** `2024-11-01` to `2026-10-31` ($n=114$ events across 69 unique event dates).
- **News Intelligence Benchmark Holdout:** $n=23$ completed human-audited ground truth articles (`ml/data/news_human_review_dataset.json`).
- **Holdout Index Hash:** `f8a5e709ce0fdcca626e3de69c49de3b096a6dbb2d3e8a133e8876d4e6128432`.

*Signed & Locked by Coordinator, Lead Econometrician, and Validation Lead.*
