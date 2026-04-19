// js/main.js

import { createHeatmap }      from "./heatmap.js";
import { connectToShoeBLE, disconnectFromShoeBLE } from "./ble.js";

const connectBtn      = document.getElementById("connect-btn");
const connectionPill  = document.getElementById("steps-pill");

const balanceValue    = document.getElementById("balance-value");
const balanceSubtext  = document.getElementById("balance-subtext");
const peakZoneValue   = document.getElementById("peak-zone-value");
const peakZoneSubtext = document.getElementById("peak-zone-subtext");
const stabilityValue  = document.getElementById("stability-value");
const stabilitySubtext= document.getElementById("stability-subtext");

let heatmap   = null;
let demoTimer = null;
let isLive    = false;   // true once BLE is connected

// ── Sensor label map for the 10 foot zones ────────────────────
const SENSOR_LABELS = {
  L_BIG_TOE: "Left big toe",
  L_TOES:    "Left toes",
  L_BALL:    "Left ball of foot",
  L_ARCH:    "Left arch",
  L_HEEL:    "Left heel",
  R_BIG_TOE: "Right big toe",
  R_TOES:    "Right toes",
  R_BALL:    "Right ball of foot",
  R_ARCH:    "Right arch",
  R_HEEL:    "Right heel",
};

// ── Connection state UI ───────────────────────────────────────
function setConnectionState(mode) {
  if (mode === "connected") {
    connectionPill.textContent = "Connected";
    connectionPill.classList.add("connected");
    connectionPill.classList.remove("disconnected");
    connectBtn.textContent = "Disconnect";
  } else if (mode === "connecting") {
    connectionPill.textContent = "Connecting…";
    connectionPill.classList.remove("connected");
    connectionPill.classList.add("disconnected");
    connectBtn.textContent = "Connecting…";
  } else {
    connectionPill.textContent = "Demo Mode";
    connectionPill.classList.remove("connected");
    connectionPill.classList.add("disconnected");
    connectBtn.textContent = "Connect Shoe";
  }
}

// ── Insights computation (works on the 10-zone frame) ─────────
function computeInsights(frame) {
  const leftTotal =
    (frame.L_BIG_TOE || 0) + (frame.L_TOES || 0) +
    (frame.L_BALL    || 0) + (frame.L_ARCH  || 0) + (frame.L_HEEL || 0);

  const rightTotal =
    (frame.R_BIG_TOE || 0) + (frame.R_TOES || 0) +
    (frame.R_BALL    || 0) + (frame.R_ARCH  || 0) + (frame.R_HEEL || 0);

  const total   = leftTotal + rightTotal || 1;
  const leftPct = Math.round((leftTotal / total) * 100);
  const rightPct= 100 - leftPct;

  // Zone with highest pressure
  const entries = Object.entries(frame)
    .filter(([k]) => !k.startsWith("_"))   // skip _raw, _imu, _cop metadata
    .sort((a, b) => b[1] - a[1]);
  const [peakId, peakValue] = entries[0] || ["L_HEEL", 0];

  // Stability from COP or raw left/right balance
  let stability     = "Stable";
  let stabilityHint = "Pressure distribution is centred.";

  if (leftPct >= 60) {
    stability     = "Leaning Left";
    stabilityHint = "More weight loading onto the left foot.";
  } else if (rightPct >= 60) {
    stability     = "Leaning Right";
    stabilityHint = "More weight loading onto the right foot.";
  } else if ((frame.L_HEEL || 0) + (frame.R_HEEL || 0) >
             (frame.L_BALL || 0) + (frame.R_BALL || 0) + 40) {
    stability     = "Leaning Back";
    stabilityHint = "Heel pressure is dominant.";
  } else if ((frame.L_BALL || 0) + (frame.R_BALL || 0) >
             (frame.L_HEEL || 0) + (frame.R_HEEL || 0) + 40) {
    stability     = "Leaning Forward";
    stabilityHint = "Forefoot pressure is dominant.";
  }

  // If we have IMU from BLE, add tilt info to hint
  if (frame._imu) {
    const { ax, ay, az } = frame._imu;
    const tiltDeg = +(Math.atan2(ay, az) * 180 / Math.PI).toFixed(1);
    const pitchDeg= +(Math.atan2(ax, az) * 180 / Math.PI).toFixed(1);
    stabilityHint += `  IMU tilt ${tiltDeg}° / pitch ${pitchDeg}°.`;
  }

  return { leftPct, rightPct, peakZone: SENSOR_LABELS[peakId] || peakId, peakValue, stability, stabilityHint };
}

