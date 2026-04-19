// js/heatmap.js

const SVG_NS = "http://www.w3.org/2000/svg";

const SENSOR_LAYOUT = [
  // LEFT FOOT — moved inward toward sole
  { id: "L_BIG_TOE", foot: "left", x: 200, y: 110, r: 26, label: "Left big toe" },
  { id: "L_TOES", foot: "left", x: 145, y: 145, r: 24, label: "Left toes" },
  { id: "L_BALL", foot: "left", x: 170, y: 215, r: 38, label: "Left ball of foot" },
  { id: "L_ARCH", foot: "left", x: 185, y: 335, r: 30, label: "Left arch" },
  { id: "L_HEEL", foot: "left", x: 160, y: 505, r: 42, label: "Left heel" },

  // RIGHT FOOT — moved inward toward sole
  { id: "R_BIG_TOE", foot: "right", x: 400, y: 110, r: 26, label: "Right big toe" },
  { id: "R_TOES", foot: "right", x: 455, y: 145, r: 24, label: "Right toes" },
  { id: "R_BALL", foot: "right", x: 430, y: 215, r: 38, label: "Right ball of foot" },
  { id: "R_ARCH", foot: "right", x: 415, y: 335, r: 30, label: "Right arch" },
  { id: "R_HEEL", foot: "right", x: 440, y: 505, r: 42, label: "Right heel" },
];

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pressureToColor(value) {
  const v = clamp(value, 0, 100);

  if (v <= 0) return "rgba(0,0,0,0)";
  if (v < 35) return `rgba(48, 217, 124, ${0.18 + v / 140})`;
  if (v < 70) return `rgba(255, 216, 77, ${0.24 + v / 140})`;
  return `rgba(255, 77, 87, ${0.34 + v / 160})`;
}

function scaleRadius(baseR, value) {
  return baseR * (0.82 + value / 220);
}

function findTwoMainFootPaths(svgDoc) {
  const svgRoot = svgDoc.querySelector("svg");
  if (!svgRoot) {
    throw new Error("No <svg> root found in PmTzQ01.svg");
  }

  // Find the first group that has paths in it
  const candidateGroups = Array.from(svgDoc.querySelectorAll("g"));
  let chosenGroup = null;

  for (const group of candidateGroups) {
    const paths = group.querySelectorAll("path");
    if (paths.length >= 2) {
      chosenGroup = group;
      break;
    }
  }

  const scope = chosenGroup || svgRoot;
  const inheritedTransform = chosenGroup?.getAttribute("transform") || "";

  const allPaths = Array.from(scope.querySelectorAll("path"));

  if (allPaths.length < 2) {
    throw new Error("Could not find enough path elements in PmTzQ01.svg");
  }

  const mainPaths = allPaths
    .map((path) => ({
      d: path.getAttribute("d") || "",
      length: (path.getAttribute("d") || "").length,
    }))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);

  const [a, b] = mainPaths;

  const firstNumberA = Number((a.d.match(/^M\s*([0-9.]+)/) || [])[1] || 0);
  const firstNumberB = Number((b.d.match(/^M\s*([0-9.]+)/) || [])[1] || 0);

  const leftPath = firstNumberA < firstNumberB ? a.d : b.d;
  const rightPath = firstNumberA < firstNumberB ? b.d : a.d;

  return {
    leftPath,
    rightPath,
    transform: inheritedTransform,
  };
}

