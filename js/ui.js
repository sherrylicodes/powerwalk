// ui.js — all rendering, wired to live state + imuState

const HIST_LEN = 80;
const _pressData  = Array(HIST_LEN).fill(0);
const _impactData = Array(HIST_LEN).fill(0);
const _stabData   = Array(HIST_LEN).fill(0);

// ── Multi-line chart ──────────────────────────────────────────
const histChart = new Chart(document.getElementById('hist-canvas'), {
  type: 'line',
  data: {
    labels: Array(HIST_LEN).fill(''),
    datasets: [
      { label:'Pressure', data:[..._pressData],  borderColor:'#22d3ee', borderWidth:1.2, pointRadius:0, fill:false, tension:0.4 },
      { label:'Impact',   data:[..._impactData], borderColor:'#f59e0b', borderWidth:1.2, pointRadius:0, fill:false, tension:0.3 },
      { label:'Stability',data:[..._stabData],   borderColor:'#22c55e', borderWidth:1.2, pointRadius:0, fill:false, tension:0.4 },
    ],
  },
  options: {
    animation: false, responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: { min:0, max:100, display:true,
        ticks: { font:{size:9,family:'JetBrains Mono'}, color:'#4e5a6e', maxTicksLimit:4 },
        grid:  { color:'rgba(255,255,255,0.04)' } },
    },
  },
});

// ── Legend canvas ─────────────────────────────────────────────
let _legendDrawn = false;
function maybeDrawLegend() {
  if (_legendDrawn) return;
  const lc = document.getElementById('legend-canvas');
  if (lc) { drawLegend(lc); _legendDrawn = true; }
}

// ── Main render ───────────────────────────────────────────────
function render() {
  maybeDrawLegend();
  renderHeatmap();
  renderPressureBars();
  renderMotors();
  renderHotspot();
  renderTimeline();
  renderDiagnostics();
  renderCOPMini();
  renderHeader();
}

// ── Heatmap canvas ────────────────────────────────────────────
function renderHeatmap() {
  const canvas = document.getElementById('foot-canvas');
  if (canvas) drawHeatmap(canvas, state.fsr, state.hotspotSensor);
}

// ── Pressure bars ─────────────────────────────────────────────
function renderPressureBars() {
  const names = ['T·L','T·R','M·L','M·R','H·L','H·R'];
  state.fsr.forEach((val, i) => {
    const isHot = state.hotspotActive && state.hotspotSensor === i;
    const fill  = document.getElementById('pb' + i);
    const valEl = document.getElementById('pv' + i);
    if (!fill) return;

    fill.style.width = val + '%';
    const t = val / 100;
    fill.style.background = isHot ? '#ef4444'
      : t < 0.4  ? `rgb(0,${Math.round(t*637)},255)`
      : t < 0.6  ? `rgb(${Math.round((t-0.4)*1275)},255,${Math.round((0.6-t)*1275)})`
      : `rgb(255,${Math.round((1-t)*318)},0)`;

    if (valEl) valEl.textContent = Math.round(val);
  });
}

// ── Motors ────────────────────────────────────────────────────
function renderMotors() {
  ['front','back','left','right'].forEach(id => {
    const el = document.getElementById('m-' + id);
    if (el) el.classList.toggle('active', id === state.motor);
  });
}

// ── COP direction label ───────────────────────────────────────
const DIR_LABELS = { front:'Leaning Forward', back:'Leaning Back', left:'Left Shift', right:'Right Shift' };

// ── Hotspot alert ─────────────────────────────────────────────
function renderHotspot() {
  const alert = document.getElementById('hotspot-alert');
  const text  = document.getElementById('hotspot-text');
  if (!alert) return;

  if (state.hotspotActive && state.hotspotSensor !== null) {
    const names = ['Toe-Left','Toe-Right','Mid-Left','Mid-Right','Heel-Left','Heel-Right'];
    alert.classList.add('visible');
    text.textContent = `Persistent high pressure at ${names[state.hotspotSensor]}. Check footwear and inspect foot for injury.`;
  } else {
    alert.classList.remove('visible');
  }
}

