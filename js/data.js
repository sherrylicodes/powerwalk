// data.js — sensor state, step detection, fall risk, hotspot, IMU

const state = {
  fsr:          [0,0,0,0,0,0],
  cop:          { x:0, y:0 },
  _prevCop:     { x:0, y:0 },
  imuFoot:      { ax:0, ay:0, az:1, gx:0, gy:0, gz:0 },
  imuCalf:      { ax:0, ay:0, az:1, gx:0, gy:0, gz:0 },
  motor:        null,
  stepCount:    0,
  cadence:      0,
  score:        100,
  sessionStart: Date.now(),
  fallRisk:       'low',
  fallTimerStart: null,
  nearFallLog:    [],
  copVelocity:    { x:0, y:0 },
  hotspotActive:  false,
  hotspotSensor:  null,
  hotspotStart:   null,
  hotspotLog:     [],
};

// ── Step detection ────────────────────────────────────────────
const stepDetector = { inStance:false, stepTimes:[], cooldown:0 };
const STEP_ON=180, STEP_OFF=60;

function detectStep() {
  const total = state.fsr.reduce((a,b)=>a+b,0);
  const now = Date.now();
  if (!stepDetector.inStance && total>STEP_ON && now>stepDetector.cooldown) {
    stepDetector.inStance = true;
  } else if (stepDetector.inStance && total<STEP_OFF) {
    stepDetector.inStance = false;
    stepDetector.cooldown = now+300;
    _recordStep(now);
  }
}

function _recordStep(now) {
  state.stepCount++;
  stepDetector.stepTimes.push(now);
  if (stepDetector.stepTimes.length>8) stepDetector.stepTimes.shift();
  if (stepDetector.stepTimes.length>=2) {
    const intervals=[];
    for(let i=1;i<stepDetector.stepTimes.length;i++)
      intervals.push(stepDetector.stepTimes[i]-stepDetector.stepTimes[i-1]);
    state.cadence = Math.round(60000/(intervals.reduce((a,b)=>a+b)/intervals.length));
  }
}

// ── Fall risk ─────────────────────────────────────────────────
const FALL_COP_THRESHOLD=0.62, FALL_SPEED_THRESHOLD=0.06, FALL_RECOVERY_MS=900;

function detectFallRisk() {
  const vx=state.cop.x-state._prevCop.x, vy=state.cop.y-state._prevCop.y;
  state.copVelocity={x:vx,y:vy};
  const speed=Math.sqrt(vx*vx+vy*vy);
  const dist=Math.sqrt(state.cop.x**2+state.cop.y**2);
  const isRisky=dist>FALL_COP_THRESHOLD&&speed>FALL_SPEED_THRESHOLD;

  // Also factor in calf sway — high sway elevates risk
  const swayRisk = imuState.swayRate > 40;

  if (isRisky || (swayRisk && dist>0.4)) {
    if (!state.fallTimerStart) { state.fallTimerStart=Date.now(); state.fallRisk='elevated'; }
    else {
      const elapsed=Date.now()-state.fallTimerStart;
      if (elapsed>FALL_RECOVERY_MS) {
        state.fallRisk='critical';
        const last=state.nearFallLog[state.nearFallLog.length-1];
        if (!last||Date.now()-last.time>2000) {
          const dir=_copDir(state.cop);
          state.nearFallLog.push({time:Date.now(),cop:{...state.cop},direction:dir});
          if (state.nearFallLog.length>50) state.nearFallLog.shift();
          if (typeof onNearFall==='function') onNearFall(dir);
        }
      }
    }
  } else { state.fallTimerStart=null; state.fallRisk='low'; }
}

function _copDir(cop) {
  const ax=Math.abs(cop.x),ay=Math.abs(cop.y);
  if(ay>ax) return cop.y<0?'forward':'backward';
  return cop.x<0?'left':'right';
}

// ── Hotspot ───────────────────────────────────────────────────
const HOTSPOT_RATIO=2.0, HOTSPOT_MIN=40, HOTSPOT_MS=5000;
const FSR_NAMES=['Toe-L','Toe-R','Mid-L','Mid-R','Heel-L','Heel-R'];

