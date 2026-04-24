/**
 * SmartLift Frontend — FPGA Elevator Simulator
 * Handles: floor selection, queue, animation, FSM trace playback,
 *          Verilog simulation API calls, signal display, log.
 */

// ─── State ───────────────────────────────────────────────────────────────────
const NUM_FLOORS = 8;        // floors 0–7
let queue = [];       // user-selected floor queue
let emergency = false;    // emergency stop flag
let simRunning = false;    // prevent double-runs
let currentFloor = 0;       // visual current floor
let animTimer = null;     // animation interval handle
let travelDirection = 'UP'; // remembers last movement direction
const FLOOR_H = 44;       // px per floor row (matches CSS)

// ─── DOM refs ────────────────────────────────────────────────────────────────
const building = document.getElementById('building');
const floorDisplay = document.getElementById('floor-display');
const dirText = document.getElementById('dir-text');
const dirArrow = document.getElementById('dir-arrow');
const dirIndicator = document.getElementById('dir-indicator');
const doorStatus = document.getElementById('door-status');
const doorText = document.getElementById('door-text');
const doorIcon = document.getElementById('door-icon');
const logBox = document.getElementById('log-box');
const queueDisplay = document.getElementById('queue-display');
const runBtn = document.getElementById('run-btn');
const emergBtn = document.getElementById('emerg-btn');
const resumeBtn = document.getElementById('resume-btn');
const simOverlay = document.getElementById('sim-overlay');
const simSub = document.getElementById('sim-sub');
const tbCode = document.getElementById('tb-code');
const toggleInfoBtn = document.getElementById('toggle-info-btn');

// ─── Build building floors ────────────────────────────────────────────────────
function buildUI() {
  // Floor buttons panel (7 down to 0)
  const btnsWrap = document.getElementById('floor-buttons');
  btnsWrap.innerHTML = '';
  for (let f = NUM_FLOORS - 1; f >= 0; f--) {
    const btn = document.createElement('button');
    btn.className = 'floor-btn';
    btn.id = `fbtn-${f}`;
    btn.textContent = f;
    btn.title = `Request floor ${f}`;
    btn.onclick = () => addFloor(f);
    btnsWrap.appendChild(btn);
  }

  // Building visual (top floor first)
  building.innerHTML = '';
  for (let f = NUM_FLOORS - 1; f >= 0; f--) {
    const row = document.createElement('div');
    row.className = 'floor-row';
    row.id = `floor-row-${f}`;
    row.innerHTML = `
      <span class="floor-num-tag">${f}</span>
      <div class="floor-shaft">
        <div class="floor-lamp" id="lamp-${f}"></div>
      </div>
      <span class="floor-label-right">${floorLabel(f)}</span>
    `;
    building.appendChild(row);
  }

  // Add elevator cabin element
  const cabin = document.createElement('div');
  cabin.id = 'elevator-cabin';
  building.style.position = 'relative';
  building.appendChild(cabin);
  positionCabin(0, false);
}

