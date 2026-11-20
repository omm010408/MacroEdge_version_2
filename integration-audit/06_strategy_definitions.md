# XAUUSD Strategy Definitions & Algorithmic Rules (Phase 1 — Read-Only)

**Core Sequence:**  
`1D/4H Directional Macro Bias → 15M Key Zone → Liquidity Sweep → 5M/1M Price-Action Confirmation`  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  

---

## 1. Algorithmic Rule Specifications & Disambiguation

### Rule 1: High-Timeframe (HTF) Directional Bias (1D & 4H)
* **Algorithmic Definition:**
  - **Swing Points:** Identified using a causal 5-bar Williams Fractal (a swing high at bar $t-2$ requires $\text{High}_{t-2} > \text{High}_{t-4}, \text{High}_{t-3}, \text{High}_{t-1}, \text{High}_t$; swing low mirrored).
  - **1D Structure:** Bullish if the last structural break formed a Higher High (HH) with candle body close; Bearish if Lower Low (LL).
  - **4H Structure:** Evaluates intermediate order flow using 5-bar fractals on 4H candles.
  - **Macro Confluence:** Model 4 Macro Regime Bias score ($S_{\text{macro}} \in [-100, +100]$) and 10Y Real Yield (`DFII10`) signal must not oppose the technical trend (e.g. if technicals are Bullish, macro score must be $\ge -15$ and real yields not aggressively rising).
* **Ambiguity Identified:** What is the rule when 1D is Bullish but 4H is Bearish (a deep 4H pullback into a 1D discount zone)?
* **Proposed Default for Approval:**  
  - If 1D is Bullish and 4H is Bearish, HTF Bias is classified as **`PULLBACK_IN_BULLISH_TREND` (NEUTRAL / ACCUMULATION)**.
  - Long trades are strictly permitted **only after 4H prints a Change of Character (CHOCH)** confirming the pullback has completed. Short trades are prohibited against the 1D trend.
* **Synthetic Test Case 1 (Unit Test):**
  - *Setup:* Synthetic 1D bars: `[100, 102, 105, 103, 108]` (HH formed at 108, close 107 -> 1D Bullish). Synthetic 4H bars pull back from 108 to 104: `[108, 106, 105, 104]` (4H LH/LL -> 4H Bearish).
  - *Expected Result:* `HTF_BIAS = NEUTRAL_BULLISH_PULLBACK`. Flag `longs_allowed = false` until 4H candle closes above 106.

---

### Rule 2: 15M Key Zone Identification
* **Algorithmic Definition:**
  - Key zones are constructed exclusively from two structural elements on the 15-minute chart:
    1. **Unmitigated Order Block (OB):** The last opposing candle body prior to an explosive multi-bar displacement that caused a 15M Break of Structure (BOS).
    2. **Fair Value Gap (FVG):** A 3-bar imbalance where $\text{Low}_{\text{bar 1}} > \text{High}_{\text{bar 3}}$ (Bearish FVG) or $\text{High}_{\text{bar 1}} < \text{Low}_{\text{bar 3}}$ (Bullish FVG).
* **Ambiguities Identified:** How wide should the zone be, and when does it expire?
* **Proposed Default for Approval:**
  - **Zone Boundaries:** Top = $\text{High}_{\text{OB}}$, Bottom = $\text{Low}_{\text{OB}}$.
  - **Volatility Width Cap:** If $(\text{Zone Top} - \text{Zone Bottom}) > 1.5 \times \text{ATR}_{15M}(14)$, the zone is clamped to the candle body (Open to Close) rather than the wicks.
  - **Expiration / Invalidation:** A zone expires if:
    1. It is mitigated (price penetrates $> 50\%$ of zone depth and leaves).
    2. A full 15M candle body closes completely beyond the zone boundary (invalidation).
    3. 24 hours (96 fifteen-minute bars) elapse without price tapping the zone.
* **Synthetic Test Case 2 (Unit Test):**
  - *Setup:* Synthetic 15M bars: Bar 1 down candle (100–98), Bar 2 massive up candle (98–104) breaking prior swing high at 102, Bar 3 (104–106).
  - *Expected Result:* Bullish OB created at `[98.0, 100.0]`. Bar 4 retraces to 99.5. Zone state changes to `TAPPED_ACTIVE`. Bar 5 closes at 97.0 -> Zone state immediately changes to `INVALIDATED`.

---

### Rule 3: Liquidity Sweep
* **Algorithmic Definition:**
  - Identifies the intentional triggering of retail stop orders above an established swing high (Buy-Side Liquidity, BSL) or below a swing low (Sell-Side Liquidity, SSL).
* **Ambiguity Identified:** Does a wick penetration count as a sweep, or must the bar close back inside?
* **Proposed Default for Approval:**
  - **Strict Sweep Condition:** The high of the sweeping candle must exceed the reference swing high ($\text{High}_{\text{bar}} > \text{Swing High}$), **BUT the candle body MUST close below the reference swing high** ($\text{Close}_{\text{bar}} \le \text{Swing High}$).
  - A candle body closing above the swing level constitutes a **Break of Structure (BOS)**, NOT a liquidity sweep.
