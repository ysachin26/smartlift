"""
SmartLift - FPGA Based Elevator Control System
Flask backend that integrates with Icarus Verilog simulation
Run: python app.py  |  Open: http://127.0.0.1:5000
Requires: pip install flask  |  iverilog + vvp installed
"""

from flask import Flask, render_template, request, jsonify, send_file
import subprocess, os, re, json, time

app = Flask(__name__)

# ─── Folder where Verilog files live ────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Verilog testbench template ──────────────────────────────────────────────
# Generates a full multi-request testbench with sequential floor targets
def build_testbench(floors, emergency_at=None):
    """
    Build testbench Verilog for a burst of floor button presses.
    Requests are asserted quickly (one per clock) to mimic random user input.
    The RTL then decides real service order based on current direction.
    emergency_at: optional time (ns) to assert emergency_stop
    """
    lines = []
    lines.append("`timescale 1ns/1ps")
    lines.append("module SmartLift_Tb();")
    lines.append("  reg clk=0, reset=1, emergency_stop=0;")
    lines.append("  reg [2:0] req_floor = 0;")
    lines.append("  wire [2:0] current_floor;")
    lines.append("  wire [1:0] idle, door, Up, Down;")
    lines.append("  wire [7:0] requests;")
    lines.append("  wire [2:0] max_request, min_request;")
    lines.append("")
    lines.append("  SmartLift dut(")
    lines.append("    clk, reset, req_floor,")
    lines.append("    idle, door, Up, Down,")
    lines.append("    current_floor, requests,")
    lines.append("    max_request, min_request, emergency_stop")
    lines.append("  );")
    lines.append("")
    lines.append('  initial begin')
    lines.append('    $dumpfile("waveform.vcd");')
    lines.append('    $dumpvars(0, SmartLift_Tb);')
    lines.append("    #10 reset = 0;")

    # Apply button presses quickly to populate pending requests bitmap.
    for floor in floors:
        lines.append(f"    #10 req_floor = {floor}; // Button press for floor {floor}")

    # Give enough runtime for direction-aware servicing.
    settle_time = max(200, 60 * len(floors) + 80)
    lines.append(f"    #{settle_time} ; // Let controller serve all pending requests")

    if emergency_at:
        lines.append(f"    #{emergency_at} emergency_stop = 1; // Emergency stop")
        lines.append("    #20 emergency_stop = 0;")

    lines.append("    #20 $finish;")
    lines.append("  end")
    lines.append("")
    lines.append("  always #5 clk = ~clk; // 100MHz clock (10ns period)")
    lines.append("endmodule")
    return "\n".join(lines)


# ─── Parse VCD waveform into signal timeline ─────────────────────────────────
def parse_vcd(vcd_path):
    """
    Minimal VCD parser — extracts current_floor, idle, door, Up, Down
    Returns list of { time, current_floor, idle, door, up, down } snapshots
    """
    if not os.path.exists(vcd_path):
        return []

    signals = {}  # id → name
    values  = {}  # id → current value
    snapshots = []
    current_time = 0

    id_map = {}  # id → friendly name
    capture_ids = {}

    with open(vcd_path, 'r') as f:
        content = f.read()

    # --- extract signal id mappings ---
    for m in re.finditer(r'\$var\s+\w+\s+(\d+)\s+(\S+)\s+(\w+)', content):
        width, vid, name = m.group(1), m.group(2), m.group(3)
        id_map[vid] = name
        capture_ids[vid] = name

    # --- walk through timestamped value changes ---
    cur_vals = {}
    for line in content.split('\n'):
        line = line.strip()
        if line.startswith('#'):
            t = int(line[1:])
            if t > 0 and cur_vals:
                snap = {
                    'time': current_time,
                    'current_floor': int(cur_vals.get('current_floor', '000'), 2),
                    'idle':  int(cur_vals.get('idle',  '00'), 2),
                    'door':  int(cur_vals.get('door',  '00'), 2),
                    'up':    int(cur_vals.get('Up',    '0'),  2),
                    'down':  int(cur_vals.get('Down',  '0'),  2),
                }
                snapshots.append(snap)
            current_time = t
        elif line.startswith('b'):
            parts = line.split()
            if len(parts) == 2:
                val, vid = parts[0][1:], parts[1]
                name = id_map.get(vid, '')
                if name:
                    cur_vals[name] = val
        elif len(line) == 2 and line[0] in '01xz':
            val, vid = line[0], line[1:]
            name = id_map.get(vid, '')
            if name:
                cur_vals[name] = val

    return snapshots


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route('/')
def home():
    return render_template('index.html')


