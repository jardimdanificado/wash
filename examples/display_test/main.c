// display_test — Tests drawing capabilities in V2 (RGBA8888)

#include <stdint.h>
#include <stddef.h>

#define MAX_W 800
#define MAX_H 600
static uint32_t vram[MAX_W * MAX_H];
static int frame_phase = 0;

void* get_framebuffer() {
    return vram;
}

static void set_pixel(uint32_t w, uint32_t h, int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    if (x < 0 || x >= (int)w || y < 0 || y >= (int)h) return;
    int idx = y * (int)w + x;
    vram[idx] = (0xFF << 24) | (b << 16) | (g << 8) | r;
}

static void fill_rect(uint32_t w, uint32_t h, int rx, int ry, int rw, int rh, uint8_t r, uint8_t g, uint8_t b) {
    for (int y = ry; y < ry + rh; y++)
        for (int x = rx; x < rx + rw; x++)
            set_pixel(w, h, x, y, r, g, b);
}

static void clear_screen(uint32_t w, uint32_t h, uint8_t r, uint8_t g, uint8_t b) {
    fill_rect(w, h, 0, 0, (int)w, (int)h, r, g, b);
}

static void draw_color_bars(uint32_t w, uint32_t h) {
    int bar_w = (int)w / 8;
    uint8_t colors[8][3] = {
        {255,255,255}, {255,255,0}, {0,255,255}, {0,255,0},
        {255,0,255}, {255,0,0}, {0,0,255}, {0,0,0}
    };
    for (int i = 0; i < 8; i++) {
        fill_rect(w, h, i * bar_w, 0, bar_w, (int)h - 30,
                  colors[i][0], colors[i][1], colors[i][2]);
    }
}

static void draw_grid(uint32_t w, uint32_t h) {
    for (int x = 0; x < (int)w; x += 32) {
        for (int y = 0; y < (int)h; y++)
            set_pixel(w, h, x, y, 128, 128, 128);
    }
    for (int y = 0; y < (int)h; y += 32) {
        for (int x = 0; x < (int)w; x++)
            set_pixel(w, h, x, y, 128, 128, 128);
    }
}

static void draw_status(uint32_t w, uint32_t h) {
    fill_rect(w, h, 0, (int)h - 30, (int)w, 30, 0, 0, 0);
    fill_rect(w, h, 5, (int)h - 25, 20, 20, 255, 255, 255);
    fill_rect(w, h, 35, (int)h - 25, 10, 10, 255, 255, 255);
    fill_rect(w, h, 50, (int)h - 25, 10, 10, 200, 200, 200);
}

void* shader_main(uint32_t w, uint32_t h, void* custom_data) {
    if (w > MAX_W) w = MAX_W;
    if (h > MAX_H) h = MAX_H;

    frame_phase++;

    clear_screen(w, h, 32, 32, 32);
    draw_color_bars(w, h);
    draw_grid(w, h);
    draw_status(w, h);

    int ax = (frame_phase * 3) % (int)w;
    fill_rect(w, h, ax, 10, 20, 20, 255, 200, 0);

    return vram;
}
