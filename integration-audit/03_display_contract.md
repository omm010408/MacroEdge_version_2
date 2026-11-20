# Display Data Contract: Macro Edge E-Ink Terminal Feed

**Date:** 2026-11-20  
**Auditor:** Senior Systems Engineer (Linux Hardware, Go & Security)  
**Specification Version:** `1.0.0-eink`  
**Compliance Classification:** Non-Trading Macroeconomic Research Surface  
**Source Code References:**
- [src/lib/ai-models/types.ts#L223-L253](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L223-L253) (`Phase8MacroReasoning`)
- [src/lib/ai-models/types.ts#L255-L275](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L255-L275) (`AiModelsSnapshot`)
- [src/services/ai-models/everyday-bias-engine.ts#L920-L982](file:///Users/ommroshan/Downloads/MacroEdge/src/services/ai-models/everyday-bias-engine.ts#L920-L982) (`buildEverydayBiasEngineSnapshot`)
- [src/app/api/ai-models/route.ts#L10-L52](file:///Users/ommroshan/Downloads/MacroEdge/src/app/api/ai-models/route.ts#L10-L52) (`GET /api/ai-models`)

---

## 1. Governance Principles & Strict Compliance Boundaries

1. **Pure Research Surface:** The display acts solely as an ambient, institutional research monitor.
2. **Strict Prohibition on Trading Language:**
   - **FORBIDDEN:** "BUY", "SELL", "LONG", "SHORT", "ENTRY", "STOP LOSS", "TAKE PROFIT", "PRICE TARGET", "ORDER", "LOT SIZE", or trade recommendations.
   - **PERMITTED:** Objective macroeconomic regime classifications, directional bias indicators (`BULLISH`, `MIXED`, `BEARISH`), economic consensus forecasts, realized indicators, and statistical evidence statements.
3. **Mandatory Metadata on Every Frame:**
   - Data Source Name (`"MacroEdge Institutional Terminal · AI Research Supervisor"`).
   - Data Age (`"Generated XX min ago"`).
   - Prediction Cutoff timestamp in ISO 8601 UTC.
   - Model versions short hash.
   - Non-investment advice regulatory disclaimer.
4. **Enforced Staleness Invalidation:** If the current system time exceeds `prediction_cutoff` plus the configured threshold (e.g. 60 minutes), the edge agent MUST draw an inverted high-contrast warning banner: `[STALE DATA — FEED AGED > THRESHOLD]`.

---

## 2. Field Specifications (Task C)

Every visual item rendered on the e-ink screen is derived directly from the terminal's published model structures:

| Display Contract Field | Source Type & Location in Macro Edge | Datatype / Format | Description & Truncation Rules |
| :--- | :--- | :--- | :--- |
| **`overall_bias`** | `Phase8MacroReasoning.overall_bias` ([src/lib/ai-models/types.ts#L225](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L225)) | String Enum: `"BULLISH" \| "BEARISH" \| "NEUTRAL"` (or mixed variants) | Prominent hero badge representing directional macro regime stance. |
| **`macro_regime`** | `Phase8MacroReasoning.macro_regime.current_regime` ([src/lib/ai-models/types.ts#L227-L228](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L227-L228)) | String (max 40 chars) | Name of current macroeconomic regime (e.g. `"Goldilocks Expansion"`, `"Stagflation Stress"`). |
| **`data_quality_status`** | `Phase8MacroReasoning.data_quality_status` ([src/lib/ai-models/types.ts#L245](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L245)) | String Enum: `"VERIFIED_LIVE" \| "CACHED" \| "DEGRADED"` | Telemetry validation state of upstream data providers. |
| **`prediction_cutoff`** | `Phase8MacroReasoning.prediction_cutoff` ([src/lib/ai-models/types.ts#L246](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L246)) | ISO 8601 UTC String | Cutoff timestamp when point-in-time features were frozen. |
| **`model_versions_hash`** | Derived from `Phase8MacroReasoning.model_versions` ([src/lib/ai-models/types.ts#L247-L252](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L247-L252)) | Hex String (8 chars) | SHA-256 short hash of the 4 model version strings, verifying algorithmic auditability. |
| **`next_event`** | Next upcoming item from `upcoming_events` ([src/lib/ai-models/types.ts#L238](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L238)) | Object: `{ label, scheduled_utc, scheduled_local, forecast, unit }` | Next Tier-1/Tier-2 macroeconomic release with consensus and dual UTC/local timestamps. |
| **`supporting_evidence`** | `Phase8MacroReasoning.supporting_evidence` ([src/lib/ai-models/types.ts#L242](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L242)) | Array of String (exact 3 items) | Top 3 factual macro indicators supporting the bias. **Strictly truncated to 80 characters max each**. |
| **`conflicting_evidence`** | `Phase8MacroReasoning.conflicting_evidence` ([src/lib/ai-models/types.ts#L243](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L243)) | Array of String (exact 3 items) | Top 3 opposing or counter-regime indicators. **Strictly truncated to 80 characters max each**. |
| **`stale_banner`** | Computed dynamically by edge agent | Boolean | `true` if `now() - prediction_cutoff > staleness_threshold_seconds`. Triggers inverted warning block. |
| **`source_attribution`** | Static contract constant | String: `"MacroEdge Terminal"` | Institutional platform identity. |

---

## 3. Formal JSON Schema Specification

The edge service will validate inbound payloads against this JSON Schema before rendering:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MacroEdgeEinkDisplayContract",
  "type": "object",
  "required": [
    "overall_bias",
    "macro_regime",
    "data_quality_status",
    "prediction_cutoff",
    "model_versions_hash",
    "next_event",
    "supporting_evidence",
    "conflicting_evidence",
    "source_name",
    "published_at"
  ],
  "properties": {
    "overall_bias": {
      "type": "string",
      "enum": ["BULLISH", "BEARISH", "NEUTRAL", "MIXED_POSITIVE", "MIXED_NEGATIVE"]
    },
    "macro_regime": {
      "type": "string",
      "maxLength": 40
    },
    "data_quality_status": {
      "type": "string",
      "enum": ["VERIFIED_LIVE", "CACHED", "DEGRADED", "STALE", "SIMULATED"]
    },
    "prediction_cutoff": {
      "type": "string",
      "format": "date-time"
    },
    "model_versions_hash": {
      "type": "string",
      "pattern": "^[a-f0-9]{8}$"
    },
    "next_event": {
      "type": "object",
      "required": ["label", "scheduled_utc", "scheduled_local", "forecast"],
      "properties": {
        "label": { "type": "string", "maxLength": 50 },
        "scheduled_utc": { "type": "string" },
        "scheduled_local": { "type": "string" },
        "forecast": { "type": "string", "maxLength": 25 }
      }
    },
    "supporting_evidence": {
      "type": "array",
      "minItems": 1,
      "maxItems": 3,
      "items": { "type": "string", "maxLength": 80 }
    },
    "conflicting_evidence": {
      "type": "array",
      "maxItems": 3,
      "items": { "type": "string", "maxLength": 80 }
    },
    "source_name": {
      "type": "string",
      "const": "MacroEdge Institutional Terminal"
    },
    "published_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false
}
```

---

## 4. Visual Layout Specification: Dasung Paperlike HD (2200 × 1650)

The Dasung Paperlike HD has a native resolution of **2200 × 1650 pixels** at a **4:3 aspect ratio** (~207 PPI). The visual layout is optimized for high-contrast e-ink readability using IBM Plex Sans / JetBrains Mono styling:

```
+-----------------------------------------------------------------------------------+
| MACROEDGE RESEARCH TERMINAL                UTC: 2026-11-20 22:45 | LOCAL: 03:15   |
| STATUS: [VERIFIED_LIVE]                    MODELS HASH: a7f89c02 | AGE: 4m ago    |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  OVERALL MACRO REGIME STANCE:                                                     |
|  +-----------------------------------------------------------------------------+  |
|  |                                                                             |  |
|  |     ###  B U L L I S H  ###       REGIME: Expansionary Disinflation         |  |
|  |                                                                             |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
|  [!] IF STALE: *** STALE DATA WARNING -- FEED CUTOFF EXCEEDS 60 MIN ***          |
+-----------------------------------------------------------------------------------+
|  SUPPORTING MACRO EVIDENCE (+)             | CONFLICTING EVIDENCE / RISKS (-)     |
|  1. US 10Y Real Yield -12 bps to 1.84%     | 1. Oil futures +2.8% to $82.40/bbl   |
|  2. Core PCE MoM steady at 0.22%           | 2. Dollar Index (DXY) testing 104.2  |
|  3. ISM Services New Orders up to 54.2     | 3. Primary Dealer repo usage +$15B   |
+-----------------------------------------------------------------------------------+
|  NEXT HIGH-IMPACT ECONOMIC DOCKET CATALYST                                        |
|  Event:     US Headline CPI (MoM)                                                 |
|  Scheduled: 2026-11-21 13:30:00 UTC (18:00 Local)                                 |
|  Consensus: +0.24% MoM (Prior: +0.20%) | Target Mandate: 2.0% YoY                 |
+-----------------------------------------------------------------------------------+
| DISCLAIMER: INSTITUTIONAL RESEARCH SURFACE ONLY. NOT INVESTMENT OR FINANCIAL     |
| ADVICE. ALL DATA SYNTHESIZED FROM POINT-IN-TIME PUBLIC OBSERVATIONS.              |
+-----------------------------------------------------------------------------------+
```

---

## 5. Typography and Rendering Constraints for E-Ink

1. **Colors:** Strictly **1-bit monochrome (Black `#000000` on White `#FFFFFF`)** or 3-level grayscale (Light Gray `#CCCCCC` for card dividing lines). No continuous tone photographic gradients.
2. **Font Metrics:**
   - Header / Meta: 24pt Monospace (JetBrains Mono).
   - Hero Bias Badge: 72pt Bold Sans-Serif (IBM Plex Sans) with 4px solid border.
   - Evidence Lines: 28pt Regular Sans-Serif with high line-height (1.4×) to prevent glyph collision.
   - Disclaimer: 18pt Monospace.
3. **No Dynamic CSS Transitions / Smoothing:** Fonts must be rendered with anti-aliasing disabled or tuned to bi-level thresholding when Mode 1 (M1) is enabled on the Dasung hardware.
