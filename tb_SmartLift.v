`timescale 1ns / 1ps
module SmartLift_tb;
    reg clk;
    reg reset;
    reg [2:0] req_floor;
    reg emergency_stop;
    wire [1:0] idle;
    wire [1:0] door;
    wire [1:0] Up;
    wire [1:0] Down;
    wire [2:0] current_floor;
    wire [7:0] requests;
    wire [2:0] max_request;
    wire [2:0] min_request;

    SmartLift uut (
        .clk(clk),
        .reset(reset),
        .req_floor(req_floor),
        .idle(idle),
        .door(door),
        .Up(Up),
        .Down(Down),
        .current_floor(current_floor),
        .requests(requests),
        .max_request(max_request),
        .min_request(min_request),
        .emergency_stop(emergency_stop)
    );

    initial begin
        clk = 0;
        forever #5 clk = ~clk;
    end

    initial begin
        reset = 1;
        req_floor = 0;
        emergency_stop = 0;
        #20 reset = 0;
        #10 req_floor = 3'd5;
        #100 req_floor = 3'd2;
        #100 emergency_stop = 1;
        #50 $finish;
    end

    initial begin
        $monitor("At time %t, state: floor=%d, reqs=%b, up=%b, dwn=%b, door=%b", $time, current_floor, requests, Up, Down, door);
    end
endmodule
