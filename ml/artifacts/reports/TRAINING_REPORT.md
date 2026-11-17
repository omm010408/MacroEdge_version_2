# MacroEdge — Model Training & Optimization Report
**Generated:** 2026-11-15 10:39:37 UTC  
**Architecture:** 4-Model Hierarchical Macro Intelligence Engine  
**Hardware & Environment:** macOS Darwin arm64 (`libomp` accelerated XGBoost)

---

## 1. Model 1: Economic Forecast Models

### Architecture & Candidates
Model 1 evaluates five distinct model families for each macroeconomic indicator:
1. `last_value`: Naive random-walk benchmark.
2. `ar_ridge`: Univariate autoregressive Ridge regression with seasonal lags (t-1, t-2, t-3, t-12).
3. `ridge`: Multivariate Ridge regression with L2 regularization (alpha in [0.1, 1.0, 10.0, 100.0]).
4. `huber`: Huber robust linear regressor resistant to outlier pandemic prints (epsilon=1.35, alpha in [0.01, 0.1, 1.0]).
5. `xgboost`: Gradient boosted decision trees (`max_depth=2`, `learning_rate=0.03`, `subsample=0.8`, `colsample_bytree=0.8`).
6. `ensemble`: Equal-weighted blend of the top-performing linear and tree models.

### Indicator Configurations & Model Selection
| Indicator | Selected Family | Target Horizon | Feature Space | AR Benchmark | Selection Criterion |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `CPI` | ridge | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |
| `CORE_CPI` | ridge | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |
| `PCE` | ensemble | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |
| `CORE_PCE` | ridge | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |
| `NFP` | xgboost | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |
| `UNRATE` | xgboost | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |
| `GDPC1` | ridge | None | Features: 0 | AR Benchmark: — | Selected via TimeSeriesSplit Dev MAE |

---

## 2. Model 2: News Intelligence Model

### Architecture
- **NLP Backbone**: Pretrained `ProsusAI/finbert` (Hugging Face transformers, cached locally for offline execution).
- **Inference Engine**: Deterministic 12-field financial entity and policy extractor operating over raw text.
- **Evaluation Set**: 45 real Federal Reserve & BLS communications in `ml/data/news_human_review_dataset.json` (23 manually audited ground truth items, 22 pending review items).
- **Zero Synthetic Leakage**: Eliminated all previous synthetic corpus training and cross-validation scripts.
- **Audited Metrics**:
  - Structured extraction validity: **100%**
  - Topic classification accuracy: **100%** ($F_1 = 1.0$)
  - FinBERT sentiment accuracy on Fed texts: **86.96%** (Macro $F_1 = 0.3101$, reflecting predominant neutral/nuanced tone)
  - Policy & XAUUSD non-hallucination accuracy: **100%**

---

## 3. Model 3: XAUUSD Market Reaction Model

### Feature Space (16 Causal Market & Macro Features)
- Macro Surprise: `surprise_z`, `abs_surprise_z`, `expected_surprise`.
- Interest Rates & Real Yields: `real10y_level`, `real10y_chg_5d`, `us10y_level`, `yield_curve_2s10s`.
- Currency & Volatility: `dxy_ret_5d`, `vix_level`, `vix_pct_52w`.
- Cross-Asset Momentum: `spx_ret_5d`, `xau_ret_5d`, `xau_vol_20d`.
- Positioning & Trend: `cot_percentile_3y`, `xau_dist_50dma_pct`, `xau_dist_200dma_pct`.

### Training Details
- **Loss Functions**: Huber regression loss (delta=1.0) for returns; Multi-class cross-entropy for 3-class direction (Up / Flat / Down, threshold +/-0.15% for 4h, +/-0.25% for 1d); Pinball loss for quantiles (alpha in [0.10, 0.25, 0.50, 0.75, 0.90]).
- **Validation**: Purged and embargoed walk-forward splitting grouped by `event_date` ($n=134$ 4h events, $n=1,450$ 1d events).

---

## 4. Model 4: Macro Regime & Bias Engine

### Architecture
1. **Dynamic Transparent Rules**: 6-factor composite score combining Real Yields (-28%), US Dollar (-24%), Fed Stance (-18%), Volatility Stress (+16%), Inflation (+10%), Growth (-8%), and Spec Positioning (-8%).
2. **Causal Gaussian HMM**: Self-contained diagonal-covariance Hidden Markov Model with sticky Dirichlet transition prior, fitted using strictly causal forward filtering (P(S_t | X_1:t) without backward smoothing).
3. **Expanding GMM & K-Means**: Unsupervised 4-state clustering fitted out-of-sample over an expanding historical window (2004–2026).
4. **Machine Learning Bias Layer**: Logistic Regression ($C=1.0$) + XGBoost (`n_estimators=60`, `max_depth=1`, `learning_rate=0.04`, `reg_lambda=15.0`) predicting 4-week forward XAUUSD direction.