@app.route('/simulate', methods=['POST'])
def simulate():
    """
    Accepts JSON: { floors: [2,5,1,7], emergency: false }
    Generates testbench, compiles & runs Verilog, parses VCD, returns signal log.
    """
    data = request.get_json()
    floors = data.get('floors', [0])
    emergency = data.get('emergency', False)

    # Validate floors
    floors = [int(f) for f in floors if 0 <= int(f) <= 7]
    if not floors:
        return jsonify({'error': 'No valid floors provided'}), 400

    tb_path   = os.path.join(BASE_DIR, 'SmartLift_Tb.v')
    dut_path  = os.path.join(BASE_DIR, 'SmartLift.v')
    sim_out   = os.path.join(BASE_DIR, 'sim')
    vcd_path  = os.path.join(BASE_DIR, 'waveform.vcd')

    # Write generated testbench
    tb_code = build_testbench(floors, emergency_at=50 if emergency else None)
    with open(tb_path, 'w') as f:
        f.write(tb_code)

    # Compile with Icarus Verilog
    compile_result = subprocess.run(
        ['iverilog', '-o', sim_out, dut_path, tb_path],
        capture_output=True, text=True, cwd=BASE_DIR
    )
    if compile_result.returncode != 0:
        return jsonify({
            'error': 'Verilog compilation failed',
            'detail': compile_result.stderr
        }), 500

    # Run simulation
    run_result = subprocess.run(
        ['vvp', sim_out],
        capture_output=True, text=True, cwd=BASE_DIR
    )

    # Parse waveform
    snapshots = parse_vcd(vcd_path)

    # Build FSM state trace from snapshots
    fsm_trace = []
    for s in snapshots:
        # Door-open should take priority over idle for UI state playback.
        if s['door']:
            state = 'DOOR_OPEN'
        elif s['idle']:
            state = 'IDLE'
        elif s['up']:
            state = 'MOVING_UP'
        elif s['down']:
            state = 'MOVING_DOWN'
        else:
            state = 'RESET'
        fsm_trace.append({**s, 'state': state})

    return jsonify({
        'success': True,
        'floors': floors,
        'testbench': tb_code,
        'verilog_output': run_result.stdout or '(no stdout)',
        'fsm_trace': fsm_trace,
        'vcd_available': os.path.exists(vcd_path)
    })


@app.route('/testbench')
def get_testbench():
    """Return the last generated testbench source for display."""
    tb_path = os.path.join(BASE_DIR, 'SmartLift_Tb.v')
    if os.path.exists(tb_path):
        with open(tb_path) as f:
            return f.read(), 200, {'Content-Type': 'text/plain'}
    return 'No testbench generated yet.', 404


@app.route('/download/vcd')
def download_vcd():
    vcd_path = os.path.join(BASE_DIR, 'waveform.vcd')
    if os.path.exists(vcd_path):
        return send_file(vcd_path, as_attachment=True)
    return 'VCD not found', 404


if __name__ == '__main__':
    print("\n" + "="*55)
    print("  SmartLift FPGA Elevator Demo")
    print("  Open: http://127.0.0.1:5000")
    print("  Requires: iverilog + vvp in PATH")
    print("="*55 + "\n")
    app.run(debug=True, port=5000)
