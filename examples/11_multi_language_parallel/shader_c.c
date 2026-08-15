#include <stdint.h>

// Fast math utilities
static inline float c_sin(float x) {
    while (x > 3.14159265f) x -= 6.2831853f;
    while (x < -3.14159265f) x += 6.2831853f;
    float x2 = x * x;
    return x * (1.0f - x2 * (0.16666667f - x2 * 0.00833333f));
}

static inline float c_cos(float x) {
    return c_sin(x + 1.57079632f);
}

static inline float c_sqrt(float n) {
    if (n <= 0.0f) return 0.0f;
    float x = n;
    for (int i = 0; i < 4; i++) {
        x = 0.5f * (x + n / x);
    }
    return x;
}

__attribute__((export_name("_start")))
void _start(uint8_t* pixels, uint32_t width, uint32_t height, float time, uint32_t startX, uint32_t startY, uint32_t endX, uint32_t endY) {
    float invW = 1.0f / (float)width;
    float invH = 1.0f / (float)height;

    for (uint32_t y = startY; y < endY; ++y) {
        float ny = (float)y * invH * 2.0f - 1.0f;
        for (uint32_t x = startX; x < endX; ++x) {
            float nx = (float)x * invW * 2.0f - 1.0f;

            float d = c_sqrt(nx * nx + ny * ny);
            float v1 = c_sin(nx * 5.0f + time * 1.8f);
            float v2 = c_sin(ny * 5.0f - time * 1.5f);
            float v3 = c_sin((nx + ny) * 4.0f + time * 1.1f);
            float v4 = c_sin(d * 12.0f - time * 3.5f);

            float val = (v1 + v2 + v3 + v4) * 0.25f; // [-1.0, 1.0]
            float norm = (val + 1.0f) * 0.5f;

            uint32_t idx = (y * width + x) * 4;
            pixels[idx + 0] = (uint8_t)(c_sin(norm * 3.14159f) * 240.0f + 15.0f);            // Red
            pixels[idx + 1] = (uint8_t)(c_sin(norm * 3.14159f + 2.094f) * 180.0f + 60.0f);   // Green
            pixels[idx + 2] = (uint8_t)(c_sin(norm * 3.14159f + 4.188f) * 230.0f + 25.0f);   // Blue
            pixels[idx + 3] = 255;
        }
    }
}
