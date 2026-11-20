# US30 (Dow Jones 30) Strategy Specification & Integration Design

**Asset:** US30 / Dow Jones Industrial Average (CFD / Cash Index)  
**Strategy Type:** Multi-Timeframe Smart Money Concepts (SMC) + Macro Regime Confluence  
**Auditor / Architect Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  

---

## 1. Executive Summary & Asset Profile

US30 exhibits distinct market microstructure characteristics that differentiate it from XAUUSD (Gold):
1. **Exchange Session Dominance:** While XAUUSD is continuous 24/5 OTC, US30 volatility and institutional order flow are heavily concentrated in the **US Regular Trading Hours (RTH: 09:30 – 16:00 ET / 14:30 – 21:00 UTC)**, with CME Globex futures providing pre-market liquidity.
2. **The "Judas Swing" (09:30 ET Opening Run):** The first 15–30 minutes of the NYSE cash open (09:30 – 10:00 ET) routinely manipulate pre-market (Asian/London) liquidity pools before reversing into the true directional trend.
3. **Macro Transmission Channel:** US30 is driven by US corporate earnings, economic growth indicators (NFP, Retail Sales, ISM Manufacturing), and Federal Reserve interest rate policy. It responds negatively to real yield spikes during inflation panics, but rallies on disinflationary easing.

---

## 2. Instrument Specification: US30

```typescript
export const US30_SPEC: InstrumentSpec = {
  symbol: "US30",
  version: "v1.0_standard_cfd",
  assetClass: "INDEX",
  baseCurrency: "USD",
  quoteCurrency: "USD",
  contractSize: 1.0,           // 1 standard lot = 1 index point = $1.00 USD
  tickSize: 1.0,               // 1 index point minimum fluctuation
  tickValue: 1.0,              // $1.00 per point on 1.0 lot (standard CFD)
  minLotSize: 0.1,             // 0.10 lot = $0.10 per point
  maxLotSize: 100.0,
  lotStep: 0.1,
  standardPip: 1.0,            // In indices, 1 point = 1 pip
  typicalSpreadPips: 2.5,      // 2.5 points typical broker spread
  marginRequirementPct: 5.0,   // 1:20 leverage (standard institutional index margin)
  effectiveFromUtc: "2026-01-01T00:00:00Z",
};
```

*Note on Broker Variations:* Some broker venues (e.g. IC Markets, Pepperstone) quote US30 with 2 decimals (0.01 tick size = $0.01/tick) or define 1 lot = 10 contracts ($10/point). The system dynamically loads broker overrides from `public.instrument_specs`.

---

## 3. Four-Stage Algorithmic Sequence for US30

```text
1D / 4H Macro & Technical Bias 
    └── 15M Key Zone & Asian/London Liquidity Reference 
         └── 09:30 AM ET (14:30 UTC) Opening Liquidity Sweep 
              └── 5M / 1M Change of Character (CHOCH) Confirmation
```

### Stage 1: High-Timeframe (1D & 4H) Bias
- **Technical Market Structure:** 5-bar Williams Fractal swing points on 1D and 4H charts. Higher Highs (HH) + Higher Lows (HL) = Bullish; Lower Highs (LH) + Lower Lows (LL) = Bearish.
- **Macro Confluence Scoring:**
  - MacroEdge Model 4 Macro Regime Bias score ($S_{\text{macro}} \in [-100, +100]$):
    - Bullish if $S_{\text{macro}} \ge +10$ (Expansionary / Disinflationary Easing).
    - Bearish if $S_{\text{macro}} \le -10$ (Hawkish Tightening / Stagflation).
    - Neutral if $-10 < S_{\text{macro}} < +10$.
  - Fed Policy & Yield Check: Yield curve inversion relief and neutral/dovish Fed stance support equity index expansions.
- **Conflict Rule:** If 1D is Bullish but 4H is Bearish (pullback into 1D discount), the bias is `PULLBACK_ACCUMULATION`. Long trades require a 4H CHOCH before taking lower-timeframe signals.

