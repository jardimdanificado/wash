#include <stdint.h>

// Pre-allocate enough memory for a 640x480 RGBA32 buffer.
// (640 * 480 * 4 = 1,228,800 bytes ~ 1.2MB)
#define MAX_W 640
#define MAX_H 480
static uint32_t vram[MAX_W * MAX_H];

// Simple XOR pattern state
static uint32_t frame_count = 0;

// Host calls this ONCE to know where the VRAM is statically located.
void* get_framebuffer() {
    return vram;
}

// Host calls this EVERY FRAME to render.
// Returns the pointer to the VRAM (same as get_framebuffer, for convenience).
void* shader_main(uint32_t w, uint32_t h, void* custom_data) {
    if (w > MAX_W) w = MAX_W;
    if (h > MAX_H) h = MAX_H;

    frame_count++;

    for (uint32_t y = 0; y < h; y++) {
        for (uint32_t x = 0; x < w; x++) {
            uint8_t r = (x ^ y) + frame_count;
            uint8_t g = (x ^ y) - frame_count;
            uint8_t b = (x + y + frame_count) % 256;
            uint8_t a = 255;
            
            // Format: RGBA32 Little Endian (ABGR in memory)
            vram[y * w + x] = (a << 24) | (b << 16) | (g << 8) | r;
        }
    }

    return vram;
}
