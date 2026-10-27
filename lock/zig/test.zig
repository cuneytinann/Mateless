// Tests lock.zig on ../positions.tsv:  zig run test.zig -O ReleaseFast -- [positions.tsv]
const std = @import("std");
const lock = @import("lock.zig");

pub fn main(init: std.process.Init) !void {
    const arena = init.arena.allocator();
    const args = try init.minimal.args.toSlice(arena);
    const path = if (args.len > 1) args[1] else "../positions.tsv";
    const text = try std.Io.Dir.cwd().readFileAlloc(init.io, path, arena, .unlimited);
    var buffer: [4096]u8 = undefined;
    var stdout: std.Io.File.Writer = .init(.stdout(), init.io, &buffer);
    const out = &stdout.interface;
    var n: usize = 0;
    var bad: usize = 0;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |line| {
        if (line.len == 0 or line[0] == '#') continue;
        var fields = std.mem.splitScalar(u8, line, '\t');
        const fen = fields.first();
        const white = std.mem.eql(u8, fields.next().?, "1");
        const black = std.mem.eql(u8, fields.next().?, "1");
        const p = lock.fromFen(fen);
        const w = lock.cannotBeMated(p, true);
        const b = lock.cannotBeMated(p, false);
        if (w != white or b != black) {
            bad += 1;
            if (bad <= 10) try out.print("wrong: {s} expected {d} {d} got {d} {d}\n", .{
                fen, @intFromBool(white), @intFromBool(black), @intFromBool(w), @intFromBool(b),
            });
        }
        n += 1;
    }
    try out.print("zig: {d} positions, {d} wrong\n", .{ n, bad });
    try out.flush();
    std.process.exit(if (bad > 0) 1 else 0);
}
