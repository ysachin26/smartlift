// SmartLift.v — FPGA Elevator FSM Controller
// 8-floor elevator: floors 0–7
// Outputs: idle, door, Up, Down, current_floor, requests, max/min_request
// States: RESET → IDLE → MOVING_UP / MOVING_DOWN → DOOR_OPEN → IDLE
// Emergency stop overrides all motion

module SmartLift #(
    parameter [2:0] START_FLOOR = 3'd0
)(
    input             clk,
    input             reset,
    input      [2:0]  req_floor,
    output reg [1:0]  idle,
    output reg [1:0]  door,
    output reg [1:0]  Up,
    output reg [1:0]  Down,
    output reg [2:0]  current_floor,
    output reg [7:0]  requests,
    output reg [2:0]  max_request,
    output reg [2:0]  min_request,
    input             emergency_stop
);

// FSM state encoding
localparam S_RESET    = 3'd0;
localparam S_IDLE     = 3'd1;
localparam S_MOVE_UP  = 3'd2;
localparam S_MOVE_DN  = 3'd3;
localparam S_DOOR     = 3'd4;
localparam S_EMERG    = 3'd5;

reg [2:0] state;
reg       direction_up;
reg       sampled_req;
reg [2:0] last_req_floor;
reg [2:0] move_wait;
reg [2:0] door_wait;

localparam [2:0] MOVE_TICKS = 3'd2; // cycles per floor movement
localparam [2:0] DOOR_TICKS = 3'd3; // cycles to hold door open

// Returns 1 if any pending request exists above floor f.
function has_above;
    input [2:0] f;
    begin
        case (f)
            3'd0: has_above = |requests[7:1];
            3'd1: has_above = |requests[7:2];
            3'd2: has_above = |requests[7:3];
            3'd3: has_above = |requests[7:4];
            3'd4: has_above = |requests[7:5];
            3'd5: has_above = |requests[7:6];
            3'd6: has_above =  requests[7];
            default: has_above = 1'b0;
        endcase
    end
endfunction

// Returns 1 if any pending request exists below floor f.
function has_below;
    input [2:0] f;
    begin
        case (f)
            3'd0: has_below = 1'b0;
            3'd1: has_below = requests[0];
            3'd2: has_below = |requests[1:0];
            3'd3: has_below = |requests[2:0];
            3'd4: has_below = |requests[3:0];
            3'd5: has_below = |requests[4:0];
            3'd6: has_below = |requests[5:0];
            default: has_below = |requests[6:0];
        endcase
    end
endfunction

