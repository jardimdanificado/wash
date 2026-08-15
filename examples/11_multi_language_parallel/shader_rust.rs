// Rust Shader for Wash Universal WebAssembly Engine
// Compiles with: rustc --target wasm32-unknown-unknown -O --crate-type=cdylib shader_rust.rs -o shader_rust.wasm

#[no_mangle]
pub extern "C" fn _start(
    pixels: *mut u8,
    width: u32,
    height: u32,
    time: f32,
    start_x: u32,
    start_y: u32,
    end_x: u32,
    end_y: u32,
) {
    let inv_w = 1.0f32 / (width as f32);
    let inv_h = 1.0f32 / (height as f32);

    let cos_t = fast_cos(time * 1.2);
    let sin_t = fast_sin(time * 1.2);

    for y in start_y..end_y {
        let ny = (y as f32) * inv_h * 2.0 - 1.0;
        for x in start_x..end_x {
            let nx = (x as f32) * inv_w * 2.0 - 1.0;

            // 3D Ray Direction
            let ro_x = 0.0f32;
            let ro_y = 0.0f32;
            let ro_z = -2.5f32;

            let mut rd_x = nx;
            let mut rd_y = ny;
            let mut rd_z = 1.5f32;
            let rd_len = fast_sqrt(rd_x * rd_x + rd_y * rd_y + rd_z * rd_z);
            rd_x /= rd_len;
            rd_y /= rd_len;
            rd_z /= rd_len;

            // Raymarch SDF Torus
            let mut t = 0.0f32;
            let mut hit = false;
            let mut p_x = 0.0f32;
            let mut p_y = 0.0f32;
            let mut p_z = 0.0f32;

            for _ in 0..24 {
                p_x = ro_x + rd_x * t;
                p_y = ro_y + rd_y * t;
                p_z = ro_z + rd_z * t;

                // Rotate around Y and X axes
                let rx = p_x * cos_t - p_z * sin_t;
                let rz = p_x * sin_t + p_z * cos_t;
                let ry = p_y * cos_t - rz * sin_t;
                let rz2 = p_y * sin_t + rz * cos_t;

                // Torus SDF: R=0.8, r=0.25
                let q_x = fast_sqrt(rx * rx + rz2 * rz2) - 0.75;
                let d = fast_sqrt(q_x * q_x + ry * ry) - 0.28;

                if d < 0.005 {
                    hit = true;
                    break;
                }
                t += d;
                if t > 5.0 {
                    break;
                }
            }

            let idx = ((y * width + x) * 4) as usize;
            unsafe {
                if hit {
                    let normal_glow = 1.0 - (t / 5.0);
                    let r = ((240.0 * normal_glow + 15.0) as u8).min(255);
                    let g = ((160.0 * normal_glow * (nx.abs() + 0.2)) as u8).min(255);
                    let b = ((255.0 * normal_glow) as u8).min(255);

                    *pixels.add(idx + 0) = r;
                    *pixels.add(idx + 1) = g;
                    *pixels.add(idx + 2) = b;
                    *pixels.add(idx + 3) = 255;
                } else {
                    let bg = (20.0 * (1.0 - (nx * nx + ny * ny).min(1.0))) as u8;
                    *pixels.add(idx + 0) = bg + 5;
                    *pixels.add(idx + 1) = bg + 8;
                    *pixels.add(idx + 2) = bg + 22;
                    *pixels.add(idx + 3) = 255;
                }
            }
        }
    }
}

fn fast_sin(mut x: f32) -> f32 {
    while x > 3.14159265 { x -= 6.2831853; }
    while x < -3.14159265 { x += 6.2831853; }
    let x2 = x * x;
    x * (1.0 - x2 * (0.16666667 - x2 * 0.00833333))
}

fn fast_cos(x: f32) -> f32 {
    fast_sin(x + 1.57079632)
}

fn fast_sqrt(n: f32) -> f32 {
    if n <= 0.0 { return 0.0; }
    let mut x = n;
    for _ in 0..4 {
        x = 0.5 * (x + n / x);
    }
    x
}
