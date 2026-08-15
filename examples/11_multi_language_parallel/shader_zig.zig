export fn _start(
    pixels: [*]u8,
    width: u32,
    height: u32,
    time: f32,
    startX: u32,
    startY: u32,
    endX: u32,
    endY: u32,
) void {
    const invW: f32 = 1.0 / @as(f32, @floatFromInt(width));
    const invH: f32 = 1.0 / @as(f32, @floatFromInt(height));

    var y = startY;
    while (y < endY) : (y += 1) {
        const ny = @as(f32, @floatFromInt(y)) * invH;
        var x = startX;
        while (x < endX) : (x += 1) {
            const nx = @as(f32, @floatFromInt(x)) * invW * 2.0 - 1.0;
            const idx = (y * width + x) * 4;

            if (ny < 0.5) {
                // Synthwave Sky & Glowing Horizon Sun
                const dy = ny - 0.46;
                const sunDist = @sqrt(nx * nx * 1.5 + dy * dy * 4.0);
                if (sunDist < 0.42) {
                    const stripe = @sin(dy * 120.0 + time * 3.0);
                    if (stripe > -0.15 or sunDist < 0.15) {
                        const glow = 1.0 - (sunDist / 0.42);
                        pixels[idx + 0] = 255;
                        pixels[idx + 1] = @intFromFloat(140.0 * glow + 40.0);
                        pixels[idx + 2] = 30;
                        pixels[idx + 3] = 255;
                        continue;
                    }
                }
                const skyGlow = (0.5 - ny) * 2.0;
                pixels[idx + 0] = @intFromFloat(20.0 + skyGlow * 35.0);
                pixels[idx + 1] = @intFromFloat(5.0 + skyGlow * 15.0);
                pixels[idx + 2] = @intFromFloat(50.0 + skyGlow * 90.0);
                pixels[idx + 3] = 255;
            } else {
                // 3D Perspective Road Grid
                const depth = 1.0 / (ny - 0.47);
                const gridX = (nx * depth * 3.5) + 5000.0;
                const gridZ = (depth * 2.5) - (time * 8.0) + 5000.0;

                const fracX = gridX - @as(f32, @floatFromInt(@as(u32, @intFromFloat(gridX))));
                const fracZ = gridZ - @as(f32, @floatFromInt(@as(u32, @intFromFloat(gridZ))));

                const isLine = (fracX < 0.09 or fracX > 0.91 or fracZ < 0.09 or fracZ > 0.91);
                if (isLine) {
                    const fade = 1.0 / (1.0 + depth * 0.08);
                    pixels[idx + 0] = @intFromFloat(255.0 * fade);
                    pixels[idx + 1] = 0;
                    pixels[idx + 2] = @intFromFloat(220.0 * fade);
                    pixels[idx + 3] = 255;
                } else {
                    pixels[idx + 0] = 8;
                    pixels[idx + 1] = 4;
                    pixels[idx + 2] = 22;
                    pixels[idx + 3] = 255;
                }
            }
        }
    }
}