export async function createHeatmap(containerSelector = "#heatmap-container", svgUrl = "/PmTzQ01.svg") {
  const container = document.querySelector(containerSelector);
  if (!container) throw new Error(`Container not found: ${containerSelector}`);

  container.innerHTML = "";

  const response = await fetch(svgUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${svgUrl}`);
  }

  const svgText = await response.text();
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, "image/svg+xml");

  const { leftPath, rightPath, transform } = findTwoMainFootPaths(svgDoc);
  const svg = createSvgEl("svg", {
    viewBox: "0 0 600 614",
    class: "foot-heatmap-svg",
    preserveAspectRatio: "xMidYMid meet",
  });

  const defs = createSvgEl("defs");

  const leftClip = createSvgEl("clipPath", {
    id: "leftFootClip",
    clipPathUnits: "userSpaceOnUse",
  });
  leftClip.appendChild(createSvgEl("path", { d: leftPath, transform }));

  const rightClip = createSvgEl("clipPath", {
    id: "rightFootClip",
    clipPathUnits: "userSpaceOnUse",
  });
  rightClip.appendChild(createSvgEl("path", { d: rightPath, transform }));

  const blurStrong = createSvgEl("filter", {
    id: "heatBlurStrong",
    x: "-40%",
    y: "-40%",
    width: "180%",
    height: "180%",
  });
  blurStrong.appendChild(createSvgEl("feGaussianBlur", { stdDeviation: "12" }));

  const blurSoft = createSvgEl("filter", {
    id: "heatBlurSoft",
    x: "-30%",
    y: "-30%",
    width: "160%",
    height: "160%",
  });
  blurSoft.appendChild(createSvgEl("feGaussianBlur", { stdDeviation: "6" }));

  defs.appendChild(leftClip);
  defs.appendChild(rightClip);
  defs.appendChild(blurStrong);
  defs.appendChild(blurSoft);
  svg.appendChild(defs);

  const leftHeatGroup = createSvgEl("g", { "clip-path": "url(#leftFootClip)" });
  const rightHeatGroup = createSvgEl("g", { "clip-path": "url(#rightFootClip)" });

  const sensorNodes = {};

  for (const sensor of SENSOR_LAYOUT) {
    const group = createSvgEl("g", { "data-sensor-id": sensor.id });

    const outer = createSvgEl("circle", {
      cx: sensor.x,
      cy: sensor.y,
      r: sensor.r,
      fill: "transparent",
      filter: "url(#heatBlurStrong)",
    });

    const inner = createSvgEl("circle", {
      cx: sensor.x,
      cy: sensor.y,
      r: sensor.r * 0.58,
      fill: "transparent",
      filter: "url(#heatBlurSoft)",
    });

    group.appendChild(outer);
    group.appendChild(inner);

    sensorNodes[sensor.id] = {
      outer,
      inner,
      baseR: sensor.r,
      label: sensor.label,
    };

    if (sensor.foot === "left") {
      leftHeatGroup.appendChild(group);
    } else {
      rightHeatGroup.appendChild(group);
    }
  }

  svg.appendChild(leftHeatGroup);
  svg.appendChild(rightHeatGroup);

  // stronger outline
const leftOutline = createSvgEl("path", {
  d: leftPath,
  transform,
  fill: "rgba(255,255,255,0.02)",
  stroke: "white",
  "stroke-width": "3",
  "stroke-linejoin": "round",
  "stroke-linecap": "round",
});

const leftGlow = createSvgEl("path", {
  d: leftPath,
  transform,
  fill: "none",
  stroke: "rgba(255,255,255,0.08)",
  "stroke-width": "4",
});
leftGlow.style.filter = "blur(8px)";

const rightGlow = createSvgEl("path", {
  d: rightPath,
  transform,
  fill: "none",
  stroke: "rgba(255,255,255,0.08)",
  "stroke-width": "4",
});
rightGlow.style.filter = "blur(8px)";

const rightOutline = createSvgEl("path", {
  d: rightPath,
  transform,
  fill: "rgba(255,255,255,0.02)",
  stroke: "white",
  "stroke-width": "3",
  "stroke-linejoin": "round",
  "stroke-linecap": "round",
});

rightOutline.style.filter = "drop-shadow(0 0 6px rgba(255,255,255,0.6))";


  svg.appendChild(leftOutline);
  svg.appendChild(rightOutline);
  container.appendChild(svg);

  function update(values = {}) {
    for (const sensor of SENSOR_LAYOUT) {
      const value = clamp(values[sensor.id] ?? 0, 0, 100);
      const color = pressureToColor(value);

      sensorNodes[sensor.id].outer.setAttribute("fill", color);
      sensorNodes[sensor.id].inner.setAttribute("fill", color);
      sensorNodes[sensor.id].outer.setAttribute("r", scaleRadius(sensorNodes[sensor.id].baseR, value));
      sensorNodes[sensor.id].inner.setAttribute(
        "r",
        scaleRadius(sensorNodes[sensor.id].baseR * 0.58, value)
      );
    }
  }

  return { update };
}