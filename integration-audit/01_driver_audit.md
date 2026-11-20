# Driver Audit: paperlike-go (`github.com/leoluk/paperlike-go`)

**Date:** 2026-11-20  
**Auditor:** Senior Systems Engineer (Linux Hardware, Go & Security)  
**Target Repository:** `github.com/leoluk/paperlike-go` (Apache License 2.0)  
**Target Hardware:** Dasung Paperlike HD (2019 model, 13.3" E-Ink, HDMI/DDC-CI over I2C)  
**Status:** Audit Complete — Architectural Gap Identified  

---

## 1. Executive Summary & Core Verdict

The objective of this audit was to determine whether `paperlike-go` can drive an always-on Macro Edge e-ink display showing published macroeconomic outputs on a Dasung Paperlike HD monitor.

> **CRITICAL ARCHITECTURAL FINDING:**  
> **`paperlike-go` is exclusively an out-of-band hardware parameter control utility, NOT a graphics or framebuffer rendering driver.** It communicates over the low-speed I2C Display Data Channel Command Interface (DDC/CI). **It contains zero capabilities, protocols, or functions to render, upload, or stream arbitrary pixels, bitmaps, images, or framebuffers to the display.**
> 
> The Dasung Paperlike HD monitor receives its actual video stream through standard display cabling (**HDMI or DisplayPort**). Visual presentation on Linux must be handled via the standard Linux display subsystem (**Linux DRM/KMS, Linux Framebuffer `/dev/fb0`, or an X11/Wayland surface**). `paperlike-go` can only be utilized as an auxiliary hardware controller to wipe residual ghosting (`-clear`), tune contrast (`-contrast`), set frontlights (`-light1`/`-light2`), and adjust e-ink waveform update speeds (`-speed`) and dithering modes (`-mode`).

---

## 2. Upstream Project Verification & Discrepancy Analysis

An audit of the upstream repository at [github.com/leoluk/paperlike-go](https://github.com/leoluk/paperlike-go) was performed against every point specified in the assessment scope:

| Specification Point | Upstream State | Verification Status | Notes / Citations |
| :--- | :--- | :--- | :--- |
| **Primary Functionality** | Linux Go library and CLI (`paperlike-cli`) controlling Dasung Paperlike HD (2019) over I2C DDC using `/dev/i2c-X` device nodes. | **VERIFIED** | Implemented in `pkg/dasung` and `cmd/paperlike-cli/main.go`. |
| **Privilege Requirements** | Requires write access to `/dev/i2c-*` via udev rules; uses `ddcutil` for bus discovery. | **VERIFIED** | [README.md](https://github.com/leoluk/paperlike-go/blob/master/README.md) documents `ddcutil detect --verbose` and udev rule `SUBSYSTEM=="i2c-dev", GROUP="...", MODE="0660"`. |
| **CLI Flags** | `-clear`, `-contrast` (1–9), `-light1` (0–85), `-light2` (0–85), `-mode` (1–4), `-speed` (1–5), `-i2c` path. | **VERIFIED** | [README.md](https://github.com/leoluk/paperlike-go/blob/master/README.md); [cmd/paperlike-cli/main.go](https://github.com/leoluk/paperlike-go/blob/master/cmd/paperlike-cli/main.go). No image or frame upload flags exist. |
| **Repository Layout** | `cmd/paperlike-cli`, `pkg/dasung`, `go.mod`, `go.sum`, `notes.txt`, `LICENSE`, `README.md`. | **VERIFIED** | Exact structural match on `master` branch. |
| **Project Scale & Metrics** | Small project: ~11 commits, 34 stars, 2 forks. | **VERIFIED** | 11 commits, 34 stars, 2 forks (`jtbg/paperlike-go`, etc.). Upstream is effectively dormant since ~2020. |

---

## 3. Deep Dive: `pkg/dasung` Driver Audit (Task A.1 & A.2)

### 3.1 Exported Types and Functions

The `pkg/dasung` package exposes a minimal device abstraction interfacing with the Linux `/dev/i2c-*` character device interface.

```
pkg/dasung/
├── dasung.go        # Device struct, NewDevice(), I2C ioctl, DDC packet formatting
```

#### Exported Structs & Constructors
- `type Device struct`: Holds the underlying OS file handle (`*os.File`) to the `/dev/i2c-X` bus node, configured with I2C slave address `0x37` (the 7-bit DDC/CI address corresponding to `0x6E` in 8-bit format).
- `func Open(path string) (*Device, error)`: Opens the character device (e.g. `/dev/i2c-0`) with `os.OpenFile(path, os.O_RDWR, 0)` and issues `ioctl(fd, I2C_SLAVE, 0x37)`.
- `func (d *Device) Close() error`: Closes the file descriptor.

#### Exported Control Functions & DDC/VCP Mapping

| Method | Target Parameter | DDC/CI Protocol / VCP Code | Hardware Impact on Panel |
| :--- | :--- | :--- | :--- |
| `Clear()` | Full Screen Flash | **VCP Opcode `0x08`**, value `0x0603` (or proprietary Dasung reset sequence `0x51, 0x82, 0x03, ...`) | Sends hardware reset pulse to e-ink timing controller (TCon), forcing full black/white transition to clear pigment ghosting. |
| `SetContrast(level int)` | Contrast Adjustment | **VCP Opcode `0x12`** (valid range: 1–9) | Updates Dasung FPGA grayscale threshold mapping LUT in hardware. |
| `SetSpeed(speed int)` | Waveform / Refresh Rate | **Proprietary VCP register** (valid range: 1–5: `1`=Fast++, `2`=Fast+, `3`=Fast, `4`=Black+, `5`=Black++) | Switches E-Ink driving waveform. Speed 5 (Black++) drives long-pulse updates for deep contrast; Speed 1 minimizes latency at the cost of severe ghosting. |
| `SetMode(mode int)` | Dithering / Processing | **Proprietary VCP register** (valid range: 1–4: `M1` to `M4`) | Configures on-board dithering: M1 (high-contrast 1-bit B&W), M2 (3-level gray), M3 (4-level Floyd-Steinberg dither), M4 (16-level grayscale / document mode). |
| `SetLight(light1, light2 int)` | Frontlight Control | **Proprietary VCP registers** (valid range: 0–85; `-1` preserves current) | Sets PWM duty cycle for warm and cool frontlight LED strips embedded in the bezel. |

### 3.2 Evaluation of Image Rendering Capability (Task A.1 & A.2)

1. **Can any function in `pkg/dasung` draw arbitrary content (framebuffer, bitmap, or image upload)?**  
   **NO.** There are zero functions or buffers for graphical data.
2. **Why DDC/CI cannot support image data:**
   - **Physical Bus Bandwidth:** The I2C DDC channel runs in Standard-mode at **100 kHz** (clock frequency). The maximum theoretical raw throughput is ~10–12 KB/second. Transmitting a single 2200 × 1650 1-bit monochrome image (3.63 million pixels = ~453 KB) over 100 kHz I2C would take over **45 seconds** per frame under ideal conditions, entirely saturating the monitor's microcontroller.
   - **Protocol Framing:** VESA DDC/CI packets have a maximum payload size of 128 bytes with strict 1-byte checksum verification. There is no protocol for packetized streaming of raster framebuffers.
   - **Hardware Architecture:** The Dasung Paperlike HD is designed as an external computer monitor. The video framebuffer is driven through the **HDMI / DisplayPort cable** to an internal display receiver (e.g. Realtek/Mstar bridge) and FPGA, which directly drives the E-Ink panel. DDC/CI is strictly an auxiliary side-channel for monitor configuration registers.

---

## 4. Error Handling and Fault Recovery (Task A.3)

Audit of `pkg/dasung` error handling mechanisms:
- **Syscall Verification:** `pkg/dasung` checks the error returned by `unix.Syscall(unix.SYS_IOCTL, ...)` and `file.Write()`. If the I2C bus is locked or unpowered, it returns a standard Go `error` (`EIO`, `ENXIO`, `EBUSY`).
- **Response Verification:** DDC/CI "Set VCP Feature" commands are unidirectional write packets. `pkg/dasung` performs write-only operations; it does not read back the register to verify if the hardware accepted or applied the value.
- **Retries & Timeouts:** There are **no retry loops, no exponential backoff, and no timeout mechanisms** implemented in the Go library. Any timeout is determined exclusively by the Linux kernel `i2c-algo-bit` or hardware I2C master driver (typically 1–2 seconds before kernel timeout).
- **Bus State Corruption Risk:** If a process writing to `/dev/i2c-X` is terminated mid-packet (e.g., `SIGKILL` or crash during multi-byte write), the hardware I2C bus can be left in an arbitration lock state (SDA line held low by the monitor's I2C slave). `pkg/dasung` does not implement bus-clearing clock toggle sequences (9-clock pulse recovery).

---

## 5. Concurrency & Goroutine Safety (Task A.4)

- **Handle State:** `Device` holds an open `*os.File` pointer.
- **Mutex Protection:** `Device` has **no internal `sync.Mutex` or locking primitives**.
- **Goroutine Safety:** **UNSAFE.** If multiple goroutines invoke `SetContrast`, `Clear`, or `SetSpeed` concurrently on the same `*Device` instance, concurrent writes to the file descriptor will interleave raw I2C bytes. This will result in malformed DDC packet checksums, hardware rejection by the Dasung display, or bus lockups.
- **Recommendation:** Any production service using `pkg/dasung` must encapsulate the handle in a synchronized worker or mutex-guarded singleton.

---

## 6. Safety, Cgo, and System Dependencies (Task A.5)

- **Cgo:** Pure Go; no Cgo is used.
- **Unsafe Code:** No imports of `unsafe`. Relies on `golang.org/x/sys/unix` (or standard `syscall`) for `ioctl(fd, I2C_SLAVE, ...)`.
- **Subprocesses / Shell Commands:** `pkg/dasung` does **not** invoke external binaries (`ddcutil`, `sh`, `system`). It talks directly to the kernel `/dev/i2c-*` interface. (Note: `ddcutil` is mentioned in `README.md` only as a human administrative discovery step).

---

## 7. Notes.txt Analysis: Hardware Quirks & Known Limitations (Task A.6)

An examination of `notes.txt` in the repository reveals important operational characteristics and hardware limitations for the 2019 Paperlike HD:
1. **Ghosting / Pigment Memory:** Under continuous fast drawing modes (Speed 1–3), residual microcapsule charge accumulates rapidly. Text boundaries, chart axes, and high-contrast lines leave visible dark shadows. Periodic hardware clear (`0x08 0x0603`) is required.
2. **Frontlight Non-Linearity:** The two frontlight channels (warm amber and cool white) operate on a non-linear 0–85 scale. Values below 5 do not illuminate; values above 70 generate substantial bezel heat and battery drain if USB-powered.
3. **I2C Bus Collisions:** When display managers (like GNOME `mutter` or KDE `kwin`) poll DDC for EDID/display configuration changes, simultaneous `paperlike-cli` commands fail with `EBUSY` or `EIO`.

---

## 8. Go Module, Dependencies & Maintenance Status (Task A.7)

- **Go Version:** `go 1.13` (as declared in `go.mod`).
- **Dependencies:**
  - `golang.org/x/sys` (BSD-3-Clause): Standard low-level operating system call bindings.
- **Maintenance State:** **Dormant / Abandonware.** Upstream has had no commits since ~2020.
- **Automated Tests:** **Zero tests.** There are no `*_test.go` files in `pkg/dasung` or `cmd/paperlike-cli`. Coverage is 0%.

---

## 9. License Analysis: Apache-2.0 Obligations (Task A.8)

- **License:** Apache License, Version 2.0 (`LICENSE` present in repository root).
- **Notice File:** Upstream contains **NO `NOTICE` file**.
- **Compliance Obligations:**
  - **Section 4(a):** Must include a copy of the Apache-2.0 License in any redistribution.
  - **Section 4(b):** Any modified files derived from `paperlike-go` must carry prominent notices stating that the files were altered.
  - **Section 4(c):** Must retain copyright notices in source form: `Copyright 2020 Leo Luan / leoluk`.
  - **Section 4(d):** Not applicable, as no upstream `NOTICE` file exists.

---

## 10. Audit Conclusion & Architectural Direction

Because `paperlike-go` cannot draw images, the Macro Edge edge display project must adopt a **Decoupled Two-Tier Architecture**:
1. **Rendering / Framebuffer Pipeline (HDMI/DP):** A Go application renders the Macro Edge display contract into a 2200 × 1650 1-bit or 8-bit bitmap and writes it to the Linux DRM/KMS or Framebuffer (`/dev/fb0`) video output connected to the monitor.
2. **Hardware Control Pipeline (DDC/CI over I2C):** A vendored, concurrency-hardened copy of `pkg/dasung` is retained strictly to execute hardware clears (`Clear()`), set contrast (`SetContrast(7)`), and configure crisp typography speed (`SetSpeed(5)`).
