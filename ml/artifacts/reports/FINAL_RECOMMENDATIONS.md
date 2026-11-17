# MacroEdge — Quantitative Production Recommendations & Roadmap
**Generated:** 2026-11-15 10:39:37 UTC  
**Audience:** Quantitative Research, MLOps & Production Engineering

---

## 1. Production Deployment Status

1. **Current Ready Components**:
   - **Phase 8 Reasoning Engine**: Fully integrated and serving the canonical JSON schema through `ml.infer` and Next.js route `/api/ai-models`.
   - **Model 1**: Production ready for economic value forecasting with causal conformal prediction bands.
   - **Model 2**: Production ready for central-bank intelligence using local cached FinBERT and deterministic 12-field extraction.
   - **Model 4**: Production ready for macro regime classification using Causal Gaussian HMM and dynamic 6-factor rules.
   - **Leakage Gate**: Production training pipeline in `ml.train_all` strictly enforces the 0-FAIL leakage gate before any model fit.

2. **Blocked Components Held Offline**:
   - **Model 3 (5m and 30m Horizons)**: Held in `BLOCKED` status. API returns `null` probabilities and `UNAVAILABLE` direction rather than misleading outputs.
   - **Model 3 (FOMC Decisions)**: Held in `BLOCKED` status until official announcement calendar is ingested.

---

## 2. Quantitative Risks & Invalidation Triggers

1. **FRED Data Revision Hindsight Risk**:
   - *Risk*: Historical training observations in `fred_macro_monthly.csv` and `fred_macro_daily.csv` reflect contemporary revised numbers rather than initial release numbers.
   - *Mitigation*: Ingest ALFRED point-in-time vintages (`output_type=4`) for high-revision series (`PAYEMS`, `GDPC1`, `PCEPI`, `RSAFS`).
2. **Proxy Surprise Limitation**:
   - *Risk*: Without real-time consensus surveys, surprise $z$-scores reflect deviation from an autoregressive seasonal baseline rather than consensus expectations.
   - *Mitigation*: Connect a live consensus provider (e.g. Bloomberg, Refinitiv, or Econoday) via `consensus_overrides` payload in `ml.infer`.
3. **Macro Regime Invalidation Triggers**:
   - *US 10Y Real Yield Breakout*: A sharp rise above 2.86% invalidates gold bullish regime signals.
   - *Dollar Momentum Breakout*: DXY closing decisively above 104.50 signals cross-asset risk-off dollar hoarding.
   - *Volatility Shock*: VIX spiking above 22.0 overrides traditional yield sensitivity with safe-haven liquidity demand.

---

## 3. High-Priority Engineering Roadmap

| Phase | Milestone | Priority | Estimated Complexity | Expected Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Q1** | **ALFRED Point-in-Time Data Migration** | HIGH | Medium | Eliminates revision hindsight in historical backtests |
| **Q1** | **Commercial Intraday Tick Feed (COMEX GC)** | HIGH | High | Unblocks 5m and 30m market reaction training |
| **Q2** | **Official FOMC Statement Timestamp Scraper** | MEDIUM | Low | Unblocks FOMC decision reaction modeling |
| **Q2** | **Consensus Survey Feed Integration** | HIGH | Low | Upgrades proxy surprises to institutional survey surprises |
| **Q3** | **Streaming Live WebSocket Ingestion** | MEDIUM | Medium | Sub-second reaction inference on release timestamps |