* **Synthetic Test Case 3 (Unit Test):**
  - *Setup:* Prior swing high established at 150.00.
    - Candidate Bar A: Open 148, High 151.20, Low 147.50, Close 149.30.
    - Candidate Bar B: Open 148, High 151.50, Low 148.00, Close 150.80.
  - *Expected Result:* Bar A is flagged `VALID_SWEEP` (wick pierced 150.00, closed at 149.30). Bar B is flagged `STRUCTURE_BREAK` (closed above 150.00), sweep status `REJECTED`.

---

### Rule 4: Lower-Timeframe (5M / 1M) Confirmation
* **Algorithmic Definition:**
  - After a 15M zone tap and liquidity sweep, execution is never taken blindly. Price must print an internal structural reversal on the 5M or 1M chart.
* **Ambiguities Identified:** Which events constitute confirmation, in what order, and what is the timeout?
* **Proposed Default for Approval:**
  - **Required Sequence:**
    1. **Change of Character (CHOCH):** A 1M or 5M candle body close breaking the most recent internal swing point in the direction of the HTF bias.
    2. **Imbalance Creation:** The CHOCH displacement must leave an unmitigated 1M or 5M Fair Value Gap (FVG).
    3. **Entry Trigger:** Limit order placed at the proximal boundary (50% equilibrium or first edge) of the FVG on the first retest.
  - **Confirmation Timeout:** The confirmation CHOCH and FVG must form within **12 five-minute bars (60 minutes)** of the liquidity sweep. If 60 minutes pass without CHOCH, the setup expires as `CONFIRMATION_TIMEOUT`.
* **Synthetic Test Case 4 (Unit Test):**
  - *Setup:* Liquidity sweep occurred at 10:00:00Z. Internal 1M low is at 148.00.
  - *Bar sequence:* 10:05Z breaks and closes at 147.50 with FVG between 148.50 and 147.80.
  - *Expected Result:* Event `CHOCH_CONFIRMED` emitted at 10:05Z. Limit order generated at 147.80. If no retest occurs by 10:45Z, order expires.

---

### Rule 5: Stop-Loss & Invalidation Rules
* **Algorithmic Definition:**
  - **Stop Placement:** Set strictly **1 standard pip ($0.10 for XAUUSD)** beyond the extreme wick of the liquidity sweep candle.
  - **Structural Invalidation:** If price violates the sweep extreme before entry execution, the setup is instantly cancelled (`VOID_SETUP`).
  - **Maximum Risk per Trade:** Fixed at **1.0% of account equity** (or **0.5%** if evaluating under prop-firm challenge parameters). Never scale into a losing position.
* **Synthetic Test Case 5 (Unit Test):**
  - *Setup:* Short setup. Liquidity sweep high reached 2,650.50. Entry triggered at 2,646.00.
  - *Expected Result:* Stop Loss placed at $2,650.50 + 0.10 = \$2,650.60$. Stop distance = $4.60. On a $100,000 account risking 1% ($1,000), position size = $1,000 / (4.60 * 100) = 2.17 lots.

---

### Rule 6: Target Rules & Risk-to-Reward Ratio (R:R)
* **Algorithmic Definition:**
  - **Minimum Hurdle:** Minimum required R:R is **2.0R**. Setups where the opposing liquidity pool or key zone offers $< 2.0R$ are automatically skipped (`R_RATIO_INSUFFICIENT`).
  - **Target 1 (TP1):** Placed at 2.0R. Upon reaching TP1, 50% of the position is closed, and the stop loss on the remaining 50% is automatically moved to Breakeven (`entry_price + spread`).
  - **Target 2 (Runner TP2):** Placed at the opposing 15M/1H major swing liquidity pool.
* **Synthetic Test Case 6 (Unit Test):**
  - *Setup:* Entry 2,640.00, Stop 2,645.00 (Risk $5.00). Opposing support zone at 2,632.00 (Potential reward $8.00 = 1.6R).
  - *Expected Result:* Setup flagged `REJECTED_LOW_RR` (1.6R < 2.0R minimum hurdle).

---

### Rule 7: Session Filters & News Blackout Windows
* **Algorithmic Definition:**
  - **Session Permissibility:**
    - **London Open:** 07:00 – 10:30 UTC (**Primary High Liquidity Window**).
    - **New York Open:** 12:30 – 16:00 UTC (**Primary Overlap & Expansion Window**).
    - **Asian Session (23:00 – 06:00 UTC):** Trading **PROHIBITED**. Used exclusively to record the Asian High and Asian Low as candidate liquidity pools for London/NY to sweep.
    - **Daily Settlement / Roll (21:00 – 22:00 UTC):** All trading blocked due to spread widening.
  - **Economic News Blackout Windows:**
    - Using MacroEdge's calendar feed (`/api/calendar`), trading is strictly locked:
      - **15 minutes before** high-impact US macro events (CPI, Core CPI, PCE, NFP, FOMC rate decision, PPI).
      - **15 minutes after** the release.
    - If a trade is active prior to news, the trade planner alerts the user to close or move stop to breakeven.
* **Synthetic Test Case 7 (Unit Test):**
  - *Setup:* Current timestamp: `2026-11-20T13:25:00Z`. Event scheduled: US Core CPI at `13:30:00Z`.
  - *Expected Result:* System status = `NEWS_BLACKOUT_ACTIVE` (13:15:00Z to 13:45:00Z). All setup generations blocked; risk gate returns `BLOCK_NEWS_WINDOW`.
