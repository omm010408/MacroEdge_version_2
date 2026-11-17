# MacroEdge Phase 6 — Macro Regime Detection & Interpretation Report

**Generated:** 2026-11-12  
**Model:** Model 4 — Point-in-Time Macro Regime Detection & XAUUSD Bias ([macro_regime_bias.py](file:///Users/ommroshan/Downloads/MacroEdge/ml/models/macro_regime_bias.py))  
**Machine Experiment Artifact:** [model4_regime_run.json](file:///Users/ommroshan/Downloads/MacroEdge/ml/artifacts/training_runs/model4_regime_run.json)  
**Training Summary:** [model4_training_report.json](file:///Users/ommroshan/Downloads/MacroEdge/ml/artifacts/reports/model4_training_report.json)  
**OOS Regime Panel:** [regime_panel_oos.csv](file:///Users/ommroshan/Downloads/MacroEdge/ml/artifacts/macro_regime/regime_panel_oos.csv)

---

## 1. Point-in-Time Methodology & Leakage Controls

- **Sample Span:** `2004-03-26` to `2026-10-09` (**1,177** weekly observations after rolling 5Y factor warmup).
  - **Expanding Warmup:** `260` weeks (`2004-03-26` to `2009-03-13`).
  - **Walk-Forward Validation (OOS):** `813` weeks (`2009-03-20` to `2024-10-11`). Hyperparameters (`C`, `XGB` grid) and `K`/feature-sensitivity studies were restricted strictly prior to the holdout boundary.
  - **Untouched Final Holdout:** `104` weeks (`2024-10-18` to `2026-10-09`, ~2 years).
- **Publication-Lag & Causal Alignment:**
  - Monthly/quarterly/weekly FRED series in `fred_macro_daily.csv` are shifted to actual release/publication dates via `align_fred_daily_point_in_time()`.
  - Daily H.15 FRED series (`DFF`, `DGS2`, `DGS10`, `DFII10`, `T10YIE`, `T5YIFR`, `T10Y2Y`, `RRPONTSYD`) are lagged by `1` business day.
  - CFTC COT positioning is shifted from Tuesday snapshot dates to Friday release dates via `get_pit_cftc_series()`.
  - `volatility_stress_z` uses homogeneous `VIX` + 13w `SPX` realized volatility (excluding `BAMLH0A0HYM2`, which only starts `2023-11-13`).
  - Live inference (`include_partial_latest_week=True`) caps trailing `W-FRI` bins at `max_obs_date` (`2026-11-12`), preventing future `as_of_date` timestamps.
  - **4-Week Target Embargo:** Supervised 4-week XAUUSD directional fits enforce a `4`-week purge gap (`idx - 4` in OOF, `len(tr) - 4` in TimeSeriesSplit CV).
- **Prefix-Invariance Verification (`cutoff_date = 2022-06-24`, `953` weeks):**
  - `max_feature_diff = 0.0` (`features_prefix_invariant = True`)
  - `km_oos_prefix_invariant = True`, `gmm_oos_prefix_invariant = True`, `hmm_oos_prefix_invariant = True`
- **Permanent Dataset Caveat:** Underlying FRED CSVs contain latest-revised observations rather than ALFRED `output_type=4` initial-release vintages (`PAYEMS`, `GDPC1`, `PCEPI`, `PCEPILFE`, `INDPRO`, `RSAFS`).

---

## 2. Regime Model Comparison: Rules vs. K-Means vs. GMM vs. Causal HMM

Because `hmmlearn` and `statsmodels` are not installed in `.venv`, a self-contained `CausalGaussianHMM` (diagonal-covariance Gaussian emissions, sticky Dirichlet transition prior `sticky_alpha=12.0`, Baum-Welch EM on past expanding windows, and strictly causal forward filtering `P(S_t | X_{1:t})` without backward smoothing) was implemented and compared directly against transparent rules, rolling/expanding K-Means, and full-covariance GMM (`K=4` on 6 macro factors: `growth_z`, `inflation_z`, `real_yields_z`, `dollar_z`, `volatility_stress_z`, `fed_policy_z`), alongside empirical 4×4 Markov transition matrices on all methods' OOS sequences.

### 2.1 Stability & Transition Frequency (917 OOS Weeks, `2009-03-20` – `2026-10-09`)

| Method | Transitions | Transitions / Yr | Persistence Prob | Mean Spell (wks) | Median Spell (wks) | Max Spell (wks) | Fit / Uncertainty Metric |
|---|---:|---:|---:|---:|---:|---:|---|
| **Rules (Raw Weekly)** | 137 | 7.80 | 0.8504 | 6.64 | 3.0 | 43 | Deterministic thresholds |
| **Rules (2w Causal Hysteresis)** | 73 | 4.16 | 0.9203 | 12.39 | 8.5 | 43 | 2-week confirmation filter |
| **K-Means (Expanding OOS)** | 98 | 5.58 | 0.8930 | 9.26 | 3.0 | 112 | Mean train silhouette: `0.2918` |
| **GMM (Full Cov, Expanding OOS)** | 104 | 5.92 | 0.8865 | 8.73 | 5.0 | 70 | Mean BIC: `8490.03` \| OOS LL: `-8660.65` \| Mean Entropy: `0.1047` |
| **Causal Gaussian HMM (Forward-Filtered OOS)** | **49** | **2.79** | **0.9465** | **18.34** | **10.0** | **111** | OOS LL: **`-6772.84`** \| Mean Entropy: **`0.0478`** |

### 2.2 Empirical Markov Transition Matrix Comparison (Diagonal Persistence & Expected Duration)

- **Rules (Raw):** Self-transition probabilities `[Risk-Off: 0.7603 (4.17w), Hawkish: 0.8462 (6.50w), Reflation: 0.8071 (5.19w), Disinflation/Easing: 0.8981 (9.81w)]`.
- **Rules (2w Hysteresis):** Self-transition probabilities `[Risk-Off: 0.8792 (8.28w), Hawkish: 0.9048 (10.50w), Reflation: 0.9023 (10.23w), Disinflation/Easing: 0.9481 (19.27w)]`.
- **K-Means (OOS):** Self-transition probabilities `[State 0: 0.8450 (6.45w), State 1: 0.8235 (5.67w), State 2: 0.9211 (12.68w), State 3: 0.8820 (8.47w)]`.
- **GMM (OOS):** Self-transition probabilities `[State 0: 0.9277 (13.83w), State 1: 0.8841 (8.63w), State 2: 0.8735 (7.90w), State 3: 0.8912 (9.19w)]`.
- **Causal HMM (OOS Empirical vs. Learned `A_`):**
  - Empirical OOS filtered sequence: `[State 0: 0.9457 (18.42w), State 1: 0.8934 (9.38w), State 2: 0.9647 (28.31w), State 3: 0.9463 (18.64w)]`.
  - Learned sticky transition matrix `A_` diagonal: `[0.9669, 0.9855, 0.9800, 0.9822]`.
  - Causal HMM improves OOS log-likelihood by `+1,887.81` nats over full-covariance GMM (`-6772.84` vs `-8660.65`) while cutting regime flips by more than half (`49` vs `104` transitions).

### 2.3 Cross-Method Agreement (OOS Adjusted Rand Index & NMI)

- `ARI(Rules 2w Hys vs K-Means) = 0.1614`
- `ARI(Rules 2w Hys vs GMM) = 0.0429`
- `ARI(Rules 2w Hys vs Causal HMM) = 0.1167` (`NMI = 0.1722`)
- `ARI(K-Means vs GMM) = 0.0538`
- `ARI(GMM vs Causal HMM) = 0.0518` (`NMI = 0.0794`)

**Key Finding:** Low ARI across methods confirms that unsupervised clusters do **not** rediscover textbook economic quadrants by default; labels must be assigned strictly from realized empirical centroids (`_describe_empirical_centroid`), never assumed beforehand.

---

## 3. K-Selection & Feature-Selection Sensitivity (Validation Slice Only)

### 3.1 Number of States `K ∈ {3, 4, 5}` (2009–2024 Validation, Untouched Holdout Excluded)

| `K` | K-Means Silhouette | K-Means Transitions | GMM Mean BIC | GMM OOS LL | GMM Transitions | Causal HMM OOS LL | Causal HMM Transitions |
|---:|---:|---:|---:|---:|---:|---:|---:|
| `K=3` | 0.3056 | 68 | 8063.30 | -7682.93 | 106 | -6254.69 | 36 |
| `K=4` | 0.3001 | 78 | 7728.96 | -8132.26 | 98 | -6181.53 | 43 |
| `K=5` | 0.3047 | 76 | 7480.77 | -8477.12 | 142 | -6160.10 | 41 |

- Full-covariance GMM OOS log-likelihood degrades monotonically as `K` rises (`-7682.93` -> `-8132.26` -> `-8477.12`), signaling covariance over-parameterization, whereas Causal HMM (diagonal emissions + sticky prior) improves cleanly from `K=3` to `K=4` with negligible extra churn (`43` vs `36` transitions).

### 3.2 Feature-Set Sensitivity (`4f` vs `6f` vs `8f` at `K=4`)

- **GMM:** `ARI(4f vs 6f) = 0.1167`, `ARI(6f vs 8f) = 0.0825`
- **Causal HMM:** `ARI(4f vs 6f) = 0.2424`, `ARI(6f vs 8f) = 0.1824`
- **K-Means:** `ARI(4f vs 6f) = 0.2963`, `ARI(6f vs 8f) = 0.1592`

All unsupervised methods exhibit substantial boundary drift when adding `dollar_z`/`fed_policy_z` (`4f -> 6f`) or `positioning_z`/`net_liquidity_z` (`6f -> 8f`), reinforcing why production reporting combines transparent 6-dimension economic rules with Causal HMM filtering rather than relying solely on raw cluster IDs.

---

## 4. Economic Interpretability & Empirical OOS State Profiles (`n=917`)

### 4.1 Causal Gaussian HMM OOS State Profiles

| State (Post-Hoc Centroid Tag) | Weeks (Share) | Mean Centroid `(Growth, Infl, RealY, DXY, Stress, FedPol)` | Avg XAU 4w | XAU 4w Win Rate | XAU 4w Vol | Avg DXY 4w | Avg SPX 4w |
|---|---:|---|---:|---:|---:|---:|---:|
| **State 0 (Tight Policy/Yields)** | 221 (24.1%) | `(-0.09, -0.34, +0.65, +0.87, +0.00, +0.58)` | **+1.08%** | **57.9%** | 4.36% | -0.27% | +1.15% |
| **State 1 (High Stress / Loose Policy/Yields)** | 122 (13.3%) | `(-0.41, -0.31, -0.70, +0.17, +0.99, -0.23)` | +0.38% | 49.2% | 4.02% | +0.19% | +1.71% |
| **State 2 (Loose Policy/Yields)** | 368 (40.1%) | `(+0.25, +0.22, -0.73, +0.05, -0.20, -0.15)` | +0.70% | 55.7% | 4.99% | +0.42% | +1.00% |
| **State 3 (Low Vol / Expansion / Tight Policy/Yields)** | 206 (22.5%) | `(+0.45, +0.30, +0.49, +0.11, -0.79, +0.44)` | +0.70% | 53.9% | 3.67% | -0.13% | +0.70% |

### 4.2 Rule-Based (2w Causal Hysteresis) OOS Profiles

| Rule Regime | Weeks (Share) | Avg XAU 4w | XAU 4w Win Rate | Avg DXY 4w | Avg SPX 4w |
|---|---:|---:|---:|---:|---:|
| **Risk-Off / Volatility Stress** | 149 (16.2%) | **+1.10%** | **56.4%** | -0.33% | +2.98% |
| **Hawkish Tightening** | 211 (23.0%) | +0.84% | 53.6% | -0.01% | +0.11% |
| **Reflation / Sticky Inflation** | 133 (14.5%) | +0.05% | 52.6% | +0.30% | +0.30% |
| **Disinflationary Expansion / Easing** | 424 (46.2%) | +0.80% | 55.9% | +0.24% | +1.10% |

### 4.3 Historical Consistency Spot-Checks (Strictly OOS)

| Date | Historical Episode | Rule Regime (2w Hys) | Causal HMM Label | Key Factor Z-Scores |
|---|---|---|---|---|
| `2009-05-15` | Post-GFC Recovery / Low-Rate Transition | Risk-Off / Volatility Stress | State 1 (High Stress / Loose Policy/Yields) | `growth=-2.97`, `infl=-2.17`, `stress=+1.47` |
| `2011-09-02` | Eurocrisis / Debt-Ceiling Gold Peak | Risk-Off / Volatility Stress | State 2 (Loose Policy/Yields) | `real_y=-2.11`, `dxy=-0.45`, `stress=+0.70` |
| `2013-06-28` | Taper Tantrum | Disinflationary Expansion / Easing | State 3 (Low Vol / Expansion / Tight Policy/Yields) | `growth=+0.72`, `real_y=+0.82`, `stress=-0.67` |
| `2017-06-30` | Low-Vol Disinflationary Expansion | Hawkish Tightening | State 3 (Low Vol / Expansion / Tight Policy/Yields) | `stress=-1.29`, `fed_pol=+1.05`, `real_y=+0.53` |
| `2020-03-27` | COVID-19 Liquidity Shock | Risk-Off / Volatility Stress | State 1 (High Stress / Loose Policy/Yields) | `stress=+3.50`, `fed_pol=-3.25`, `real_y=-2.12` |
| `2022-06-24` | 2022 Inflation & Fed Hiking Shock | Risk-Off / Volatility Stress | State 0 (Tight Policy/Yields) | `infl=+1.96`, `real_y=+1.79`, `dxy=+2.29`, `stress=+0.98` |
| `2023-10-27` | Higher-for-Longer Real Yield Peak | Hawkish Tightening | State 0 (Tight Policy/Yields) | `real_y=+2.11`, `dxy=+1.46`, `fed_pol=+0.35` |
| `2025-06-27` | 2025 Tariff/Growth-Slowdown Easing Transition | Risk-Off / Volatility Stress | State 0 (Tight Policy/Yields) | `dxy=-1.04`, `stress=+0.71`, `real_y=+0.51` |

---

## 5. Directional 4-Week XAUUSD Evaluation (Walk-Forward Validation vs. Untouched Holdout)

| Split & Period | Model | Dir Acc | Bal Acc | ROC-AUC | Brier | LogLoss | Strategy Sharpe | Buy & Hold Sharpe | Strategy CumRet | Buy & Hold CumRet |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Validation** (`2009-03-20` – `2024-10-11`, `n=813`) | Trailing Base Rate | 0.5424 | 0.5000 | 0.4593 | 0.2504 | 0.6940 | 0.510 | 0.510 | 185.62% | 185.62% |
| Validation | Transparent Macro Rules | 0.5387 | 0.5445 | 0.5293 | 0.2640 | 0.7243 | 0.268 | 0.510 | 46.23% | 185.62% |
| Validation | Logistic Regression (`C=1.0`) | 0.5141 | 0.4928 | 0.4784 | 0.2634 | 0.7242 | 0.473 | 0.510 | 136.87% | 185.62% |
| Validation | XGBoost (`depth=1, n=60`) | 0.5289 | 0.4890 | 0.4678 | 0.2547 | 0.7033 | 0.388 | 0.510 | 103.56% | 185.62% |
| Validation | **Blended Ensemble** | 0.5338 | 0.5041 | 0.4734 | 0.2569 | 0.7082 | 0.502 | 0.510 | 155.33% | 185.62% |
| **Untouched Holdout** (`2024-10-18` – `2026-10-09`, `n=104`) | Trailing Base Rate | 0.6058 | 0.5000 | 0.3395 | 0.2420 | 0.6771 | 1.108 | 1.108 | 53.15% | 53.15% |
| Untouched Holdout | Transparent Macro Rules | 0.3846 | 0.4367 | 0.4510 | 0.2801 | 0.7572 | -0.478 | 1.108 | -11.15% | 53.15% |
| Untouched Holdout | Logistic Regression (`C=1.0`) | 0.6058 | 0.5000 | 0.3833 | 0.2506 | 0.6962 | 1.108 | 1.108 | 53.15% | 53.15% |
| Untouched Holdout | XGBoost (`depth=1, n=60`) | 0.6058 | 0.5000 | 0.4574 | 0.2419 | 0.6771 | 1.108 | 1.108 | 53.15% | 53.15% |
| Untouched Holdout | **Blended Ensemble** | 0.6058 | 0.5000 | 0.3709 | 0.2458 | 0.6854 | 1.108 | 1.108 | 53.15% | 53.15% |

**Honest Interpretation:**
- Neither transparent macro factor rules nor causal ML classifiers consistently outperform passive gold drift on 4-week directional timing (`Validation ROC-AUC = 0.4734` for blended ensemble, `0.5293` for rules; `Holdout ROC-AUC = 0.3709`).
- During the `2024-10` to `2026-10` structural gold rally (`+53.15%` cumulative return) alongside elevated real yields, static negative-real-yield rules lost money (`-11.15%`, Sharpe `-0.478`), whereas the shrunk causal ML ensemble stayed aligned with the trailing positive base rate (`53.15%`, Sharpe `1.108`).
- Consequently, Model 4's primary empirical value is **point-in-time macro state identification, regime-persistence filtering, cross-model disagreement diagnostics, and risk-off monitoring**, rather than high-conviction standalone 4-week directional alpha.

---

## 6. Verification Status

- `.venv/bin/python -m ml.validation.leakage_checks`: **PASS: 13 | WARN: 6 | FAIL: 0** (Exit code `0`; zero critical/high/medium failures across all 4 models).
- Live inference verified (`as_of_date = 2026-11-12` on both `CPI` and blocked `FOMC` scenarios with `None`-safe Model 3 horizon handling).