// ── Timeline chart ────────────────────────────────────────────
function renderTimeline() {
  const avg    = Math.round(state.fsr.reduce((a,b)=>a+b,0) / state.fsr.length);
  const impact = Math.min(100, Math.round(imuState.impactG * 33));
  const stab   = state.score;

  _pressData.push(avg);   _pressData.shift();
  _impactData.push(impact); _impactData.shift();
  _stabData.push(stab);   _stabData.shift();

  histChart.data.datasets[0].data = [..._pressData];
  histChart.data.datasets[1].data = [..._impactData];
  histChart.data.datasets[2].data = [..._stabData];
  histChart.update('none');

  // Score badge
  const scoreEl = document.getElementById('tl-score');
  const wordEl  = document.getElementById('tl-score-word');
  if (scoreEl) {
    scoreEl.textContent = state.score;
    const color = state.score > 75 ? 'var(--green)' : state.score > 45 ? 'var(--amber)' : 'var(--red)';
    scoreEl.style.color = color;
    if (wordEl) {
      wordEl.textContent = state.score > 75 ? 'Good' : state.score > 45 ? 'Fair' : 'Poor';
      wordEl.style.color = color;
    }
  }
}

// ── Diagnostics panel ─────────────────────────────────────────
function renderDiagnostics() {
  // ── Gait instability ──
  const gaitBadge = document.getElementById('gait-badge');
  const gaitDesc  = document.getElementById('gait-desc');
  if (gaitBadge && gaitDesc) {
    const risk = state.fallRisk;
    const sway = imuState.swayRate;
    const dir  = DIR_LABELS[state.motor] ?? null;

    if (risk === 'critical') {
      gaitBadge.textContent = 'Critical';
      gaitBadge.style.cssText = 'background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;font-family:var(--mono)';
      gaitDesc.textContent = `Near-fall detected — rapid ${dir ?? 'weight'} shift detected. Haptic cue active.`;
    } else if (risk === 'elevated' || sway > 30) {
      gaitBadge.textContent = 'Moderate';
      gaitBadge.style.cssText = 'background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3);padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;font-family:var(--mono)';
      gaitDesc.textContent = dir
        ? `${dir} detected. Sway rate elevated at ${imuState.swayRate}°/s.`
        : `Elevated sway rate (${imuState.swayRate}°/s). Monitor balance.`;
    } else {
      gaitBadge.textContent = 'Stable';
      gaitBadge.style.cssText = 'background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.25);padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;font-family:var(--mono)';
      gaitDesc.textContent = 'No instability detected. Gait within normal parameters.';
    }
  }

  // ── Step balance ──
  const scoreEl  = document.getElementById('d-score');
  const stanceEl = document.getElementById('d-stance');
  const cadEl    = document.getElementById('d-cadence');
  const balDesc  = document.getElementById('balance-desc');

  if (scoreEl) {
    scoreEl.textContent = state.score;
    scoreEl.style.color = state.score > 75 ? 'var(--green)' : state.score > 45 ? 'var(--amber)' : 'var(--red)';
  }
  if (stanceEl) stanceEl.textContent = DIR_LABELS[state.motor] ?? 'Centered';
  if (cadEl)    cadEl.textContent    = state.cadence > 0 ? state.cadence : '—';
  if (balDesc) {
    const ls = state.fsr[0]+state.fsr[2]+state.fsr[4];
    const rs = state.fsr[1]+state.fsr[3]+state.fsr[5];
    const total = ls + rs;
    if (total > 10) {
      const pct = Math.round((ls / total) * 100);
      balDesc.textContent = pct > 58
        ? `Left-side bias detected (${pct}% left). Consider posture correction.`
        : pct < 42
        ? `Right-side bias detected (${100-pct}% right). Consider posture correction.`
        : `Weight distribution balanced (${pct}% L / ${100-pct}% R).`;
    }
  }

  // ── Fall risk ──
  const fallBadge = document.getElementById('fall-badge');
  const fallDesc  = document.getElementById('fall-desc');
  if (fallBadge) {
    const map = {
      low:      { label:'Low',      color:'#22c55e', bg:'rgba(34,197,94,.12)',  bd:'rgba(34,197,94,.25)'  },
      elevated: { label:'Elevated', color:'#f59e0b', bg:'rgba(245,158,11,.15)', bd:'rgba(245,158,11,.3)'  },
      critical: { label:'High!',    color:'#ef4444', bg:'rgba(239,68,68,.15)',  bd:'rgba(239,68,68,.3)'   },
    };
    const s = map[state.fallRisk] ?? map.low;
    fallBadge.textContent = s.label;
    fallBadge.style.cssText = `background:${s.bg};color:${s.color};border:1px solid ${s.bd};padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;font-family:var(--mono)`;
  }
  if (fallDesc) {
    fallDesc.textContent = state.fallRisk === 'critical'
      ? `Rapid weight shift detected — ${DIR_LABELS[state.motor] ?? 'unstable'}.`
      : state.fallRisk === 'elevated'
      ? 'COP approaching edge — consider slowing pace.'
      : 'Center of pressure within safe zone.';
  }

  // ── COP direction label ──
  const dirEl = document.getElementById('cop-direction-label');
  if (dirEl) dirEl.textContent = DIR_LABELS[state.motor] ?? 'Centered';

  // ── Injury risk ──
  const injLevel = document.getElementById('injury-level');
  const injDesc  = document.getElementById('injury-desc');
  if (injLevel) {
    if (state.hotspotActive) {
      const names = ['Toe-L','Toe-R','Mid-L','Mid-R','Heel-L','Heel-R'];
      injLevel.innerHTML = '<span style="color:#ef4444">High !</span>';
      if (injDesc) injDesc.textContent = `Persistent pressure anomaly at ${names[state.hotspotSensor] ?? '—'}. Inspect foot for wounds, blisters, or foreign objects.`;
    } else if (state.hotspotSensor !== null) {
      injLevel.innerHTML = '<span style="color:#f59e0b">Watch ▲</span>';
      if (injDesc) injDesc.textContent = 'Localized pressure building — monitor for hotspot.';
    } else {
      injLevel.innerHTML = '<span style="color:#22c55e">None ✓</span>';
      if (injDesc) injDesc.textContent = 'No sustained pressure anomalies detected.';
    }
  }
}

