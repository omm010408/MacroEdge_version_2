# Roadmap & Engineering Decisions: Macro Edge E-Ink Display

**Date:** 2026-11-20  
**Auditor:** Senior Systems Engineer (Linux Hardware, Go & Security)  
**Status:** Phase 1 Investigation Complete — Awaiting User Approvals  
**Artifact Directory:** [integration-audit/](file:///Users/ommroshan/Downloads/MacroEdge/integration-audit/)  

---

## 1. Staged Implementation Roadmap (P0 to P5)

This roadmap outlines the disciplined, engineering-first rollout of the Macro Edge ambient e-ink display across six distinct phases:

```
+-----------+     +-----------+     +-----------+     +-----------+     +-----------+     +-----------+
|    P0     | --> |    P1     | --> |    P2     | --> |    P3     | --> |    P4     | --> |    P5     |
| Hardware  |     |  Driver   |     |  Layout   |     |   Edge    |     | Observ-   |     | Hardening |
| Baseline  |     |   Spike   |     |  Renderer |     |   Agent   |     |  ability  |     | & Prod    |
+-----------+     +-----------+     +-----------+     +-----------+     +-----------+     +-----------+
```

### Phase 0 (P0): Host & Hardware Baseline Validation
- **Goal:** Confirm the physical monitor and host GPU communicate over DDC/CI without executing unapproved commands.
- **Action:** User runs `sudo ddcutil detect --verbose` on the Linux host, sanitizes serial numbers, and supplies the output (Task B.2).
- **Deliverable:** Verified I2C bus path (e.g. `/dev/i2c-3`) and confirmed HDMI video link.

### Phase 1 (P1): Driver Spike & Panel Ergonomics (Test Host)
- **Goal:** Validate DDC control primitives and measure physical e-ink characteristics before writing application code.
- **Action:**
  - Build test harness to verify `pkg/dasung` DDC controls: `-contrast 1..9`, `-speed 1..5`, `-mode 1..4`, `-clear`.
  - Push a static high-contrast test pattern to the HDMI video output via Linux DRM/KMS or framebuffer (`/dev/fb0`).
  - Measure hardware refresh latency (ms), residual ghosting accumulation, and typographic legibility under ambient lighting.
- **Deliverable:** Validated configuration baseline: Speed 5 (Black++), Mode 1 (1-bit), Contrast 7.

### Phase 2 (P2): Layout Engine & Static Renderer
- **Goal:** Develop a deterministic, high-performance bitmap generator in Go matching the Task C visual specification.
- **Action:**
  - Implement layout engine using Go pure graphics libraries (`golang.org/x/image`, `freetype` or static vector/canvas).
  - Target exact resolution: 2200 × 1650 pixels (4:3 aspect ratio).
  - Unit-test rendering against offline JSON fixtures matching the Task C contract ([integration-audit/03_display_contract.md](file:///Users/ommroshan/Downloads/MacroEdge/integration-audit/03_display_contract.md)).
- **Deliverable:** Self-contained renderer producing raw 1-bit or 8-bit uncompressed bitmaps with zero memory leaks.

### Phase 3 (P3): Edge Agent Core Daemon (`macroedge-displayd`)
- **Goal:** Implement the full background polling service.
- **Action:**
  - Outbound HTTPS polling engine (60s–300s configurable interval).
  - Schema validator verifying inbound payload against Task C contract.
  - Content hashing (SHA-256) to eliminate redundant frame redrawing.
  - Integrated DDC state machine triggering periodic `Clear()` every 10 redraws.
  - Implementation of all 6 Failure States ([integration-audit/04_edge_architecture.md#5](file:///Users/ommroshan/Downloads/MacroEdge/integration-audit/04_edge_architecture.md#5)).
- **Deliverable:** Working `macroedge-displayd` binary and systemd service unit.

### Phase 4 (P4): Observability, Heartbeat & Watchdog
- **Goal:** Integrate appliance telemetry into Macro Edge terminal operations.
- **Action:**
  - Structured JSON journald logging with automatic secret redaction ([src/lib/incidents/redact.ts](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/incidents/redact.ts)).
  - Edge heartbeat ping (`POST /api/edge/heartbeat`).
  - Systemd watchdog integration (`sd_notify("WATCHDOG=1")`).
- **Deliverable:** Operational monitoring and stale display alert integration.

### Phase 5 (P5): Host Hardening & Production Documentation
- **Goal:** Finalize system security and publish operations manual.
- **Action:**
  - Deploy udev isolation rule (`99-macroedge-i2c.rules`).
  - Enforce systemd security directives (`ProtectSystem=strict`, `NoNewPrivileges=true`).
  - Document token rotation and host recovery runbooks.
- **Deliverable:** Production-ready appliance documentation and audit sign-off.

---

## 2. Five Critical Decisions Required from the User

Before proceeding to Phase 1 implementation, the user must provide explicit architectural decisions on the following five questions:

### Decision 1: Hardware Ownership & Physical Availability
> **Question:** Do you currently own a **Dasung Paperlike HD (2019)** monitor and have an operational **Linux host** physically connected to it via HDMI and USB?
> 
> *Context:* If the physical hardware is not yet present, Phase 1 and 2 can proceed in headless emulation (rendering bitmaps to PNG fixtures or virtual DRM displays), but Phase 0 requires real hardware.

### Decision 2: Display Content Scope
> **Question:** Does the proposed Task C Display Contract ([integration-audit/03_display_contract.md](file:///Users/ommroshan/Downloads/MacroEdge/integration-audit/03_display_contract.md))—Overall Bias, Macro Regime, Quality Status, Next Economic Release, Top 3 Supporting and Top 3 Conflicting Evidence lines—satisfy your operational research requirements, or should additional macro series (e.g. US 10Y Yield, DXY, VIX) be displayed on the panel?

### Decision 3: Terminal API Architecture Strategy
> **Question:** Should the edge agent consume the existing endpoint (`GET /api/ai-models`), or should we implement a dedicated, lightweight endpoint (`GET /api/edge/display`) on the Macro Edge server?
> 
> *Engineering Recommendation:* We strongly recommend adding a dedicated `GET /api/edge/display` endpoint. The existing `/api/ai-models` route returns a large payload (~35KB) with full scenario simulations and model diagnostics unnecessary for an edge display. A dedicated endpoint returns a lean (~1.5KB), pre-validated, scoped payload optimized for low-bandwidth edge polling.

### Decision 4: Host Location & Administrative Ownership
> **Question:** Where will the Linux edge host physically reside (e.g. desk workstation, remote office, server rack), and who administers it?
> 
> *Context:* Determines whether the host should be managed via local console or tailscale/VPN, and dictates the physical security tier for token storage.

### Decision 5: Driver Resolution (Image Rendering Strategy)
> **Question:** Given that `paperlike-go` controls hardware parameters over DDC/CI but **cannot draw images**, do you approve the proposed **Decoupled Two-Tier Architecture**?
> 
> *Architecture Choice:*
> - **Option A (Recommended):** Use Linux DRM/KMS or Linux Framebuffer (`/dev/fb0`) over standard HDMI to render pixels, while retaining a vendored, thread-safe copy of `pkg/dasung` exclusively to manage DDC commands (clear ghosting, set contrast, tune e-ink speed).
> - **Option B:** Drop the hardware / project if HDMI video framebuffer output is not desired.
