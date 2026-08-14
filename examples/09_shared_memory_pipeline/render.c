#include <stdint.h>

/**
 * Shader 2: Particle Rasterizer & Post-Processing Kernel
 *
 * Reads particles from the shared memory buffer and rasterizes them
 * with motion blur, particle blending, and color palette.
 * Takes both particles and pixel buffers directly as typed parameters!
 */

typedef struct {
    float x, y;
    float vx, vy;
    float life;
} Particle;

static inline uint32_t clamp_u8(int v) {
    if (v < 0) return 0;
    if (v > 255) return 255;
    return (uint32_t)v;
}

__attribute__((export_name("_start")))
void* _start(
    const Particle* particles,
    uint8_t* pixels,
    uint32_t width,
    uint32_t height,
    uint32_t num_particles
) {
    // 1. Motion Blur / Fade background trails
    uint32_t total_pixels = width * height;
    for (uint32_t i = 0; i < total_pixels; ++i) {
        uint32_t off = i * 4;
        // Fade existing pixels by ~15% for trail effects
        pixels[off + 0] = (uint8_t)((pixels[off + 0] * 215) >> 8);
        pixels[off + 1] = (uint8_t)((pixels[off + 1] * 215) >> 8);
        pixels[off + 2] = (uint8_t)((pixels[off + 2] * 225) >> 8);
        pixels[off + 3] = 255;
    }

    // 2. Rasterize particles with glowing additive circles
    for (uint32_t i = 0; i < num_particles; ++i) {
        const Particle* p = &particles[i];
        int px = (int)p->x;
        int py = (int)p->y;

        if (px < 1 || px >= (int)width - 1 || py < 1 || py >= (int)height - 1) continue;

        // Speed-based color gradient: cyan -> magenta -> white
        float speed = __builtin_sqrtf(p->vx * p->vx + p->vy * p->vy);
        uint8_t r = (uint8_t)(speed * 35.0f);
        uint8_t g = (uint8_t)(140.0f + p->life * 100.0f);
        uint8_t b = (uint8_t)(255.0f * (1.0f - p->life * 0.3f));

        // Additive stamp (3x3 kernel)
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                uint32_t p_off = ((py + dy) * width + (px + dx)) * 4;
                int weight = (dx == 0 && dy == 0) ? 255 : 90;
                
                pixels[p_off + 0] = (uint8_t)clamp_u8(pixels[p_off + 0] + ((r * weight) >> 8));
                pixels[p_off + 1] = (uint8_t)clamp_u8(pixels[p_off + 1] + ((g * weight) >> 8));
                pixels[p_off + 2] = (uint8_t)clamp_u8(pixels[p_off + 2] + ((b * weight) >> 8));
                pixels[p_off + 3] = 255;
            }
        }
    }

    return 0;
}
