# Edge Agent Architecture: Macro Edge Linux Display Service

**Date:** 2026-11-20  
**Auditor:** Senior Systems Engineer (Linux Hardware, Go & Security)  
**Target Platform:** Linux Dedicated Host (Debian/Ubuntu/Fedora) driving Dasung Paperlike HD  
**Language & Runtime:** Go 1.22+ (Static ELF binary, zero external runtime dependencies)  
**Process Manager:** `systemd` (User/System Service Unit)  
**Security References:**
- [src/lib/incidents/redact.ts#L10-L50](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/incidents/redact.ts#L10-L50) (Secret Redaction & Token Protection)
- [.env.example#L20-L32](file:///Users/ommroshan/Downloads/MacroEdge/.env.example#L20-L32) (Service-Role Key Separation)

---

## 1. System Overview: The Decoupled Two-Tier Architecture

Because Task A confirmed that `paperlike-go` cannot stream image data over I2C DDC, the Macro Edge Edge Agent (`macroedge-displayd`) implements a **Decoupled Two-Tier Display Architecture**:

```
+-----------------------------------------------------------------------------------------+
|                                    LINUX EDGE HOST                                      |
|                                                                                         |
|   +---------------------------------------------------------------------------------+   |
|   |                  macroedge-displayd (Single Go Systemd Daemon)                  |   |
|   |                                                                                 |   |
|   |  1. Polling Engine       -->  Outbound HTTPS (Bearer Token)                     |   |
|   |  2. JSON Validator       -->  Validates Task C Schema                           |   |
|   |  3. Content Hasher       -->  SHA-256 Digest of canonical payload               |   |
|   |  4. Layout Renderer      -->  Draws 2200x1650 1-bit bitmap in memory            |   |
|   |  5. DDC State Machine    -->  Coordinates ghosting cleanup & contrast           |   |
|   +--------------------------+------------------------------------------------------+   |
|                              |                                       |                  |
|                 [Tier 1: Video Framebuffer]               [Tier 2: DDC Hardware I2C]    |
|                              |                                       |                  |
|                              v                                       v                  |
|                    /dev/dri/card0 (DRM/KMS)                    /dev/i2c-X               |
|                    (or Linux /dev/fb0)                   (pkg/dasung controller)        |
|                              |                                       |                  |
+------------------------------|---------------------------------------|------------------+
                               |                                       |
                     [HDMI Video Stream]                     [DDC/CI I2C Commands]
                     (Rasterized Pixels)                     (Clear / Speed / Mode)
                               |                                       |
                               +-------------------+-------------------+
                                                   |
                                                   v
                                  +---------------------------------+
                                  |     Dasung Paperlike HD E-Ink   |
                                  |     (13.3" 2200x1650 Display)   |
                                  +---------------------------------+
```

---

## 2. Daemon Lifecycle & Polling Loop (Task D.1 & D.2)

1. **Configurable Cadence:**
   - Default polling interval: **120 seconds**.
   - Allowed range: **60 seconds to 300 seconds** (configurable via `/etc/macroedge/display.env`).
2. **Content Hash Gating (Ghosting & Panel Wear Reduction):**
   - After fetching and validating the payload from the terminal, the daemon computes a SHA-256 hash over the normalized payload fields.
   - If `currentHash == previousHash`, the daemon **skips the video redraw**. This prevents unnecessary e-ink particle agitation, eliminates visual flicker, and protects the physical panel from microcapsule wear.
3. **Ghosting Invalidation & Hardware Clear Cadence:**
   - E-ink displays accumulate residual charge even with static content.
   - The daemon maintains a refresh counter:
     - Every **10 redraws** (approx. 20–30 minutes) or immediately upon an `overall_bias` transition (e.g. `BULLISH` -> `BEARISH`), the daemon invokes `pkg/dasung.Clear()`.
     - The clear pulse drives a full black-white transition to restore baseline panel reflectance.
4. **Resilient Backoff:**
   - Network failure or HTTP 5xx triggers an exponential backoff sequence: `10s -> 20s -> 40s -> 80s -> 160s -> 300s (max)`.

---

## 3. Authentication & Credential Isolation (Task D.3)

1. **Scoped Read-Only Token:**
   - The edge agent authenticates using an HTTP Authorization header: `Authorization: Bearer <MACROEDGE_DISPLAY_TOKEN>`.
   - The token is a scoped, read-only token issued by the Macro Edge terminal server. It grants access **strictly** to the public/published macro intelligence route (`GET /api/ai-models` or dedicated `GET /api/edge/display`).
2. **Local Storage:**
   - Stored in a dedicated secrets file with strict POSIX permissions:
     - Path: `/etc/macroedge/display-token`
     - Owner: `macroedge-display:macroedge-display`
     - Permissions: **`0600`** (`-rw-------`).
   - Alternatively loaded via modern systemd credentials: `LoadCredential=display-token:/etc/macroedge/display-token`.
3. **Hard Security Invariants:**
   - **NEVER** pass the token in URL query parameters (which appear in web server access logs and telemetry).
   - **NEVER** output the token in stdout, journald logs, or error stack traces.
   - **STRICT PROHIBITION:** The `SUPABASE_SERVICE_ROLE_KEY` has administrative database bypass privileges ([src/lib/incidents/redact.ts#L14](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/incidents/redact.ts#L14)). Under zero circumstances may the service-role key be placed on, configured on, or transmitted to the edge host.

---

## 4. Network Topology & Traffic Invariants (Task D.4)

- **Outbound Only:** The daemon establishes outbound HTTPS connections over **TCP port 443** directly to the Macro Edge terminal endpoint.
- **Zero Inbound Ports:** The edge host runs **no listening sockets** (no inbound HTTP server, no webhooks, no exposed RPC ports).
- **DNS & TLS:** Standard system resolver; enforces TLS 1.3 with strict certificate validation against system CA root store.

---

## 5. Failure State Matrix & Display Fallback Behavior (Task D.5)

A stale frame must never masquerade as live data. The table below defines the exact display behavior and logging policy for every failure mode:

| Failure Mode | Root Cause Detection | On-Screen E-Ink Presentation | Journald Log Entry (`json`) | Recovery Action |
| :--- | :--- | :--- | :--- | :--- |
| **1. API Unreachable** | HTTP connection timeout, DNS lookup failure, or 502/503 response. | Retain last valid frame, but render an **inverted black banner** across top: `[!] CONNECTION LOST -- RETAINING FRAME FROM HH:MM UTC`. If offline > 60m, stamp heavy diagonal `[STALE DATA - OFFLINE]` watermark. | `{"level":"warn","event":"api_unreachable","error":"dial tcp: i/o timeout","retry_in_sec":20}` | Exponential backoff retry (up to 300s); clear warning immediately upon reconnect. |
| **2. Schema Invalid** | 200 OK returned, but payload fails JSON schema validation (e.g. missing required field). | Display an unambiguous diagnostics box: `[ERROR: TELEMETRY SCHEMA MISMATCH -- DEPLOYMENT VERSION MISMATCH]`. Do NOT render malformed numbers. | `{"level":"error","event":"schema_invalid","error":"missing required key: prediction_cutoff"}` | Retain previous frame with alert box; ping terminal diagnostics. |
| **3. DDC Write Failure** | I2C ioctl returns `EIO`, `ENXIO`, or write timeout. | Visual content updates normally via HDMI framebuffer. A small 14pt warning icon `[DDC ERR]` appears in the header (alerting that ghosting clearance is impaired). | `{"level":"error","event":"ddc_write_failed","bus":"/dev/i2c-3","error":"input/output error"}` | Reopen `/dev/i2c-X` handle; log incident; continue HDMI updates. |
| **4. I2C Bus Busy** | Bus arbitration lost or device locked by desktop compositor (`EBUSY`). | Defer DDC parameter update to next polling cycle. | `{"level":"warn","event":"i2c_bus_busy","bus":"/dev/i2c-3"}` | Retry DDC command after 5-second jitter delay. |
| **5. Display Asleep** | DRM/KMS reports connector disconnected or DPMS off. | Daemon attempts DRM wake ioctl. If unpowered, pause DDC loop. | `{"level":"warn","event":"display_dpms_suspended","connector":"HDMI-A-1"}` | Re-assert KMS active state (`consoleblank=0`). |
| **6. Host Reboot** | Cold start after system power loss. | If network unavailable, display clean boot splash: `[MACROEDGE TERMINAL -- INITIALIZING AMBIENT DISPLAY...]`. | `{"level":"info","event":"daemon_cold_start","uptime_sec":12}` | Await network readiness, fetch initial snapshot, execute hardware `Clear()`. |

---

## 6. Observability & Systemd Service Specification (Task D.6)

### 6.1 Structured JSON Logging
All log lines are emitted to stdout as single-line JSON, natively ingested by `systemd-journald`:

```json
{"timestamp":"2026-11-20T22:50:00Z","level":"info","event":"frame_rendered","bias":"BULLISH","hash":"a7f89c02","render_ms":42,"ddc_action":"none"}
```

Secrets, tokens, and raw headers are strictly redacted before emission.

### 6.2 Heartbeat Reporting
Every successful poll cycle, the daemon transmits an asynchronous, non-blocking telemetry ping back to the terminal:
- **Endpoint:** `POST /api/edge/heartbeat`
- **Payload:** `{ "device_id": "eink-dasung-01", "current_hash": "a7f89c02", "uptime_seconds": 86400, "last_refresh_utc": "2026-11-20T22:50:00Z" }`
- **Server-Side Watchdog:** If the Macro Edge terminal receives no heartbeat for > 15 minutes, an operational incident is triggered via `src/services/incidents/store.ts`.

### 6.3 Systemd Service Unit: `/etc/systemd/system/macroedge-display.service`

```ini
[Unit]
Description=MacroEdge Dasung E-Ink Display Service
After=network-online.target graphical.target
Wants=network-online.target
Documentation=https://github.com/MacroEdge/MacroEdge

[Service]
Type=simple
User=macroedge-display
Group=macroedge-display
SupplementaryGroups=i2c video render

EnvironmentFile=/etc/macroedge/display.env
ExecStart=/usr/local/bin/macroedge-displayd --config /etc/macroedge/config.yaml

# Hardening Directives
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
NoNewPrivileges=true
PrivateTmp=true
RestrictRealtime=true
MemoryDenyWriteExecute=true
DeviceAllow=/dev/i2c-* rw
DeviceAllow=/dev/dri/* rw
DeviceAllow=/dev/fb0 rw

# Reliability & Watchdog
Restart=always
RestartSec=10s
WatchdogSec=360s

[Install]
WantedBy=multi-user.target
```
