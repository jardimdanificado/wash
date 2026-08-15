#include <stdint.h>

static inline float r_sin(float x) {
    while (x > 3.14159265f) x -= 6.2831853f;
    while (x < -3.14159265f) x += 6.2831853f;
    float x2 = x * x;
    return x * (1.0f - x2 * (0.16666667f - x2 * 0.00833333f));
}

static inline float r_cos(float x) {
    return r_sin(x + 1.57079632f);
}

static inline float r_sqrt(float n) {
    if (n <= 0.0f) return 0.0f;
    float x = n;
    for (int i = 0; i < 4; i++) {
        x = 0.5f * (x + n / x);
    }
    return x;
}

static inline float r_abs(float x) {
    return x < 0.0f ? -x : x;
}

__attribute__((export_name("_start")))
void _start(uint8_t* pixels, uint32_t width, uint32_t height, float time, uint32_t startX, uint32_t startY, uint32_t endX, uint32_t endY) {
    float inv_w = 1.0f / (float)width;
    float inv_h = 1.0f / (float)height;

    float cos_t = r_cos(time * 1.4f);
    float sin_t = r_sin(time * 1.4f);

    for (uint32_t y = startY; y < endY; ++y) {
        float ny = (float)y * inv_h * 2.0f - 1.0f;
        for (uint32_t x = startX; x < endX; ++x) {
            float nx = (float)x * inv_w * 2.0f - 1.0f;

            float ro_x = 0.0f, ro_y = 0.0f, ro_z = -2.6f;
            float rd_x = nx, rd_y = ny, rd_z = 1.5f;
            float rd_len = r_sqrt(rd_x * rd_x + rd_y * rd_y + rd_z * rd_z);
            rd_x /= rd_len; rd_y /= rd_len; rd_z /= rd_len;

            float t = 0.0f;
            int hit = 0;
            for (int step = 0; step < 26; step++) {
                float px = ro_x + rd_x * t;
                float py = ro_y + rd_y * t;
                float pz = ro_z + rd_z * t;

                float rx = px * cos_t - pz * sin_t;
                float rz = px * sin_t + pz * cos_t;
                float ry = py * cos_t - rz * sin_t;
                float rz2 = py * sin_t + rz * cos_t;

                float qx = r_sqrt(rx * rx + rz2 * rz2) - 0.75f;
                float d = r_sqrt(qx * qx + ry * ry) - 0.28f;

                if (d < 0.006f) {
                    hit = 1;
                    break;
                }
                t += d;
                if (t > 5.0f) break;
            }

            uint32_t idx = (y * width + x) * 4;
            if (hit) {
                float normal_glow = 1.0f - (t / 5.0f);
                if (normal_glow < 0.0f) normal_glow = 0.0f;
                float r = 240.0f * normal_glow + 15.0f;
                float g = 170.0f * normal_glow * (r_abs(nx) + 0.3f);
                float b = 255.0f * normal_glow;

                pixels[idx + 0] = (uint8_t)(r > 255.0f ? 255 : r);
                pixels[idx + 1] = (uint8_t)(g > 255.0f ? 255 : g);
                pixels[idx + 2] = (uint8_t)(b > 255.0f ? 255 : b);
                pixels[idx + 3] = 255;
            } else {
                float dist_c = nx * nx + ny * ny;
                if (dist_c > 1.0f) dist_c = 1.0f;
                uint8_t bg = (uint8_t)(25.0f * (1.0f - dist_c));
                pixels[idx + 0] = bg + 6;
                pixels[idx + 1] = bg + 8;
                pixels[idx + 2] = bg + 24;
                pixels[idx + 3] = 255;
            }
        }
    }
}
