// imu.js — IMU processing: tilt, impact, sway, step refinement
// Called from data.js after each packet update

const imuState = {
  // Derived from shoe IMU (0x6A)
  footTiltDeg:   0,      // lateral tilt of foot, degrees
  footPitchDeg:  0,      // fore-aft pitch of foot, degrees
  impactG:       0,      // heel strike impact magnitude
  isSwingPhase:  false,  // foot in the air?

  // Derived from calf IMU (0x6B)
  lateralLeanDeg: 0,     // side-to-side body lean
  forwardLeanDeg: 0,     // anterior/posterior lean
  swayRate:       0,     // gyro magnitude — instability indicator

  // Impact history for chart
  impactHistory:  Array(60).fill(0),

  // Sway history for chart
  swayHistory:    Array(60).fill(0),

  // High-impact event log
  highImpactLog:  [],    // {time, g}
  HIGH_IMPACT_THRESH: 1.8,  // g — tune once you have real data
};

function processIMU(imuFoot, imuCalf) {
  if (!imuFoot || !imuCalf) return;

  // ── Shoe IMU ─────────────────────────────────────────────
  const { ax: fax, ay: fay, az: faz,
          gx: fgx, gy: fgy, gz: fgz } = imuFoot;

  // Lateral tilt: positive = leaning right
  imuState.footTiltDeg  = toDeg(Math.atan2(fay, faz));
  // Fore-aft pitch: positive = toe up
  imuState.footPitchDeg = toDeg(Math.atan2(fax, faz));

  // Impact magnitude (total acceleration vector length)
  const impact = Math.sqrt(fax*fax + fay*fay + faz*faz);
  imuState.impactG = +impact.toFixed(2);

  // Swing phase: when total accel is near 0g, foot is in free fall / air
  imuState.isSwingPhase = impact < 0.25;

  // High impact detection
  if (impact > imuState.HIGH_IMPACT_THRESH) {
    const last = imuState.highImpactLog[imuState.highImpactLog.length - 1];
    if (!last || Date.now() - last.time > 500) {
      imuState.highImpactLog.push({ time: Date.now(), g: +impact.toFixed(2) });
      if (imuState.highImpactLog.length > 30) imuState.highImpactLog.shift();
      if (typeof onHighImpact === 'function') onHighImpact(+impact.toFixed(2));
    }
  }

  // Update impact history
  imuState.impactHistory.push(+(impact).toFixed(2));
  imuState.impactHistory.shift();

  // ── Calf IMU ─────────────────────────────────────────────
  const { ax: cax, ay: cay, az: caz,
          gx: cgx, gy: cgy, gz: cgz } = imuCalf;

  // Lateral lean of the body/lower leg
  imuState.lateralLeanDeg  = toDeg(Math.atan2(cay, caz));
  // Forward lean
  imuState.forwardLeanDeg  = toDeg(Math.atan2(cax, caz));

  // Sway rate = total gyro magnitude
  const sway = Math.sqrt(cgx*cgx + cgy*cgy + cgz*cgz);
  imuState.swayRate = +sway.toFixed(1);

  imuState.swayHistory.push(+sway.toFixed(1));
  imuState.swayHistory.shift();
}

function toDeg(rad) { return +(rad * 180 / Math.PI).toFixed(1); }

// ── Fake IMU data for simulation ──────────────────────────────
function fakeIMU(t, isFallMode) {
  const wobble = isFallMode ? 0.6 : 0.08;

  const imuFoot = {
    ax:  +(Math.sin(t*1.1)*0.15 + rnd(0.04)).toFixed(3),
    ay:  +(Math.sin(t*0.7)*wobble + rnd(0.03)).toFixed(3),
    // az near 1g (gravity) when foot on ground, near 0 in swing
    az:  +(0.98 + Math.sin(t*0.9)*0.05 + rnd(0.02)).toFixed(3),
    gx:  +(Math.sin(t*1.3)*12*wobble + rnd(2)).toFixed(1),
    gy:  +(Math.cos(t*0.8)*8  + rnd(1)).toFixed(1),
    gz:  +(Math.sin(t*1.7)*5  + rnd(1)).toFixed(1),
  };

  const imuCalf = {
    ax:  +(Math.sin(t*0.6)*0.12 + rnd(0.03)).toFixed(3),
    ay:  +(Math.sin(t*0.5)*wobble*0.8 + rnd(0.03)).toFixed(3),
    az:  +(1.01 + Math.sin(t*0.4)*0.04 + rnd(0.02)).toFixed(3),
    gx:  +(Math.sin(t*0.9)*10*wobble + rnd(2)).toFixed(1),
    gy:  +(Math.cos(t*0.7)*6  + rnd(1)).toFixed(1),
    gz:  +(Math.sin(t*1.1)*4  + rnd(1)).toFixed(1),
  };

  return { imuFoot, imuCalf };
}