function renderInsights(frame) {
  const ins = computeInsights(frame);

  balanceValue.textContent   = `${ins.leftPct}% / ${ins.rightPct}%`;
  balanceSubtext.textContent = Math.abs(ins.leftPct - ins.rightPct) <= 8
    ? "Balanced stance"
    : ins.leftPct > ins.rightPct
      ? "More load on the left side"
      : "More load on the right side";

  peakZoneValue.textContent   = ins.peakZone;
  peakZoneSubtext.textContent = `Peak intensity: ${Math.round(ins.peakValue)}`;

  stabilityValue.textContent   = ins.stability;
  stabilitySubtext.textContent = ins.stabilityHint;
}

// ── Incoming frame handler (BLE + demo share this) ────────────
function handleIncomingFrame(frame) {
  if (!heatmap) return;
  heatmap.update(frame);
  renderInsights(frame);
}

// ── Demo mode ─────────────────────────────────────────────────
function generateDemoFrame() {
  return {
    L_BIG_TOE: Math.floor(Math.random() * 100),
    L_TOES:    Math.floor(Math.random() * 100),
    L_BALL:    Math.floor(Math.random() * 100),
    L_ARCH:    Math.floor(Math.random() * 100),
    L_HEEL:    Math.floor(Math.random() * 100),
    R_BIG_TOE: Math.floor(Math.random() * 100),
    R_TOES:    Math.floor(Math.random() * 100),
    R_BALL:    Math.floor(Math.random() * 100),
    R_ARCH:    Math.floor(Math.random() * 100),
    R_HEEL:    Math.floor(Math.random() * 100),
  };
}

function startDemoMode() {
  clearInterval(demoTimer);
  isLive = false;
  setConnectionState("demo");
  demoTimer = setInterval(() => handleIncomingFrame(generateDemoFrame()), 900);
}

// ── Connect button ────────────────────────────────────────────
connectBtn.addEventListener("click", async () => {
  // If already live, disconnect
  if (isLive) {
    await disconnectFromShoeBLE();
    startDemoMode();
    return;
  }

  try {
    setConnectionState("connecting");

    await connectToShoeBLE({
      onConnected: (device) => {
        clearInterval(demoTimer);
        isLive = true;
        setConnectionState("connected");
        console.log("[App] BLE connected to:", device.name);
      },

      onDisconnected: () => {
        isLive = false;
        startDemoMode();
      },

      // frame already has the 10-zone named values + _imu, _cop, _raw
      onData: (frame) => {
        handleIncomingFrame(frame);

        // Optional: log raw counts to console at low rate for calibration
        // Uncomment while tuning ADS_MAX_COUNTS or sensor placement
        // if (frame._raw.ts % 2000 < 50) console.table(frame._raw);
      },

      onError: (err) => {
        console.error("[BLE] Error:", err.message ?? err);
        // Surface the error briefly in the stability card
        stabilityValue.textContent    = "BLE Error";
        stabilitySubtext.textContent  = err.message ?? String(err);
      },
    });
  } catch (err) {
    console.error("[App] BLE connect failed:", err);
    startDemoMode();
  }
});

// ── Heatmap init ──────────────────────────────────────────────
async function init() {
  try {
    heatmap = await createHeatmap("#heatmap-container", "/PmTzQ01.svg");
    startDemoMode();
  } catch (err) {
    console.error("Heatmap init failed:", err);
    document.getElementById("heatmap-container").innerHTML = `
      <div style="color:#ffb7b7;font-size:15px;text-align:center;">
        Failed to load heatmap. Check console and verify PmTzQ01.svg exists.
      </div>`;
  }
}

init();