function detectHotspot() {
  const avg=state.fsr.reduce((a,b)=>a+b,0)/6;
  let hotIdx=-1;
  for(let i=0;i<6;i++) {
    if(state.fsr[i]>avg*HOTSPOT_RATIO&&state.fsr[i]>HOTSPOT_MIN){hotIdx=i;break;}
  }
  if(hotIdx!==-1) {
    state.hotspotSensor=hotIdx;
    if(!state.hotspotStart) state.hotspotStart=Date.now();
    else if(!state.hotspotActive&&Date.now()-state.hotspotStart>HOTSPOT_MS) {
      state.hotspotActive=true;
      state.hotspotLog.push({time:Date.now(),sensor:hotIdx,name:FSR_NAMES[hotIdx],value:Math.round(state.fsr[hotIdx])});
      if(state.hotspotLog.length>20) state.hotspotLog.shift();
      if(typeof onHotspot==='function') onHotspot(FSR_NAMES[hotIdx]);
    }
  } else { state.hotspotStart=null; state.hotspotActive=false; state.hotspotSensor=null; }
}

// ── Derived ───────────────────────────────────────────────────
function computeDerived() {
  const THRESH=0.20, {x,y}=state.cop;
  const ax=Math.abs(x),ay=Math.abs(y);
  if(ax<THRESH&&ay<THRESH) state.motor=null;
  else if(ay>=ax) state.motor=y<0?'front':'back';
  else state.motor=x<0?'left':'right';

  const dev=Math.sqrt(x*x+y*y);
  const ls=state.fsr[0]+state.fsr[2]+state.fsr[4];
  const rs=state.fsr[1]+state.fsr[3]+state.fsr[5];
  const ts=ls+rs;
  const asym=ts>0?Math.abs(ls-rs)/ts:0;
  // Factor IMU sway into score
  const swayPenalty=Math.min(20, imuState.swayRate*0.3);
  state.score=Math.max(0,Math.round(100-dev*35-asym*25-swayPenalty));
}

// ── Main packet handler ───────────────────────────────────────
function updateFromPacket(packet) {
  state._prevCop={...state.cop};
  if(packet.fsr&&packet.fsr.length===6)
    state.fsr=packet.fsr.map(v=>Math.max(0,Math.min(100,v)));
  if(packet.cop){state.cop.x=clamp(packet.cop.x,-1,1);state.cop.y=clamp(packet.cop.y,-1,1);}
  if(packet.imuFoot) state.imuFoot=packet.imuFoot;
  if(packet.imuCalf) state.imuCalf=packet.imuCalf;
  if(packet.step===true) _recordStep(Date.now()); else detectStep();

  processIMU(state.imuFoot, state.imuCalf);
  detectFallRisk();
  detectHotspot();
  computeDerived();
}

// ── Simulation ────────────────────────────────────────────────
let _fakeTimer=null, _fakeT=0, _fakeFallMode=false, _fakeHotMode=false;

function startSimulation() {
  if(_fakeTimer) return;
  _fakeTimer=setInterval(_fakeTick,100);
}
function stopSimulation() { clearInterval(_fakeTimer); _fakeTimer=null; }

function _fakeTick() {
  _fakeT+=0.1;
  const t=_fakeT;
  _fakeFallMode=(t%30)>27&&(t%30)<29.5;
  _fakeHotMode=(t%45)>40;

  let cx,cy;
  if(_fakeFallMode){cx=0.75+Math.sin(t*3)*0.05;cy=-0.70+Math.cos(t*3)*0.05;}
  else{cx=Math.sin(t*0.6)*0.42+Math.sin(t*1.7)*0.08;cy=Math.cos(t*0.5)*0.36+Math.cos(t*2.1)*0.07;}

  const base=55+Math.sin(t*0.9)*22;
  let fsr=[
    clamp(base+cy*-52+cx*-28+rnd(6),0,100),
    clamp(base+cy*-52+cx* 28+rnd(6),0,100),
    clamp(base        +cx*-18+rnd(8),0,100),
    clamp(base        +cx* 18+rnd(8),0,100),
    clamp(base+cy* 48+cx*-18+rnd(6),0,100),
    clamp(base+cy* 48+cx* 18+rnd(6),0,100),
  ];
  if(_fakeHotMode) fsr[2]=clamp(fsr[2]*3.5,0,100);

  const {imuFoot,imuCalf}=fakeIMU(t,_fakeFallMode);
  const step=Math.abs(Math.sin(t*0.8))>0.98;
  updateFromPacket({fsr,cop:{x:cx,y:cy},imuFoot,imuCalf,step});
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function rnd(r){return(Math.random()-.5)*r;}
