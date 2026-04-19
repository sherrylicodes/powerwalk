// js/ble.js
//
// Bridges the ESP32-C3 BLE stream to the PowerWalk heatmap frame format.
//
// Arduino sends (50 Hz, newline-terminated CSV):
//   ts_ms, fsr0, fsr1, fsr2, fsr3, ax, ay, az, gx, gy, gz
//
// This file:
//   1. Fixes UUIDs to match the Arduino firmware exactly
//   2. Parses the CSV (replaces the old JSON.parse)
//   3. Normalises raw ADS1115 counts → 0-100
//   4. Scales raw IMU counts → g / deg/s
//   5. Maps 4 FSR sensors to the 10-zone foot frame main.js expects
//   6. Computes a simple Centre-of-Pressure (COP) for the data.js pipeline

// ── UUIDs — must match Arduino firmware exactly ───────────────
const SERVICE_UUID        = "12345678-1234-1234-1234-123456789abc";
const CHARACTERISTIC_UUID = "abcdefab-cdef-cdef-cdef-abcdefabcdef";

// ── ADS1115 normalisation ─────────────────────────────────────
// PGA = GAIN_ONE → ±4.096 V full-scale → 32 767 counts max.
// With a 3.3 V supply + 330 Ω pulldown the FSR voltage tops out at
// ~3.3 V → ~26 400 counts.  Adjust ADS_MAX_COUNTS if your FSR
// saturates sooner or you change the PGA setting.
const ADS_MAX_COUNTS = 26400;

function normFSR(raw) {
  return Math.min(100, Math.max(0, Math.round((raw / ADS_MAX_COUNTS) * 100)));
}

// ── IMU scale factors (must match Arduino CTRL register values) ─
// CTRL1_XL = 0x60  →  FS = ±2 g      →  16 384 LSB/g
// CTRL2_G  = 0x60  →  FS = ±250 deg/s  →    131 LSB/(deg/s)
const ACCEL_SCALE = 1 / 16384;   // raw → g
const GYRO_SCALE  = 1 / 131;     // raw → deg/s

// ── FSR → 10-zone heatmap mapping ─────────────────────────────
//
//  ADJUST THESE to match where your sensors are physically placed.
//
//  Current assumption (single LEFT shoe, 4 sensors):
//
//       fsr3  ──→  L_BIG_TOE (60%) + L_TOES (40%)
//       fsr2  ──→  L_BALL
//       fsr1  ──→  L_ARCH
//       fsr0  ──→  L_HEEL
//
//  Right-shoe zones are filled with a 50% mirror because there is
//  only one insole.  Replace with real right-shoe BLE data if you
//  add a second device.
//
function mapFSRtoZones(rawFSR) {
  const n0 = normFSR(rawFSR[0]);
  const n1 = normFSR(rawFSR[1]);
  const n2 = normFSR(rawFSR[2]);
  const n3 = normFSR(rawFSR[3]);

  return {
    // Left (connected) shoe
    L_HEEL:    n0,
    L_ARCH:    n1,
    L_BALL:    n2,
    L_BIG_TOE: Math.round(n3 * 0.6),
    L_TOES:    Math.round(n3 * 0.4),

    // Right (unconnected) shoe — mirrored placeholder
    R_HEEL:    Math.round(n0 * 0.5),
    R_ARCH:    Math.round(n1 * 0.5),
    R_BALL:    Math.round(n2 * 0.5),
    R_BIG_TOE: Math.round(n3 * 0.3),
    R_TOES:    Math.round(n3 * 0.2),
  };
}

// ── Simple Centre-of-Pressure from 4 sensors ──────────────────
// Returns {x, y} in [-1, 1] for use with data.js / ui.js.
// Sensor layout (top = toes, bottom = heel):
//   fsr3 = toes   (y = +1.0)
//   fsr2 = ball   (y = +0.4)
//   fsr1 = arch   (y = -0.3)
//   fsr0 = heel   (y = -1.0)
function computeCOP(rawFSR) {
  const h = normFSR(rawFSR[0]);
  const a = normFSR(rawFSR[1]);
  const b = normFSR(rawFSR[2]);
  const t = normFSR(rawFSR[3]);
  const total = h + a + b + t || 1;

  // negative y = towards heel, positive y = towards toes
  const y = (h * -1.0 + a * -0.3 + b * 0.4 + t * 1.0) / total;

  return { x: 0, y: +y.toFixed(3) };
}