always @(posedge clk or posedge reset) begin
    if (reset) begin
        state         <= S_RESET;
        current_floor <= START_FLOOR;
        idle          <= 2'd1;
        door          <= 2'd0;
        Up            <= 2'd1;
        Down          <= 2'd0;
        requests      <= 8'd0;
        max_request   <= START_FLOOR;
        min_request   <= START_FLOOR;
        direction_up  <= 1'b1;
        sampled_req   <= 1'b0;
        last_req_floor<= 3'd0;
        move_wait     <= 3'd0;
        door_wait     <= 3'd0;
    end
    else if (emergency_stop) begin
        state  <= S_EMERG;
        idle   <= 2'd0;
        door   <= 2'd0;
        Up     <= 2'd0;
        Down   <= 2'd0;
    end
    else begin
        // Latch a new button event when req_floor changes.
        // This allows rapid random floor presses to be queued.
        if (!sampled_req) begin
            sampled_req    <= 1'b1;
            last_req_floor <= req_floor;
        end
        else if (req_floor != last_req_floor) begin
            requests[req_floor] <= 1'b1;
            last_req_floor      <= req_floor;
        end

        // Maintain min/max request metadata for display/debug.
        if (requests == 8'd0) begin
            max_request <= current_floor;
            min_request <= current_floor;
        end
        else begin
            if (requests[7]) begin
                max_request <= 3'd7;
            end
            else if (requests[6]) begin
                max_request <= 3'd6;
            end
            else if (requests[5]) begin
                max_request <= 3'd5;
            end
            else if (requests[4]) begin
                max_request <= 3'd4;
            end
            else if (requests[3]) begin
                max_request <= 3'd3;
            end
            else if (requests[2]) begin
                max_request <= 3'd2;
            end
            else if (requests[1]) begin
                max_request <= 3'd1;
            end
            else begin
                max_request <= 3'd0;
            end

            if (requests[0]) begin
                min_request <= 3'd0;
            end
            else if (requests[1]) begin
                min_request <= 3'd1;
            end
            else if (requests[2]) begin
                min_request <= 3'd2;
            end
            else if (requests[3]) begin
                min_request <= 3'd3;
            end
            else if (requests[4]) begin
                min_request <= 3'd4;
            end
            else if (requests[5]) begin
                min_request <= 3'd5;
            end
            else if (requests[6]) begin
                min_request <= 3'd6;
            end
            else begin
                min_request <= 3'd7;
            end
        end

        case (state)
            S_RESET: begin
                state <= S_IDLE;
                idle  <= 2'd1;
            end

            S_IDLE: begin
                if (requests[current_floor]) begin
                    // Serve current floor immediately if pending.
                    requests[current_floor] <= 1'b0;
                    state <= S_DOOR;
                    door  <= 2'd1;
                    idle  <= 2'd1;
                    Up    <= 2'd0;
                    Down  <= 2'd0;
                    door_wait <= 3'd0;
                end
                else if (direction_up && has_above(current_floor)) begin
                    state <= S_MOVE_UP;
                    idle  <= 2'd0;
                    door  <= 2'd0;
                    Up    <= 2'd1;
                    Down  <= 2'd0;
                    move_wait <= 3'd0;
                end
                else if (direction_up && has_below(current_floor)) begin
                    direction_up <= 1'b0;
                    state <= S_MOVE_DN;
                    idle  <= 2'd0;
                    door  <= 2'd0;
                    Up    <= 2'd0;
                    Down  <= 2'd1;
                    move_wait <= 3'd0;
                end
                else if (!direction_up && has_below(current_floor)) begin
                    state <= S_MOVE_DN;
                    idle  <= 2'd0;
                    door  <= 2'd0;
                    Up    <= 2'd0;
                    Down  <= 2'd1;
                    move_wait <= 3'd0;
                end
                else if (!direction_up && has_above(current_floor)) begin
                    direction_up <= 1'b1;
                    state <= S_MOVE_UP;
                    idle  <= 2'd0;
                    door  <= 2'd0;
                    Up    <= 2'd1;
                    Down  <= 2'd0;
                    move_wait <= 3'd0;
                end
                else begin
                    // No pending requests.
                    state <= S_IDLE;
                    idle  <= 2'd1;
                    door  <= 2'd0;
                    Up    <= 2'd0;
                    Down  <= 2'd0;
                end
            end

            S_MOVE_UP: begin
                if (move_wait < (MOVE_TICKS - 1'b1)) begin
                    move_wait <= move_wait + 1'b1;
                end
                else begin
                    move_wait <= 3'd0;
                    if (current_floor < 3'd7) begin
                        current_floor <= current_floor + 1'b1;
                        if (requests[current_floor + 1'b1]) begin
                            requests[current_floor + 1'b1] <= 1'b0;
                            state <= S_DOOR;
                            door  <= 2'd1;
                            Up    <= 2'd0;
                            idle  <= 2'd1;
                            door_wait <= 3'd0;
                        end
                    end
                    else if (has_below(current_floor)) begin
                        direction_up <= 1'b0;
                        state <= S_MOVE_DN;
                        Up    <= 2'd0;
                        Down  <= 2'd1;
                    end
                    else begin
                        state <= S_IDLE;
                        Up    <= 2'd0;
                        idle  <= 2'd1;
                    end
                end
            end

            S_MOVE_DN: begin
                if (move_wait < (MOVE_TICKS - 1'b1)) begin
                    move_wait <= move_wait + 1'b1;
                end
                else begin
                    move_wait <= 3'd0;
                    if (current_floor > 3'd0) begin
                        current_floor <= current_floor - 1'b1;
                        if (requests[current_floor - 1'b1]) begin
                            requests[current_floor - 1'b1] <= 1'b0;
                            state <= S_DOOR;
                            door  <= 2'd1;
                            Down  <= 2'd0;
                            idle  <= 2'd1;
                            door_wait <= 3'd0;
                        end
                    end
                    else if (has_above(current_floor)) begin
                        direction_up <= 1'b1;
                        state <= S_MOVE_UP;
                        Up    <= 2'd1;
                        Down  <= 2'd0;
                    end
                    else begin
                        state <= S_IDLE;
                        Down  <= 2'd0;
                        idle  <= 2'd1;
                    end
                end
            end

            S_DOOR: begin
                // Hold door open for a few cycles to mimic dwell time.
                door <= 2'd1;
                if (door_wait < (DOOR_TICKS - 1'b1)) begin
                    door_wait <= door_wait + 1'b1;
                end
                else begin
                    door_wait <= 3'd0;
                    door  <= 2'd0;
                    state <= S_IDLE;
                end
            end

            S_EMERG: begin
                // Stay halted until reset
                idle  <= 2'd0;
                door  <= 2'd0;
            end
        endcase
    end
end

endmodule