// ── COP mini map ──────────────────────────────────────────────
function renderCOPMini() {
  const dot = document.getElementById('cop-mini-dot');
  if (!dot) return;
  const lx = 50 + state.cop.x * 38;
  const ly = 50 + state.cop.y * 38;
  dot.style.left = lx + '%';
  dot.style.top  = ly + '%';
  dot.style.background = state.fallRisk === 'critical' ? '#ef4444' : '#22d3ee';
  dot.style.boxShadow  = `0 0 6px ${state.fallRisk === 'critical' ? '#ef4444' : '#22d3ee'}`;
}

// ── Header step count ─────────────────────────────────────────
function renderHeader() {
  const el = document.getElementById('h-steps');
  if (el) el.textContent = state.stepCount;
}

// ── Event callbacks from data.js ──────────────────────────────
function onNearFall(direction)  { addEvent('fall',    `Near-fall — ${direction} weight shift`); }
function onHotspot(sensorName)  { addEvent('hotspot', `Pressure anomaly · ${sensorName}`); }
function onHighImpact(g)        { addEvent('impact',  `High impact landing — ${g}g`); }

function addEvent(type, desc) {
  const log   = document.getElementById('event-log');
  if (!log) return;
  const empty = log.querySelector('.event-empty');
  if (empty) empty.remove();

  const now  = new Date();
  const time = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const colors = { fall:'#ef4444', hotspot:'#f59e0b', impact:'#8b5cf6' };

  const item = document.createElement('div');
  item.className = 'event-item';
  item.innerHTML = `<span class="event-time">${time}</span>
    <span class="event-dot" style="background:${colors[type]??'#8b95a8'}"></span>
    <span class="event-desc">${desc}</span>`;
  log.prepend(item);
  while (log.children.length > 20) log.removeChild(log.lastChild);
}

// ── BLE status ────────────────────────────────────────────────
function setBLEStatus(status) {
  const dot   = document.getElementById('ble-dot');
  const label = document.getElementById('ble-label');
  if (dot)   dot.className   = 'status-dot' + (status==='live' ? ' live' : status==='searching' ? ' searching' : '');
  if (label) label.textContent = { live:'Connected', searching:'Connecting…', disconnected:'Demo mode' }[status] ?? 'Demo mode';
}

// ── Mode switch ───────────────────────────────────────────────
const MODE_DESCS = {
  balance: 'Improves balance by providing real-time haptic feedback for those with peripheral neuropathy or balance issues.',
  rehab:   'Guided rehabilitation mode — follow the cued step pattern and weight-shift exercises to retrain gait.',
};

function setMode(mode) {
  ['balance','rehab'].forEach(m => {
    document.getElementById('mode-' + m)?.classList.toggle('active', m === mode);
  });
  const desc = document.getElementById('mode-desc');
  if (desc) desc.textContent = MODE_DESCS[mode] ?? '';
}

// ── Step timeline (small bars, kept for compat) ───────────────
let _lastSteps = 0;
function renderStepTimeline() {
  if (state.stepCount === _lastSteps) return;
  _lastSteps = state.stepCount;
}