# SmartLift — FPGA Elevator Control System Demo
### Final Year Project | ECE | FPGA + Verilog + Python + Web

---

## Project Overview
A full-stack engineering demo combining:
- **Verilog FSM** (SmartLift.v) — the actual elevator controller
- **Python Flask** backend — generates testbenches, runs Icarus Verilog, parses VCD
- **Web Dashboard** — animated elevator, FSM trace, signal monitor, movement log

---

## Quick Start

### 1. Install dependencies
```bash
pip install flask

# Linux (Ubuntu/Debian)
sudo apt install iverilog gtkwave

# macOS
brew install icarus-verilog gtkwave

# Windows — install from: http://bleyer.org/icarus/
```

### 2. Run the app
```bash
cd smartlift
python app.py
```

### 3. Open in browser
```
http://127.0.0.1:5000
```

---

## Folder Structure
```
smartlift/
├── app.py               ← Flask backend + Verilog integration
├── SmartLift.v          ← Verilog FSM elevator controller
├── SmartLift_Tb.v       ← Auto-generated testbench (updated on each run)
├── sim                  ← Compiled Verilog binary (auto-generated)
├── waveform.vcd         ← Waveform output (open in GTKWave)
├── templates/
│   └── index.html       ← Main dashboard HTML
└── static/
    ├── style.css        ← Dark industrial UI theme
    └── script.js        ← Elevator animation + API calls
```

---

## How It Works
1. User selects floors 0–7 on the web dashboard
2. Flask generates a Verilog testbench (`SmartLift_Tb.v`) with those floor requests
3. `iverilog` compiles the design; `vvp` runs the simulation
4. `waveform.vcd` is produced — download and open with `gtkwave waveform.vcd`
5. The VCD is parsed and FSM trace drives the elevator animation in the browser

---

## FSM States
| State | Description |
|-------|-------------|
| RESET | System boot, floor 0 |
| IDLE | Waiting for requests |
| MOVING_UP | Travelling to higher floor |
| MOVING_DOWN | Travelling to lower floor |
| DOOR_OPEN | Arrived — door open |
| EMERGENCY | Emergency stop active |

---

## Viva Tips
- Show the live animated demo first, then open GTKWave to show the VCD waveform
- Explain the FSM state transitions on the dashboard
- Point out the auto-generated testbench code shown in the UI
- The signals panel shows exact Verilog wire values in binary
