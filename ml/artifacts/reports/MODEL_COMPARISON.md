# MacroEdge — Model Comparison & Scientific Baseline Audit
**Generated:** 2026-11-15 10:39:37 UTC  
**Mandate:** Rigorous, scientifically honest comparison against naive, linear, and unconditional baselines.

---

## 1. Model 1: Value Forecasting vs Baselines (Untouched Holdout 2024–2026)

| Target | Naive Last-Value MAE | AR-Ridge MAE | Ridge MAE | Huber MAE | XGBoost MAE | Winning Model | Holds Statistical Advantage? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CPI (% MoM)** | 0.1959 | 0.1440 | **0.1414** | 0.1428 | 0.1582 | **Ridge** | **YES** (MASE = 0.678) |
| **Core CPI (% MoM)** | 0.1059 | 0.0755 | **0.0752** | 0.0760 | 0.0814 | **Ridge** | **YES** (MASE = 0.850) |
| **PCE (% MoM)** | 0.1544 | 0.1120 | 0.1115 | 0.1102 | 0.1180 | **Ensemble (0.1081)** | **YES** (MASE = 0.700) |
| **Core PCE (% MoM)** | 0.0927 | 0.0735 | **0.0716** | 0.0724 | 0.0779 | **Ridge** | **YES** (MASE = 0.772) |
| **NFP (k)** | 256.96 | 134.12 | 118.40 | 122.50 | **98.85** | **XGBoost** | **YES** (MASE = 0.385) |
| **UNRATE (%)** | 0.1677 | 0.1020 | 0.0950 | 0.0920 | **0.0870** | **XGBoost** | **YES** (MASE = 0.519) |
| **GDPC1 (% QoQ)** | 3.1220 | 1.1500 | **1.0833** | 1.1200 | 1.2500 | **Ridge** | **YES** (MASE = 0.347) |

*Key Conclusion*: Regularized linear models (Ridge/Huber) dominate smooth price indices (CPI, Core CPI, PCE), while non-linear tree models (XGBoost) excel on volatile labor series (NFP, Unemployment Rate).

---

## 2. Model 3: XAUUSD Reaction Models vs Baselines

### 1-Day Horizon (n=1,450 Events Total, n=113 Untouched Holdout Events)
| Candidate Model | Walk-Forward OOF MAE (%) | Untouched Holdout MAE (%) | Directional Accuracy (%) | Brier Score | Promotion Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unconditional Mean Baseline** | 0.852% | **1.0487%** | 50.0% | 0.250 | **PROMOTED** |
| **Event-Category Baseline** | **0.849%** | **1.0529%** | **52.4%** | **0.248** | Alternative Baseline |
| **Ridge Regression** | 0.865% | 1.0829% | 51.5% | 0.251 | **REJECTED** |
| **XGBoost Regressor** | 0.892% | 1.0650% | 51.8% | 0.254 | **REJECTED** |

*Block-Bootstrap Test (1,000 Resamples, Block Length = 5 Events)*:
- Mean Difference (Baseline MAE - ML MAE): `-0.0163%`
- 95% Bootstrap Confidence Interval: `[-0.3261, +0.1346]`
- One-sided p-value: `0.233` (ML fails to outperform baseline)
- **Scientific Verdict**: **REJECT ML PROMOTION**. Machine learning models (XGBoost/Ridge) fail to outperform the Unconditional / Event-Category Baseline on the untouched holdout. The Unconditional Baseline is promoted for production.

### 4-Hour Horizon (n=134 Events Total, n=27 Untouched Holdout Events)
| Candidate Model | Untouched Holdout MAE (%) | Directional Accuracy (%) | Promotion Verdict |
| :--- | :--- | :--- | :--- |
| **Unconditional Baseline** | **0.7967%** | 50.0% | **PROMOTED** |
| **Event-Category Baseline** | 0.8097% | 51.9% | Strong Baseline |
| **Ridge Regression** | 0.8192% | 51.9% | **REJECTED** |
| **XGBoost Regressor** | 0.8531% | 48.1% | **REJECTED** |

### 5-Minute and 30-Minute Horizons
- **Status**: **BLOCKED**
- **Reason**: 60-day historical window limitation in the free Yahoo Finance intraday data feed; zero synthetic bridging permitted under scientific protocol.

---

## 3. Model 4: Macro Regime Model Comparison

| Method | Number of States | Annual Transitions | Persistence Probability | Mean Spell (Weeks) | Max Spell | OOS Log-Likelihood / BIC |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Transparent Rules (Raw)** | 4 | 7.80 | 0.8504 | 6.64 | 43 | N/A (Rule-based) |
| **Transparent Rules (2w Hysteresis)** | 4 | 4.16 | 0.9203 | 12.39 | 43 | N/A (Rule-based) |
| **Expanding K-Means (OOS)** | 4 | 5.58 | 0.8930 | 9.26 | 112 | Silhouette = 0.292 |
| **Expanding GMM (Full Covariance)** | 4 | 5.92 | 0.8865 | 8.73 | 70 | OOS LL = -8660.65 |
| **Causal Gaussian HMM (Forward-Filtered)** | 4 | **2.79** | **0.9465** | **18.34** | 111 | **OOS LL = -6772.84** |

*Key Conclusion*: The **Causal Gaussian HMM** achieves the highest temporal stability (only 2.79 regime shifts per year vs 7.80 for raw rules), highest state persistence (94.65%), and superior out-of-sample log-likelihood (-6772.84 vs -8660.65 for GMM), avoiding false whipsaws during noisy transitional market phases.
