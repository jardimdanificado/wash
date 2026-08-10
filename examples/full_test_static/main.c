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

static int frame_count = 0;
static int initialized = 0;
static uint8_t keys_buf[256];
static MouseState mouse_buf;
static uint8_t* keys = NULL;
static MouseState* mouse = NULL;

static void set_pixel(uint32_t w, uint32_t h, int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    if (x < 0 || x >= (int)w || y < 0 || y >= (int)h) return;
    vram[y * w + x] = RGBA32(r, g, b);
}

static void fill_rect(uint32_t w, uint32_t h, int rx, int ry, int rw, int rh, uint8_t r, uint8_t g, uint8_t b) {
    for (int y = ry; y < ry + rh; y++)
        for (int x = rx; x < rx + rw; x++)
            set_pixel(w, h, x, y, r, g, b);
}

static void clear(uint32_t w, uint32_t h, uint8_t r, uint8_t g, uint8_t b) {
    fill_rect(w, h, 0, 0, (int)w, (int)h, r, g, b);
}

static const uint8_t font5x7[10][7] = {
    {0x0E,0x11,0x13,0x15,0x19,0x11,0x0E},
    {0x04,0x0C,0x04,0x04,0x04,0x04,0x0E},
    {0x0E,0x11,0x01,0x06,0x08,0x10,0x1F},
    {0x1F,0x02,0x04,0x02,0x01,0x11,0x0E},
    {0x02,0x06,0x0A,0x12,0x1F,0x02,0x02},
    {0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E},
    {0x06,0x08,0x10,0x1E,0x11,0x11,0x0E},
    {0x1F,0x01,0x02,0x04,0x08,0x08,0x08},
    {0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E},
    {0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C},
};

static void draw_digit(uint32_t w, uint32_t h, int x, int y, int d, uint8_t r, uint8_t g, uint8_t b) {
    if (d < 0 || d > 9) return;
    for (int row = 0; row < 7; row++)
        for (int col = 0; col < 5; col++)
            if (font5x7[d][row] & (0x10 >> col))
                set_pixel(w, h, x + col, y + row, r, g, b);
}

static void draw_number(uint32_t w, uint32_t h, int x, int y, int n, uint8_t r, uint8_t g, uint8_t b) {
    if (n == 0) { draw_digit(w, h, x, y, 0, r, g, b); return; }
    char buf[12]; int len = 0;
    while (n > 0 && len < 12) { buf[len++] = n % 10; n /= 10; }
    for (int i = len - 1; i >= 0; i--) { draw_digit(w, h, x, y, buf[i], r, g, b); x += 6; }
}

static void draw_keyboard(uint32_t w, uint32_t h, int ox, int oy, int qw, int qh) {
    int cols = 8, rows = 8;
    int cell_w = qw / (cols + 1), cell_h = qh / (rows + 2);
    int start_key = (frame_count / 120) % 3;

    for (int i = 0; i < 64; i++) {
        int key_idx = start_key * 64 + i;
        if (key_idx >= 256) break;
        int cx = i % cols, cy = i / cols;
        int px = ox + 4 + cx * cell_w, py = oy + 12 + cy * cell_h;
        int is_pressed = keys && keys[key_idx];
        uint8_t cr = is_pressed ? 0 : 50;
        uint8_t cg = is_pressed ? 200 : 50;
        uint8_t cb = is_pressed ? 80 : 60;
        fill_rect(w, h, px, py, cell_w - 1, cell_h - 1, cr, cg, cb);
    }
}

static int anim_x = 0, anim_y = 0, anim_dx = 2, anim_dy = 1;

static void draw_dirty_anim(uint32_t w, uint32_t h, int ox, int oy, int qw, int qh) {
    anim_x += anim_dx; anim_y += anim_dy;
    if (anim_x <= 0 || anim_x + 15 >= qw) anim_dx = -anim_dx;
    if (anim_y <= 0 || anim_y + 15 >= qh) anim_dy = -anim_dy;

    for (int y = 0; y < qh; y += 8)
        for (int x = 0; x < qw; x += 8)
            fill_rect(w, h, ox + x, oy + y, 7, 7,
                      ((x / 8 + y / 8) % 2) ? 40 : 25,
                      ((x / 8 + y / 8) % 2) ? 40 : 25,
                      ((x / 8 + y / 8) % 2) ? 50 : 35);

    fill_rect(w, h, ox + anim_x, oy + anim_y, 15, 15, 255, 200, 0);
    fill_rect(w, h, ox + anim_x - anim_dx, oy + anim_y - anim_dy, 5, 5, 100, 80, 0);
}

static void draw_mouse(uint32_t w, uint32_t h, int ox, int oy, int qw, int qh) {
    int mx = mouse ? mouse->x : 0;
    int my = mouse ? mouse->y : 0;
    uint32_t mbtns = mouse ? mouse->buttons : 0;
    int mwheel = mouse ? mouse->wheel : 0;

    int cx = ox + (mx * qw) / (int)w;
    int cy = oy + (my * qh) / (int)h;

    for (int x = ox; x < ox + qw; x++) set_pixel(w, h, x, cy, 60, 60, 80);
    for (int y = oy; y < oy + qh; y++) set_pixel(w, h, cx, y, 60, 60, 80);

    fill_rect(w, h, cx - 2, cy - 2, 5, 5, 255, 255, 255);

    uint8_t lb = (mbtns & 1) ? 255 : 80;
    fill_rect(w, h, ox + 2, oy + qh - 12, 15, 10, lb, 30, 30);

    uint8_t rb = (mbtns & 2) ? 100 : 80;
    fill_rect(w, h, ox + 22, oy + qh - 12, 15, 10, 30, 30, rb);

    draw_number(w, h, ox + 45, oy + qh - 12, mwheel, 255, 255, 0);
}

void* shader_main(uint32_t w, uint32_t h, void* custom_data) {
    if (w > MAX_W) w = MAX_W;
    if (h > MAX_H) h = MAX_H;

    if (!initialized) {
        keys = (uint8_t*)wextension("std:keyboard", keys_buf);
        mouse = (MouseState*)wextension("std:mouse", &mouse_buf);
        initialized = 1;
    }

    frame_count++;

    clear(w, h, 15, 15, 20);

    fill_rect(w, h, w/2, 0, 1, h, 60, 60, 80);
    fill_rect(w, h, 0, h/2, w, 1, 60, 60, 80);

    draw_keyboard(w, h, 0, 0, w/2, h/2);
    draw_dirty_anim(w, h, w/2 + 1, 0, w/2 - 1, h/2);
    draw_mouse(w, h, 0, h/2 + 1, w/2, h/2 - 1);

    return vram;
}
