module main

@[export: 'v_start']
pub fn v_start(pixels &u8, width u32, height u32, time f32, start_x u32, start_y u32, end_x u32, end_y u32) {
	t := u32(time * 20.0)
	unsafe {
		for y in start_y .. end_y {
			for x in start_x .. end_x {
				idx := (y * width + x) * 4
				cx := int(x) - int(width / 2)
				cy := int(y) - int(height / 2)
				dist := u32((cx * cx + cy * cy) >> 6)
				
				v1 := (x * 7 + t * 2) & 255
				v2 := (y * 5 - t * 3) & 255
				cell := (v1 ^ v2 ^ dist) & 255

				pixels[idx + 0] = u8((cell * 2) & 255)
				pixels[idx + 1] = u8(160 + (cell >> 2))
				pixels[idx + 2] = u8(210 + (cell >> 3))
				pixels[idx + 3] = 255
			}
		}
	}
}
