#include <stdint.h>
#include <stddef.h>

extern void* wextension(const char* name, void* ptr);

typedef struct {
    int32_t x, y;
    uint32_t buttons;
    int32_t wheel;
} MouseState;

#define MAX_W 800
#define MAX_H 600
static uint32_t vram[MAX_W * MAX_H];

void* get_framebuffer() {
    return vram;
}

#define RGBA32(r, g, b) (uint32_t)((0xFF << 24) | ((b) << 16) | ((g) << 8) | (r))

static void draw_rect(uint32_t w, uint32_t h, int x, int y, int rw, int rh, uint32_t color) {
    for (int iy = y; iy < y + rh; iy++) {
        if (iy < 0 || iy >= (int)h) continue;
        for (int ix = x; ix < x + rw; ix++) {
            if (ix >= 0 && ix < (int)w)
                vram[iy * w + ix] = color;
        }
    }
}

static int initialized = 0;
static uint8_t keys_buf[256];
static MouseState mouse_buf;
static uint8_t* keys = NULL;
static MouseState* mouse = NULL;

void* shader_main(uint32_t w, uint32_t h, void* custom_data) {
    if (w > MAX_W) w = MAX_W;
    if (h > MAX_H) h = MAX_H;

    if (!initialized) {
        keys = (uint8_t*)wextension("std:keyboard", keys_buf);
        mouse = (MouseState*)wextension("std:mouse", &mouse_buf);
        initialized = 1;
    }

    for (uint32_t i = 0; i < w * h; i++) vram[i] = RGBA32(51, 51, 51);

    int cols = 16, rows = 16, cell_w = 16, cell_h = 10;
    int margin_x = ((int)w - (cols * cell_w)) / 2;
    int margin_y = ((int)h - (rows * cell_h)) / 2;

    for (int i = 0; i < 256; i++) {
        int cx = i % cols, cy = i / cols;
        int px = margin_x + cx * cell_w, py = margin_y + cy * cell_h;
        uint32_t col = RGBA32(119, 119, 119);
        // Note: For headless gif generation, keys is always zeroed out, but the grid shows up.
        if (keys && keys[i]) col = RGBA32(0, 204, 85);
        draw_rect(w, h, px, py, cell_w - 1, cell_h - 1, col);
    }

    int mx = mouse ? mouse->x : 0;
    int my = mouse ? mouse->y : 0;
    uint32_t mbtns = mouse ? mouse->buttons : 0;

    // A headless gif has mouse at 0,0 by default. Let's make it bounce around if no input!
    static int dummy_mx = 100;
    static int dummy_my = 100;
    static int dummy_dx = 2;
    static int dummy_dy = 2;
    
    if (mx == 0 && my == 0) {
        dummy_mx += dummy_dx;
        dummy_my += dummy_dy;
        if (dummy_mx <= 0 || dummy_mx >= (int)w) dummy_dx = -dummy_dx;
        if (dummy_my <= 0 || dummy_my >= (int)h) dummy_dy = -dummy_dy;
        mx = dummy_mx;
        my = dummy_my;
    }

    draw_rect(w, h, mx - 2, my - 2, 5, 5, RGBA32(255, 255, 255));
    if (mbtns & 1) draw_rect(w, h, mx - 4, my - 4, 9, 9, RGBA32(255, 0, 0));

    return vram;
}