function floorLabel(f) {
  const labels = ['GND', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
  return labels[f] || '';
}

// ─── Cabin positioning ────────────────────────────────────────────────────────
function positionCabin(floor, animate = true) {
  const cabin = document.getElementById('elevator-cabin');
  if (!cabin) return;
  // Floor 0 is at the BOTTOM of building; floors are rendered top-to-bottom
  // Top of floor `f` row = (NUM_FLOORS - 1 - f) * FLOOR_H
  const topPx = (NUM_FLOORS - 1 - floor) * FLOOR_H + 2;
  cabin.style.transition = animate ? 'top 0.6s cubic-bezier(.4,0,.2,1)' : 'none';
  cabin.style.top = topPx + 'px';
}

// ─── Floor queue management ───────────────────────────────────────────────────
function addFloor(f) {
  if (emergency) return;
  if (queue.includes(f)) {
    // dequeue
    queue = queue.filter(x => x !== f);
    document.getElementById(`fbtn-${f}`).classList.remove('queued');
  } else {
    queue.push(f);
    document.getElementById(`fbtn-${f}`).classList.add('queued');
  }
  renderQueue();
  addLog(`► Floor ${f} ${queue.includes(f) ? 'added to' : 'removed from'} queue`, 'log-sys');
}

function clearQueue() {
  queue = [];
  for (let f = 0; f < NUM_FLOORS; f++) {
    const btn = document.getElementById(`fbtn-${f}`);
    if (btn) { btn.classList.remove('queued', 'visited'); }
  }
  renderQueue();
  addLog('► Queue cleared', 'log-sys');
}

function renderQueue() {
  if (!queue.length) {
    queueDisplay.innerHTML = '<span class="queue-empty">No requests</span>';
    return;
  }
  queueDisplay.innerHTML = queue.map(f =>
    `<span class="queue-chip" id="chip-${f}">${f}</span>`
  ).join('');
}

function planServiceOrder(requestedFloors, startFloor, startDir = 'UP') {
  const uniq = [...new Set(requestedFloors)].sort((a, b) => a - b);
  const above = uniq.filter(f => f >= startFloor);
  const below = uniq.filter(f => f < startFloor).sort((a, b) => b - a);

  if (startDir === 'DOWN') {
    const downFirst = uniq.filter(f => f <= startFloor).sort((a, b) => b - a);
    const upLater = uniq.filter(f => f > startFloor).sort((a, b) => a - b);
    return [...downFirst, ...upLater];
  }

  return [...above, ...below];
}

function applyDiagnosticsVisibility(showPanel) {
  document.body.classList.toggle('compact-mode', !showPanel);
  if (toggleInfoBtn) {
    toggleInfoBtn.textContent = showPanel ? 'Hide Diagnostics' : 'Show Diagnostics';
  }
}

function toggleDiagnosticsPanel() {
  const isCompact = document.body.classList.contains('compact-mode');
  const showPanel = isCompact;
  applyDiagnosticsVisibility(showPanel);
  try {
    localStorage.setItem('smartlift.showDiagnostics', showPanel ? '1' : '0');
  } catch (_) {
    // Ignore storage errors in restricted browser contexts.
  }
}

// ─── Simulation ───────────────────────────────────────────────────────────────
async function runSimulation() {
  if (simRunning || !queue.length) {
    if (!queue.length) addLog('⚠ Select at least one floor first', 'log-emerg');
    return;
  }

  simRunning = true;
  runBtn.disabled = true;
  simOverlay.classList.remove('hidden');
  simSub.textContent = 'Compiling SmartLift.v with Icarus Verilog…';

  addLog('━━━ Starting Verilog Simulation ━━━', 'log-sys');
  addLog(`► Queue: [${queue.join(', ')}]  Emergency: ${emergency}`, 'log-sys');

  try {
    const resp = await fetch('/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        floors: [...queue],
        emergency,
        start_floor: currentFloor
      })
    });

    simSub.textContent = 'Parsing waveform…';

    const data = await resp.json();

    if (data.error) {
      addLog(`✘ Simulation error: ${data.error}`, 'log-emerg');
      if (data.detail) addLog(data.detail, 'log-emerg');
      simOverlay.classList.add('hidden');
      simRunning = false;
      runBtn.disabled = false;
      return;
    }

    addLog('✔ Verilog compilation successful', 'log-done');
    addLog('✔ vvp simulation complete', 'log-done');
    if (data.vcd_available) addLog('✔ waveform.vcd generated', 'log-done');

    // Show generated testbench when panel is present
    if (tbCode) tbCode.textContent = data.testbench;

    // Animate the FSM trace
    simOverlay.classList.add('hidden');
    await playTrace(data.fsm_trace, data.floors);

  } catch (err) {
    addLog(`✘ Network/server error: ${err.message}`, 'log-emerg');
    simOverlay.classList.add('hidden');
  }

  simRunning = false;
  runBtn.disabled = false;
}

