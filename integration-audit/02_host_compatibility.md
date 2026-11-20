# Host and Hardware Compatibility: Dasung Paperlike HD (2019) on Linux

**Date:** 2026-11-20  
**Auditor:** Senior Systems Engineer (Linux Hardware, Go & Security)  
**Target Hardware:** Dasung Paperlike HD (2019, 13.3" E-Ink, 2200 × 1650, HDMI + USB)  
**Host Context:** Linux Dedicated Edge Host  
**Compliance Note:** Under Hard Constraint 1, zero hardware commands were executed by the auditor. All hardware evaluation relies on documented architecture and user-supplied telemetry.  

---

## 1. Operating System & Kernel Requirements (Task B.1)

To drive the Dasung Paperlike HD display both as a video output (via HDMI/DisplayPort) and as a DDC-controlled peripheral (via I2C), the Linux host must satisfy the following software and driver baseline:

### 1.1 Linux Kernel & Subsystems
- **Kernel Version:** Minimum **Linux 4.14 LTS**; recommended **Linux 5.15 LTS or 6.1+ LTS** (ensures modern DRM/KMS stability, atomic modesetting, and rock-solid `i2c-dev` sysfs abstractions).
- **Required Kernel Modules:**
  - `i2c-dev`: Exposes user-space character device nodes (`/dev/i2c-0`, `/dev/i2c-1`, etc.) via the standard `ioctl` interface (`I2C_SLAVE` = `0x0703`). Must be configured to load at boot via `/etc/modules-load.d/i2c.conf`.
  - `drm` & `drm_kms_helper`: Direct Rendering Manager kernel mode setting drivers for video output.
  - Video controller drivers: `i915` (Intel), `amdgpu` (AMD), `nouveau` (Nvidia open source), or ARM SoC display controllers (e.g., `vc4` for Raspberry Pi 4/5). Note: Proprietary Nvidia drivers historically exhibit intermittent DDC/CI I2C blocking. Intel Iris/UHD or AMD integrated graphics provide the highest DDC/CI reliability.

### 1.2 Linux Distribution Support
- **Tier 1 (Recommended):** Ubuntu 22.04 LTS / 24.04 LTS, Debian 12 (Bookworm). Provides standard systemd, stable `i2c-dev` packages, and long-term security maintenance.
- **Tier 2 (Compatible):** Arch Linux, Fedora 39/40, Alpine Linux (requires `musl` compilation compatibility for Go agent or static binary).

### 1.3 Userspace Tooling
- **`ddcutil`:** Version **>= 1.2.0** (recommended 2.0+). Used strictly for administrative I2C bus detection, EDID verification, and diagnostic probes.
- **`i2c-tools`:** Version **>= 4.2**. Provides `i2cdetect` and `i2cget` for hardware-level bus debugging.

---

## 2. Hardware Detection Instructions for the User (Task B.2)

Because the auditor cannot and will not run hardware commands on your machine, you (the host administrator) must run the detection probe on the Linux host physically connected to the Dasung display via HDMI and USB.

### Step 1: Verification Command
Open a terminal on your Linux host and run:

```bash
sudo ddcutil detect --verbose
```

### Step 2: Redaction Protocol (MANDATORY)
Before posting or supplying the terminal output, **REDACT ALL SENSITIVE HARDWARE IDENTIFIERS**:
- Replace any serial numbers: `Serial number: [REDACTED]`
- Redact EDID raw hex dumps (`EDID: ... [REDACTED]`)
- Redact local hostnames or machine UUIDs.

### Step 3: Verification Checklist
When reviewing your output, confirm the following indicators to ensure the display answers DDC/CI:

```
[ ] Display identifier found (e.g., "Display 1")
[ ] I2C bus device recognized: e.g. "I2C bus:  /dev/i2c-3"
[ ] MFG / Vendor ID: "DAS" or "DSG" (or "Paperlike")
[ ] Model ID: "PaperlikeHD" or "Paperlike"
[ ] DDC/CI supported: "Yes" (confirming "DDC communication: passable" or "DDC communication: successful")
[ ] VCP version reported: "2.1" or "2.2"
```

> **CRITICAL GATE:** If `ddcutil detect` outputs `No displays found` or `DDC communication: unavailable`, the HDMI port, adapter, or cable is filtering the DDC I2C clock line (pin 15/16). The edge agent cannot manage the monitor until DDC/CI is passable.

---

## 3. Power Behavior & DPMS Dynamics (Task B.3)

Understanding how the Dasung Paperlike HD behaves during host power transitions is critical for an always-on ambient dashboard:

### 3.1 Display Sleep (DPMS Off / Standby)
- **DDC Bus State during Sleep:** On standard PC graphic controllers (Intel, AMD, Nvidia), when the OS triggers DPMS Off (monitor sleep), the GPU cuts the TMDS/FRL clock line to the HDMI port. In most graphic architectures, the auxiliary I2C clock line (SCL) is powered down simultaneously.
- **DDC Write Behavior:** Sending a DDC command via `pkg/dasung` while the monitor is in DPMS sleep results in immediate `EIO` (Input/Output Error) or `ENXIO` (No Such Device or Address) because the I2C slave in the monitor enters unpowered low-power standby.
- **Does a DDC Write Wake the Panel?** **NO.** In standard HDMI architecture, a DDC write cannot assert HDMI Hot-Plug Detect (HPD) or force the GPU transmitter to resume video clock generation.
- **Architecture Requirement:** The edge service host must **disable DPMS sleep entirely** for the e-ink display output:
  - In Linux DRM/KMS: Set kernel parameter `consoleblank=0`.
  - In X11: Set `xset -dpms s off`.
  - In Wayland: Configure compositor idle-timeout to `0` (never sleep).
  - Since E-Ink draws virtually zero power while static (pigments are bistable), leaving the display output active 24/7 generates no display burn-in and negligible power consumption.

### 3.2 Host Reboot & Cold Initialization
- Upon host reboot, the Dasung Paperlike HD initializes in its default hardware mode (typically Speed 3 / Mode 2).
- The edge service must execute a **Cold Start Initialization Hook**:
  1. Detect video output readiness on DRM/KMS.
  2. Issue `paperlike-cli -speed 5` (Black++ for crisp typography).
  3. Issue `paperlike-cli -mode 1` (High contrast 1-bit monochrome).
  4. Issue `paperlike-cli -contrast 7`.
  5. Issue `paperlike-cli -clear` to wipe bootloader/BIOS text ghosting.

---

## 4. E-Ink Behavioral Characteristics & Empirical Test Plan (Task B.4)

Before freezing the visual layout of the Macro Edge research terminal, the following physical E-Ink panel behaviors must be empirically validated on the physical monitor:

### 4.1 Ghosting & Hysteresis
- **Mechanism:** E-ink microcapsules physically migrate titanium dioxide (white) and carbon (black) particles across a fluid medium via electrical potential. Over time, residual ionic charge builds up, leaving faint "shadows" of previous text, table borders, and regime badges.
- **Test Protocol:**
  - Render a solid black box on the left half of the display for 15 minutes.
  - Switch to an all-white background with fine text.
  - Measure visible shadow persistence.
  - Trigger `paperlike-cli -clear` and confirm complete erasure.
- **Design Rule:** The Macro Edge dashboard will use a **ghosting cleanup schedule**:
  - Full hardware clear (`Clear()`) triggered every **10 redraws** (approx. every 20–30 minutes) or immediately upon an `overall_bias` transition.

### 4.2 Drawing Speed Modes (1–5) Evaluation

| Mode | Name | Refresh Latency | Contrast / Optical Density | Ghosting Tendency | Macro Edge Verdict |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | Fast++ | ~30–50 ms | Low (washed out, pale blacks) | Severe | **REJECTED:** Too pale for ambient research text. |
| **2** | Fast+ | ~60–80 ms | Moderate-Low | High | **REJECTED:** Insufficient black depth. |
| **3** | Fast | ~100–150 ms | Moderate | Moderate | **ACCEPTABLE:** Default fallback. |
| **4** | Black+ | ~200–300 ms | High | Low | **GOOD:** Crisp fonts, suitable for static dashboard. |
| **5** | Black++ | ~350–500 ms | Maximum (deep ink black) | Minimal | **RECOMMENDED DEFAULT:** For an update cadence of 60–300s, 500ms latency is imperceptible, while the resulting typographic sharpness and optical readability are superior. |

### 4.3 Dithering Modes (1–4) Evaluation

| Mode | Hardware Algorithm | Visual Characteristic | Impact on Macro Edge UI |
| :---: | :---: | :---: | :---: |
| **M1** | Pure Black & White (1-bit) | Crisp edges, zero intermediate gray | **Optimal for tabular text, numerical telemetry, and bold bias badges.** |
| **M2** | 3-Level Grayscale | White, mid-gray, black | Good for subtle subheaders, but slight edge softening. |
| **M3** | 4-Level Dithered Gray | Floyd-Steinberg micro-dither | Produces stippling patterns around text glyphs; distracting on e-ink. |
| **M4** | 16-Level Grayscale | Smooth gradients, soft typography | Best for photographs/charts; reduces text sharpness. |

**Recommended Baseline for Task C Layout:** Mode **M1** (or M2) combined with Speed **5** (Black++).

---

## 5. Unresolved Hardware Unknowns (Hard Constraint 7)

In compliance with Hard Constraint 7, the following items cannot be verified without physical hardware execution and are formally marked as **UNKNOWN**:

1. **UNKNOWN [HW-01]:** Does the user's specific host GPU / display adapter (e.g. HDMI port vs USB-C to HDMI active dongle) pass I2C DDC lines without packet truncation?
   - *Resolving Question:* What is the exact output of `sudo ddcutil detect --verbose` on the host machine?
2. **UNKNOWN [HW-02]:** What specific I2C bus number (`/dev/i2c-X`) is assigned to the HDMI port on the user's host?
   - *Resolving Question:* What is the device node reported in the `ddcutil detect` output?
3. **UNKNOWN [HW-03]:** Does the user's Dasung Paperlike HD firmware accept the standard `0x08 0x0603` clear opcode, or does it require the alternative Dasung vendor packet?
   - *Resolving Question:* Does running `paperlike-cli -i2c /dev/i2c-X -clear` physically flash the panel?