### Stage 2: 15M Key Zone & Session Liquidity
- **Key Zone Formation:**
  - **15M Unmitigated Order Block (OB):** The last opposite candle before a high-momentum displacement breaking 15M structure.
  - **15M Fair Value Gap (FVG):** Imbalance between Bar 1 and Bar 3.
  - **Volatility Clamp:** If $(\text{Zone Top} - \text{Zone Bottom}) > 1.5 \times \text{ATR}_{15M}(14)$, clamp to candle body (Open to Close).
- **Session Reference Levels (Marked prior to 09:30 ET):**
  - Asian Session High & Low (23:00 – 06:00 UTC).
  - London Session High & Low (07:00 – 12:00 UTC).
  - Previous Day High (PDH) & Previous Day Low (PDL).

### Stage 3: 09:30 AM ET Opening Liquidity Sweep
- **Timing Window:** **14:30 – 15:30 UTC (09:30 – 10:30 AM ET)**.
- **Mechanism:** Price spikes into a key zone, sweeping the London High (for Short) or London Low (for Long).
- **Condition:**
  - The sweep candle wick must pierce the session high/low ($\text{High}_{\text{bar}} > \text{Session High}$).
  - The candle body must close back inside ($\text{Close}_{\text{bar}} \le \text{Session High}$).
  - A full candle body close outside denotes a genuine breakout, not a sweep (`STATUS = BREAKOUT_INVALIDATION`).

### Stage 4: Lower-Timeframe (5M / 1M) Confirmation
- **Trigger:**
  - Upon valid sweep, price must reverse and print a **Change of Character (CHOCH)** on the 1M or 5M chart, closing below/above the most recent minor structural pivot.
  - The displacement must leave a 1M or 5M Fair Value Gap (FVG).
  - **Entry:** Limit order placed at the proximal edge (or 50% equilibrium) of the confirmation FVG.
  - **Timeout:** Confirmation must occur within **45 minutes (9 five-minute bars)** of the sweep event.

---

## 4. Trade Execution Parameters & Position Sizing

1. **Stop Loss:**
   - Placed **10 index points** beyond the extreme wick of the sweep candle (to absorb index spread volatility).
2. **Position Sizing Formula:**
   $$\text{Lots} = \frac{\text{Account Equity} \times \text{Risk \%}}{\text{Stop Distance (Points)} \times \text{Point Value per Lot}}$$
   - *Example:* On a \$100,000 prop challenge account risking 0.5% (\$500) with a 40-point stop loss on a \$1.00/point CFD contract:
     $$\text{Lots} = \frac{500}{40 \times 1.00} = 12.5\text{ lots}$$
3. **Targets & Profit Taking:**
   - **Minimum Hurdle:** 2.0R required. Setups offering $< 2.0R$ to the next major opposing liquidity pool are rejected.
   - **TP1 (2.0R):** Close 50% of the position; move stop loss to Breakeven.
   - **TP2:** Opposing session extreme (e.g. London Low for a short taken at London High).

---

## 5. Risk Gatekeeper & News Blackout Windows

1. **Prop-Firm Compliance:**
   - **Max Daily Loss:** Block orders if current daily loss $\ge 4.5\%$ (protecting 5% hard limit).
   - **Max Trailing Drawdown:** Block orders if current equity distance to HWM $\ge 9.0\%$ (protecting 10% hard limit).
   - **Daily Reset:** 21:00 UTC (17:00 ET NYSE post-market close / CME maintenance roll).
2. **High-Impact News Blackout Windows:**
   - **08:30 AM ET Releases (13:30 UTC):** US CPI, Core CPI, PCE, Nonfarm Payrolls (NFP), PPI, Retail Sales.
     - *Window:* **13:15 – 13:45 UTC** (All setup triggers locked).
   - **14:00 PM ET Releases (19:00 UTC):** FOMC Interest Rate Decision & Press Conference.
     - *Window:* **18:45 – 20:00 UTC** (All setup triggers locked).