// ─── FSM Trace playback ───────────────────────────────────────────────────────
async function playTrace(trace, floors) {
  if (!trace || !trace.length) {
    // No VCD output — animate purely from the queue using JS logic
    addLog('► VCD parse unavailable — running JS animation', 'log-sys');
    await animateFromQueue(floors);
    return;
  }

  addLog(`► Playing ${trace.length} FSM trace steps`, 'log-sys');
  closeDoor();

  let prevFloor = -1;
  let prevState = '';

  for (const snap of trace) {
    if (emergency) {
      setFSM('EMERG');
      closeDoor();
      addLog('⚠ EMERGENCY STOP — simulation halted', 'log-emerg');
      break;
    }

    const f = snap.current_floor;
    const state = snap.state;

    // Update cabin position
    if (f !== prevFloor) {
      moveCabinTo(f);
      prevFloor = f;
    }

    // Update FSM badge
    if (state !== prevState) {
      if (state === 'DOOR_OPEN') {
        openDoor();
        setDirection('IDLE');
      }
      if (prevState === 'DOOR_OPEN' && state !== 'DOOR_OPEN') {
        closeDoor();
      }
      setFSM(state);
      prevState = state;
      logState(f, state);
    }

    // Update signals panel
    updateSignals(snap);
    await sleep(180);
  }

  // Mark all floors done
  for (const f of floors) {
    const btn = document.getElementById(`fbtn-${f}`);
    if (btn) { btn.classList.remove('queued'); btn.classList.add('visited'); }
    const chip = document.getElementById(`chip-${f}`);
    if (chip) chip.classList.add('done');
  }

  addLog('━━━ Simulation Complete ━━━', 'log-done');
  queue = [];
  renderQueue();
  closeDoor();
  setDirection('IDLE');
  setFSM('IDLE');
}

// ─── Pure JS animation (fallback when VCD unavailable) ────────────────────────
async function animateFromQueue(floors) {
  setFSM('IDLE');

  const targets = planServiceOrder(floors, currentFloor, travelDirection);

  for (let i = 0; i < targets.length; i++) {
    if (emergency) { setFSM('EMERG'); break; }

    const target = targets[i];
    const chip = document.getElementById(`chip-${target}`);
    if (chip) chip.classList.add('active');
    addLog(`► Targeting floor ${target}`, 'log-sys');

    setFSM('MOVING_UP');

    // Move step by step
    while (currentFloor !== target) {
      if (emergency) { setFSM('EMERG'); return; }

      const dir = target > currentFloor ? 1 : -1;
      currentFloor += dir;
      moveCabinTo(currentFloor);

      if (dir > 0) {
        setDirection('UP');
        setFSM('MOVING_UP');
        addLog(`▲ Moving up → Floor ${currentFloor}`, 'log-up');
      } else {
        setDirection('DOWN');
        setFSM('MOVING_DOWN');
        addLog(`▼ Moving down → Floor ${currentFloor}`, 'log-down');
      }

      updateSignals({
        current_floor: currentFloor, idle: 0, door: 0,
        up: dir > 0 ? 1 : 0, down: dir < 0 ? 1 : 0
      });
      await sleep(420);
    }

    // Arrived — open door
    setFSM('DOOR_OPEN');
    setDirection('IDLE');
    openDoor();
    addLog(`■ Arrived at floor ${currentFloor} — Door OPEN`, 'log-door');
    updateSignals({ current_floor: currentFloor, idle: 1, door: 1, up: 0, down: 0 });
    await sleep(900);
    closeDoor();

    // Mark done
    const btn = document.getElementById(`fbtn-${target}`);
    if (btn) { btn.classList.remove('queued'); btn.classList.add('visited'); }
    if (chip) { chip.classList.remove('active'); chip.classList.add('done'); }

    setFSM('IDLE');
    await sleep(300);
  }

  addLog('━━━ All floors served ━━━', 'log-done');
  queue = [];
  renderQueue();
  setDirection('IDLE');
}

// ─── Visual helpers ───────────────────────────────────────────────────────────
function moveCabinTo(floor) {
  currentFloor = floor;
  positionCabin(floor, true);
  floorDisplay.textContent = floor;

  // Highlight active floor row
  document.querySelectorAll('.floor-row').forEach(r => r.classList.remove('active-floor', 'lit'));
  const row = document.getElementById(`floor-row-${floor}`);
  if (row) { row.classList.add('active-floor', 'lit'); }
}

function setDirection(dir) {
  dirIndicator.className = 'dir-indicator';
  if (dir === 'UP') { dirIndicator.classList.add('dir-up'); dirArrow.textContent = '▲'; dirText.textContent = 'MOVING UP'; travelDirection = 'UP'; }
  if (dir === 'DOWN') { dirIndicator.classList.add('dir-down'); dirArrow.textContent = '▼'; dirText.textContent = 'MOVING DOWN'; travelDirection = 'DOWN'; }
  if (dir === 'IDLE') { dirIndicator.classList.add('dir-idle'); dirArrow.textContent = '●'; dirText.textContent = 'IDLE'; }
}

