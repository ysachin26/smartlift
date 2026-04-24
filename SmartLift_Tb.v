`timescale 1ns/1ps
module SmartLift_Tb();
  reg clk=0, reset=1, emergency_stop=0;
  reg [2:0] req_floor = 0;
  wire [2:0] current_floor;
  wire [1:0] idle, door, Up, Down;
  wire [7:0] requests;
  wire [2:0] max_request, min_request;

  SmartLift dut(
    clk, reset, req_floor,
    idle, door, Up, Down,
    current_floor, requests,
    max_request, min_request, emergency_stop
  );

  initial begin
    $dumpfile("waveform.vcd");
    $dumpvars(0, SmartLift_Tb);
    #10 reset = 0;
    #5  req_floor = 3; // Request floor 3
    #80 ; // Travel time for floor 3
    #5  req_floor = 1; // Request floor 1
    #80 ; // Travel time for floor 1
    #20 $finish;
  end

  always #5 clk = ~clk; // 100MHz clock (10ns period)
endmodule