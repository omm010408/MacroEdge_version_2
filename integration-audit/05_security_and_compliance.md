# Security, Hardening & Compliance: Macro Edge Edge Display

**Date:** 2026-11-20  
**Auditor:** Senior Systems Engineer (Linux Hardware, Go & Security)  
**Classification:** Institutional Security & Compliance Audit  
**Target Scope:** Linux Edge Host, Dasung Paperlike HD Physical Display & Peripheral Pipeline  
**Source Code References:**
- [src/lib/incidents/redact.ts#L10-L50](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/incidents/redact.ts#L10-L50) (Telemetry Secret Redaction Engine)
- [src/lib/ai-models/types.ts#L223-L253](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/ai-models/types.ts#L223-L253) (Display Contract Model Constraints)

---

## 1. Host Hardening & Principle of Least Privilege (Task E)

An always-on hardware appliance physically residing in an office, workstation desk, or operations center presents a physical attack surface. The host operating system must be locked down to ensure that even a physical or network compromise of the edge agent cannot escalate privileges.

### 1.1 Dedicated Unprivileged Service Account
- The agent must never run as `root`.
- A dedicated, unprivileged system account must be created:
  ```bash
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin macroedge-display
  ```
- **Group Isolation:**
  - `i2c`: Grants read/write access to `/dev/i2c-X` character devices.
  - `video` and/or `render`: Grants access to `/dev/dri/cardX` and `/dev/fb0` for DRM/KMS framebuffer operations.
  - The `macroedge-display` user is barred from `sudo`, `wheel`, `adm`, or general administrative groups.

### 1.2 Udev Device Node Permission Hardening
Standard Linux distributions restrict `/dev/i2c-*` to `root:root` with mode `0600`. To grant access strictly to the dedicated service without broad world permissions, configure `/etc/udev/rules.d/99-macroedge-i2c.rules`:

```udev
# Restrict I2C bus write permissions exclusively to the i2c group
SUBSYSTEM=="i2c-dev", KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"

# Restrict DRM framebuffer access to video/render groups
SUBSYSTEM=="drm", KERNEL=="card[0-9]*", GROUP="video", MODE="0660"
```

After deploying the rule, reload udev:
```bash
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### 1.3 Systemd Sandboxing & Attack Surface Reduction
The systemd service unit (`macroedge-display.service`) enforces modern Linux kernel namespace isolation:
- `ProtectSystem=strict`: The entire host filesystem (`/usr`, `/boot`, `/etc`) is mounted read-only to the process.
- `ProtectHome=true`: The user directories (`/home`, `/root`) are completely invisible and unreadable.
- `NoNewPrivileges=true`: Disallows `setuid`/`setgid` privilege escalation.
- `CapabilityBoundingSet=`: Drops all POSIX capabilities (zero `CAP_SYS_ADMIN`, zero `CAP_NET_ADMIN`, zero `CAP_RAW_IO`).
- `PrivateTmp=true`: Disconnects `/tmp` from host temporary files.
- `MemoryDenyWriteExecute=true`: Enforces W^X memory protection, mitigating buffer overflow code injection.

---

## 2. Token Security, Rotation & Revocation Protocol (Task E)

### 2.1 Credential Topology & Redaction Verification
- The edge display daemon requires **strictly one scoped, read-only token**: `MACROEDGE_DISPLAY_TOKEN`.
- **Database Credential Exclusion:** Under the Macro Edge security contract ([src/lib/incidents/redact.ts#L10-L26](file:///Users/ommroshan/Downloads/MacroEdge/src/lib/incidents/redact.ts#L10-L26)), the `SUPABASE_SERVICE_ROLE_KEY` bypasses all Row Level Security (RLS) policies. **This key must NEVER be provisioned onto edge hardware.**
- **Secret Redaction:** Any telemetry emitted by the daemon must run through the pattern matching specified in `src/lib/incidents/redact.ts` so that no authorization headers, bearer tokens, or query strings can leak into logs.

### 2.2 Token Storage Standard
The token must be stored on the edge host in a mode `0600` file:
```bash
sudo mkdir -p /etc/macroedge
sudo touch /etc/macroedge/display-token
sudo chown macroedge-display:macroedge-display /etc/macroedge/display-token
sudo chmod 0600 /etc/macroedge/display-token
```
*Verification:*
```bash
ls -la /etc/macroedge/display-token
# Expected: -rw------- 1 macroedge-display macroedge-display 64 Nov 20 22:00 /etc/macroedge/display-token
```

### 2.3 Token Rotation & Revocation Workflow
1. **Scheduled Rotation:** Tokens expire every 90 days. The server issues a renewed token via administrative terminal CLI.
2. **Instant Revocation:** If an edge host is lost, stolen, or decommissioned:
   - The token ID is placed on the server-side revocation list in the Macro Edge terminal (`revoked_tokens` table).
   - Upon next poll, the edge host receives `401 Unauthorized`.
   - The daemon immediately enters **Failure State 1**, purges the active display contract from memory, and displays:
     ```
     [!] ACCESS REVOKED -- AUTHENTICATION INVALIDATED
     Contact Terminal Administrator to re-provision host.
     ```

---

## 3. Physical Exposure Risk Assessment (Task E)

Because the Dasung Paperlike HD is a large, highly visible 13.3" ambient screen that may sit on a desk or office wall, an audit of all fields in the Display Contract (Task C) was conducted to verify that zero private, institutional, or account-identifying data can be exposed:

| Data Category | Risk Level | Contract State | Audit Verification |
| :--- | :---: | :---: | :--- |
| **Account Identifiers / User Names** | High | **EXCLUDED** | Zero user names, email addresses, or terminal user IDs exist in payload. |
| **Portfolio Balances / Equity Values** | High | **EXCLUDED** | Zero dollar values of user capital, account net worth, or cash balances. |
| **Open Positions / Trade Orders** | Critical | **EXCLUDED** | Zero order IDs, fill prices, lot sizes, or execution tickets. |
| **Private Keys / API Credentials** | Critical | **EXCLUDED** | Zero keys, secrets, or JWT fragments. |
| **Macroeconomic Biases & Data** | None | **INCLUDED** | Publicly synthesized aggregate indicators (GDP, CPI, VIX, EFFR, Gold). |

**Conclusion:** The physical exposure risk is **negligible**. The screen displays macroeconomic intelligence equivalent to a financial news television or public research bulletin.

---

## 4. Regulatory & Compliance Disclaimers (Task E)

To satisfy institutional compliance requirements (including FINRA Rule 2210 / SEC Investment Advisers Act communications guidelines):
1. **Mandatory Visual Disclaimer:** Every rendered frame must include a permanent, high-contrast footer disclaimer:
   ```
   DISCLAIMER: INSTITUTIONAL RESEARCH SURFACE ONLY. NOT FINANCIAL OR INVESTMENT ADVICE. 
   ALL OUTPUTS DERIVED FROM POINT-IN-TIME PUBLIC STATISTICAL OBSERVATIONS. DATA MAY BE DELAYED.
   ```
2. **Age Integrity:** If upstream data feeds are delayed or the network drops, the data age and cutoff timestamp (`prediction_cutoff`) prominently signal that the analysis is historical, preventing any misinterpretation of stale signals.