// ── BLE state ──────────────────────────────────────────────────
let bleDevice         = null;
let bleCharacteristic = null;
let _lineBuffer       = "";   // accumulates partial packets between BLE chunks

// ── Public API ─────────────────────────────────────────────────
export async function connectToShoeBLE({ onConnected, onDisconnected, onData, onError }) {
  try {
    if (!navigator.bluetooth) {
      throw new Error(
        "Web Bluetooth is not supported here.\n" +
        "Use Chrome or Edge on desktop / Android.\n" +
        "The page must be served over HTTPS or localhost."
      );
    }

    // Opens browser device picker — user selects "XIAO_FSR_IMU"
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });

    bleDevice.addEventListener("gattserverdisconnected", () => {
      console.log("[BLE] GATT server disconnected");
      _lineBuffer = "";
      onDisconnected?.();
    });

    const server      = await bleDevice.gatt.connect();
    const service     = await server.getPrimaryService(SERVICE_UUID);
    bleCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await bleCharacteristic.startNotifications();
    console.log("[BLE] Notifications started on", bleDevice.name);

    bleCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
      try {
        // Decode bytes and append to line buffer.
        // One BLE notification may carry a partial line, a full line,
        // or multiple lines — the buffer handles all cases correctly.
        _lineBuffer += new TextDecoder("utf-8").decode(event.target.value);

        const lines = _lineBuffer.split("\n");
        _lineBuffer  = lines.pop(); // keep incomplete trailing fragment

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parts = trimmed.split(",");

          if (parts.length !== 11) {
            console.warn("[BLE] Bad packet length (" + parts.length + "):", trimmed);
            continue;
          }

          const nums = parts.map(Number);
          if (nums.some(isNaN)) {
            console.warn("[BLE] NaN in packet:", trimmed);
            continue;
          }

          const ts     = nums[0];
          const f0     = nums[1];
          const f1     = nums[2];
          const f2     = nums[3];
          const f3     = nums[4];
          const ax_raw = nums[5];
          const ay_raw = nums[6];
          const az_raw = nums[7];
          const gx_raw = nums[8];
          const gy_raw = nums[9];
          const gz_raw = nums[10];

          // Build the 10-zone named frame that heatmap + insights expect
          const frame = mapFSRtoZones([f0, f1, f2, f3]);

          // Scaled IMU (g and deg/s) — attached as _imu for data.js/imu.js
          frame._imu = {
            ax: +(ax_raw * ACCEL_SCALE).toFixed(4),
            ay: +(ay_raw * ACCEL_SCALE).toFixed(4),
            az: +(az_raw * ACCEL_SCALE).toFixed(4),
            gx: +(gx_raw * GYRO_SCALE).toFixed(2),
            gy: +(gy_raw * GYRO_SCALE).toFixed(2),
            gz: +(gz_raw * GYRO_SCALE).toFixed(2),
          };

          // Centre-of-Pressure in [-1, 1]
          frame._cop = computeCOP([f0, f1, f2, f3]);

          // Raw counts — useful for calibration / debugging
          frame._raw = {
            ts,
            fsr: [f0, f1, f2, f3],
            ax: ax_raw, ay: ay_raw, az: az_raw,
            gx: gx_raw, gy: gy_raw, gz: gz_raw,
          };

          onData?.(frame);
        }
      } catch (err) {
        onError?.(err);
      }
    });

    onConnected?.(bleDevice);
    return bleDevice;

  } catch (err) {
    onError?.(err);
    throw err;
  }
}

export async function disconnectFromShoeBLE() {
  try {
    if (bleDevice?.gatt?.connected) {
      bleDevice.gatt.disconnect();
    }
    _lineBuffer = "";
  } catch (err) {
    console.error("[BLE] Disconnect failed:", err);
  }
}
