#include <stdint.h>

typedef struct {
    float x, y;
    float vx, vy;
    float r, g, b;
} Particle;

// Simple LCG PRNG for initializing particles
static float get_random_local(uint32_t *seed) {
    *seed = *seed * 1664525 + 1013904223;
    return (float)(*seed & 0xFFFFFF) / (float)0xFFFFFF;
}

void* _start(uint8_t* data) {
    uint32_t width = *(uint32_t*)(data + 0);
    uint32_t height = *(uint32_t*)(data + 4);
    float mouseX = *(float*)(data + 12);
    float mouseY = *(float*)(data + 16);
    
    uint8_t* pixels = data + 20;
    
    // The particles reside in memory right after the pixel buffer
    Particle* particles = (Particle*)(data + 20 + width * height * 4);

    static int initialized = 0;
    int num_particles = 20000;

    // We can maintain state because WASM memory persists between frames!
    if (!initialized) {
        uint32_t seed = 42;
        for (int i = 0; i < num_particles; ++i) {
            particles[i].x = get_random_local(&seed) * width;
            particles[i].y = get_random_local(&seed) * height;
            particles[i].vx = (get_random_local(&seed) - 0.5f) * 2.0f;
            particles[i].vy = (get_random_local(&seed) - 0.5f) * 2.0f;
            particles[i].r = 0.5f + get_random_local(&seed) * 0.5f;
            particles[i].g = 0.5f + get_random_local(&seed) * 0.5f;
            particles[i].b = 0.5f + get_random_local(&seed) * 0.5f;
        }
        initialized = 1;
    }

    // Clear background to dark gray
    // We write 32 bits at a time for speed (Little Endian: A B G R)
    uint32_t* p32 = (uint32_t*)pixels;
    for (uint32_t i = 0; i < width * height; ++i) {
        p32[i] = 0xFF111111; 
    }

    float mx = mouseX * width;
    float my = mouseY * height;

    // Update and draw particles
    for (int i = 0; i < num_particles; ++i) {
        // Gravity towards mouse
        float dx = mx - particles[i].x;
        float dy = my - particles[i].y;
        float dist_sq = dx*dx + dy*dy;
        
        if (dist_sq > 1.0f) {
            float dist = __builtin_sqrtf(dist_sq);
            particles[i].vx += (dx / dist) * 0.15f;
            particles[i].vy += (dy / dist) * 0.15f;
        }

        // Friction / drag
        particles[i].vx *= 0.98f;
        particles[i].vy *= 0.98f;

        // Move
        particles[i].x += particles[i].vx;
        particles[i].y += particles[i].vy;

        // Bounce off walls
        if (particles[i].x < 0) { particles[i].x = 0; particles[i].vx *= -0.8f; }
        if (particles[i].x >= width) { particles[i].x = width - 1; particles[i].vx *= -0.8f; }
        if (particles[i].y < 0) { particles[i].y = 0; particles[i].vy *= -0.8f; }
        if (particles[i].y >= height) { particles[i].y = height - 1; particles[i].vy *= -0.8f; }

        // Draw pixel (additive blending)
        int px = (int)particles[i].x;
        int py = (int)particles[i].y;
        if (px >= 0 && px < width && py >= 0 && py < height) {
            uint32_t offset = (py * width + px) * 4;
            int r = pixels[offset + 0] + (int)(particles[i].r * 60);
            int g = pixels[offset + 1] + (int)(particles[i].g * 60);
            int b = pixels[offset + 2] + (int)(particles[i].b * 60);
            pixels[offset + 0] = r > 255 ? 255 : r;
            pixels[offset + 1] = g > 255 ? 255 : g;
            pixels[offset + 2] = b > 255 ? 255 : b;
        }
    }
    return 0;
}