function openDoor() {
  const cabin = document.getElementById('elevator-cabin');
  if (cabin) cabin.classList.add('cabin-door-open');
  doorStatus.classList.add('door-open-state');
  doorText.textContent = 'DOOR OPEN';
  doorIcon.textContent = '▏  ▕';
}
function closeDoor() {
  const cabin = document.getElementById('elevator-cabin');
  if (cabin) cabin.classList.remove('cabin-door-open');
  doorStatus.classList.remove('door-open-state');
  doorText.textContent = 'DOOR CLOSED';
  doorIcon.textContent = '▐▌';
}

function setFSM(state) {
  document.querySelectorAll('.fsm-state').forEach(el => el.classList.remove('active'));
  const map = {
    'RESET': 'fsm-RESET', 'IDLE': 'fsm-IDLE',
    'MOVING_UP': 'fsm-MOVING_UP', 'MOVING_DOWN': 'fsm-MOVING_DOWN',
    'DOOR_OPEN': 'fsm-DOOR_OPEN', 'EMERG': 'fsm-EMERG'
  };
  const el = document.getElementById(map[state] || 'fsm-IDLE');
  if (el) el.classList.add('active');
}

function updateSignals(snap) {
  const toBin = (v, bits) => (v >>> 0).toString(2).padStart(bits, '0');
  document.getElementById('sig-floor').textContent = toBin(snap.current_floor, 3);
  document.getElementById('sig-idle').textContent = toBin(snap.idle || 0, 2);
  document.getElementById('sig-up').textContent = toBin(snap.up || 0, 2);
  document.getElementById('sig-down').textContent = toBin(snap.down || 0, 2);
  document.getElementById('sig-door').textContent = toBin(snap.door || 0, 2);
  document.getElementById('sig-emerg').textContent = emergency ? '1' : '0';
}

function logState(floor, state) {
  const map = {
    'MOVING_UP': ['log-up', `▲ Moving UP   — floor ${floor}`],
    'MOVING_DOWN': ['log-down', `▼ Moving DOWN — floor ${floor}`],
    'DOOR_OPEN': ['log-door', `■ DOOR OPEN   — floor ${floor}`],
    'IDLE': ['log-done', `● IDLE        — floor ${floor}`],
    'RESET': ['log-sys', `↺ RESET`],
    'EMERG': ['log-emerg', '⚠ EMERGENCY STOP'],
  };
  const [cls, msg] = map[state] || ['log-sys', state];
  addLog(msg, cls);
}

// ─── Emergency ────────────────────────────────────────────────────────────────
function toggleEmergency() {
  emergency = true;
  emergBtn.classList.add('active');
  emergBtn.classList.add('hidden');
  resumeBtn.classList.remove('hidden');
  setFSM('EMERG');
  setDirection('IDLE');
  closeDoor();
  addLog('⚠⚠ EMERGENCY STOP ACTIVATED ⚠⚠', 'log-emerg');
  document.getElementById('sig-emerg').textContent = '1';
}

function resumeElevator() {
  emergency = false;
  emergBtn.classList.remove('active', 'hidden');
  resumeBtn.classList.add('hidden');
  setFSM('IDLE');
  setDirection('IDLE');
  addLog('↺ System resumed from emergency stop', 'log-done');
  document.getElementById('sig-emerg').textContent = '0';
}

// ─── Log helper ───────────────────────────────────────────────────────────────
function addLog(msg, cls = 'log-sys') {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  div.textContent = `[${ts}] ${msg}`;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Init ─────────────────────────────────────────────────────────────────────
buildUI();
setFSM('RESET');
setDirection('IDLE');
positionCabin(0, false);
try {
  const pref = localStorage.getItem('smartlift.showDiagnostics');
  applyDiagnosticsVisibility(pref === '1');
} catch (_) {
  applyDiagnosticsVisibility(false);
}
addLog('► SmartLift FPGA demo loaded. Select floors and click Run Simulation.', 'log-done');
