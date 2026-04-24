// SmartLift.v — FPGA Elevator FSM Controller
// 8-floor elevator: floors 0–7
// Outputs: idle, door, Up, Down, current_floor, requests, max/min_request
// States: RESET → IDLE → MOVING_UP / MOVING_DOWN → DOOR_OPEN → IDLE
// Emergency stop overrides all motion

module SmartLift(
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

always @(posedge clk or posedge reset) begin
    if (reset) begin
        state         <= S_RESET;
        current_floor <= 3'd0;
        idle          <= 2'd1;
        door          <= 2'd0;
        Up            <= 2'd1;
        Down          <= 2'd0;
        requests      <= 8'd0;
        max_request   <= 3'd0;
        min_request   <= 3'd7;
    end
    else if (emergency_stop) begin
        state  <= S_EMERG;
        idle   <= 2'd0;
        door   <= 2'd0;
        Up     <= 2'd0;
        Down   <= 2'd0;
    end
    else begin
        case (state)
            S_RESET: begin
                state <= S_IDLE;
                idle  <= 2'd1;
            end

            S_IDLE: begin
                // Accept new floor request
                if (req_floor > current_floor) begin
                    state <= S_MOVE_UP;
                    idle  <= 2'd0;
                    door  <= 2'd0;
                    Up    <= 2'd1;
                    Down  <= 2'd0;
                end
                else if (req_floor < current_floor) begin
                    state <= S_MOVE_DN;
                    idle  <= 2'd0;
                    door  <= 2'd0;
                    Up    <= 2'd0;
                    Down  <= 2'd1;
                end
                else begin
                    // Already here — open door
                    state <= S_DOOR;
                    door  <= 2'd1;
                    idle  <= 2'd1;
                end
            end

            S_MOVE_UP: begin
                if (current_floor < req_floor)
                    current_floor <= current_floor + 1;
                else begin
                    state <= S_DOOR;
                    door  <= 2'd1;
                    Up    <= 2'd0;
                    idle  <= 2'd1;
                end
            end

            S_MOVE_DN: begin
                if (current_floor > req_floor)
                    current_floor <= current_floor - 1;
                else begin
                    state <= S_DOOR;
                    door  <= 2'd1;
                    Down  <= 2'd0;
                    idle  <= 2'd1;
                end
            end

            S_DOOR: begin
                // Door open — go back to IDLE for next request
                door  <= 2'd0;
                state <= S_IDLE;
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
