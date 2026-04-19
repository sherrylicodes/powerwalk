// js/main.js

import { createHeatmap } from "./heatmap.js";
import { connectToShoeBLE } from "./ble.js";

const connectBtn = document.getElementById("connect-btn");
const connectionPill = document.getElementById("steps-pill");

const balanceValue = document.getElementById("balance-value");
const balanceSubtext = document.getElementById("balance-subtext");

const peakZoneValue = document.getElementById("peak-zone-value");
const peakZoneSubtext = document.getElementById("peak-zone-subtext");

const stabilityValue = document.getElementById("stability-value");
const stabilitySubtext = document.getElementById("stability-subtext");

let heatmap = null;
let demoTimer = null;



const SENSOR_LABELS = {
  L_BIG_TOE: "Left big toe",
  L_TOES: "Left toes",
  L_BALL: "Left ball of foot",
  L_ARCH: "Left arch",
  L_HEEL: "Left heel",
  R_BIG_TOE: "Right big toe",
  R_TOES: "Right toes",
  R_BALL: "Right ball of foot",
  R_ARCH: "Right arch",
  R_HEEL: "Right heel",
};

async function getAIAnalysis(sensorData) {
  const response = await fetch("http://localhost:8000/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      features: sensorData
    })
  });

  const result = await response.json();
  return result;
}

function setConnectionState(mode) {
  if (mode === "connected") {
    connectionPill.textContent = "Connected";
    connectionPill.classList.add("connected");
    connectionPill.classList.remove("disconnected");
    connectBtn.textContent = "Shoe Connected";
  } else if (mode === "connecting") {
    connectionPill.textContent = "Connecting...";
    connectionPill.classList.remove("connected");
    connectionPill.classList.add("disconnected");
    connectBtn.textContent = "Connecting...";
  } else {
    connectionPill.textContent = "Demo Mode";
    connectionPill.classList.remove("connected");
    connectionPill.classList.add("disconnected");
    connectBtn.textContent = "Connect Shoe";
  }
}

function computeInsights(frame) {
  const leftTotal =
    (frame.L_BIG_TOE || 0) +
    (frame.L_TOES || 0) +
    (frame.L_BALL || 0) +
    (frame.L_ARCH || 0) +
    (frame.L_HEEL || 0);

  const rightTotal =
    (frame.R_BIG_TOE || 0) +
    (frame.R_TOES || 0) +
    (frame.R_BALL || 0) +
    (frame.R_ARCH || 0) +
    (frame.R_HEEL || 0);

  const total = leftTotal + rightTotal || 1;
  const leftPct = Math.round((leftTotal / total) * 100);
  const rightPct = 100 - leftPct;

  const entries = Object.entries(frame).sort((a, b) => b[1] - a[1]);
  const [peakId, peakValue] = entries[0] || ["L_HEEL", 0];

  let stability = "Stable";
  let stabilityHint = "Pressure distribution is centered.";

  if (leftPct >= 60) {
    stability = "Leaning Left";
    stabilityHint = "More weight is loading onto the left foot.";
  } else if (rightPct >= 60) {
    stability = "Leaning Right";
    stabilityHint = "More weight is loading onto the right foot.";
  } else if (
    (frame.L_HEEL || 0) + (frame.R_HEEL || 0) >
    (frame.L_BALL || 0) + (frame.R_BALL || 0) + 40
  ) {
    stability = "Leaning Back";
    stabilityHint = "Heel pressure is dominant.";
  } else if (
    (frame.L_BALL || 0) + (frame.R_BALL || 0) >
    (frame.L_HEEL || 0) + (frame.R_HEEL || 0) + 40
  ) {
    stability = "Leaning Forward";
    stabilityHint = "Forefoot pressure is dominant.";
  }

  return {
    leftPct,
    rightPct,
    peakZone: SENSOR_LABELS[peakId] || "Unknown",
    peakValue,
    stability,
    stabilityHint,
  };
}

function renderInsights(frame) {
  const insights = computeInsights(frame);

  balanceValue.textContent = `${insights.leftPct}% / ${insights.rightPct}%`;
  balanceSubtext.textContent =
    Math.abs(insights.leftPct - insights.rightPct) <= 8
      ? "Balanced stance"
      : insights.leftPct > insights.rightPct
      ? "More load on the left side"
      : "More load on the right side";

  peakZoneValue.textContent = insights.peakZone;
  peakZoneSubtext.textContent = `Peak intensity: ${Math.round(insights.peakValue)}`;

  stabilityValue.textContent = insights.stability;
  stabilitySubtext.textContent = insights.stabilityHint;
}

function handleIncomingFrame(frame) {
  if (!heatmap) return;
  heatmap.update(frame);
  renderInsights(frame);
}

function generateDemoFrame() {
  return {
    L_BIG_TOE: Math.floor(Math.random() * 100),
    L_TOES: Math.floor(Math.random() * 100),
    L_BALL: Math.floor(Math.random() * 100),
    L_ARCH: Math.floor(Math.random() * 100),
    L_HEEL: Math.floor(Math.random() * 100),
    R_BIG_TOE: Math.floor(Math.random() * 100),
    R_TOES: Math.floor(Math.random() * 100),
    R_BALL: Math.floor(Math.random() * 100),
    R_ARCH: Math.floor(Math.random() * 100),
    R_HEEL: Math.floor(Math.random() * 100),
  };
}

function startDemoMode() {
  clearInterval(demoTimer);
  setConnectionState("demo");

  demoTimer = setInterval(() => {
    const frame = generateDemoFrame();
    handleIncomingFrame(frame);
  }, 900);
}

async function init() {
  try {
    heatmap = await createHeatmap("#heatmap-container", "/PmTzQ01.svg");
    startDemoMode();
  } catch (err) {
    console.error("Heatmap init failed:", err);
    document.getElementById("heatmap-container").innerHTML = `
      <div style="color:#ffb7b7; font-size:15px; text-align:center;">
        Failed to load heatmap. Check console and make sure PmTzQ01.svg exists.
      </div>
    `;
  }
}

connectBtn.addEventListener("click", async () => {
  try {
    setConnectionState("connecting");

    await connectToShoeBLE({
      onConnected: () => {
        clearInterval(demoTimer);
        setConnectionState("connected");
      },
      onDisconnected: () => {
        startDemoMode();
      },
      onData: (frame) => {
        handleIncomingFrame(frame);
      },
      onError: (err) => {
        console.error("BLE error:", err);
      },
    });
  } catch (err) {
    console.error("BLE connect failed:", err);
    startDemoMode();
  }
});

async function testAI() {
  const sensorData = [
    0.8, 0.4, 0.9,
    0.7, 0.5, 0.8,
    0.6,
    0.7,
    0.5,
    0.4
  ];

  const result = await getAIAnalysis(sensorData);
  console.log("AI Result:", result);
}

testAI();

init();