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

__attribute__((export_name("_start")))
void* _start(uint8_t* pixels, uint32_t width, uint32_t height, float mouseX, float mouseY, uint32_t num_particles) {
    if (num_particles == 0) num_particles = 20000;
    
    // The particles reside in memory right after the pixel buffer
    Particle* particles = (Particle*)(pixels + width * height * 4);

    static int initialized = 0;

    // Maintain state across frames
    if (!initialized) {
        uint32_t seed = 42;
        for (uint32_t i = 0; i < num_particles; ++i) {
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

    // Clear background to dark gray (Little Endian: A B G R)
    uint32_t* p32 = (uint32_t*)pixels;
    for (uint32_t i = 0; i < width * height; ++i) {
        p32[i] = 0xFF111111; 
    }

    float mx = mouseX * width;
    float my = mouseY * height;

    // Update and draw particles
    for (uint32_t i = 0; i < num_particles; ++i) {
        // Gravity towards mouse
        float dx = mx - particles[i].x;
        float dy = my - particles[i].y;
        float dist_sq = dx*dx + dy*dy;
        
        if (dist_sq > 10.0f) {
            float dist = __builtin_sqrtf(dist_sq);
            float force = 100.0f / dist_sq;
            if (force > 0.5f) force = 0.5f; // clamp max force
            
            particles[i].vx += (dx / dist) * force;
            particles[i].vy += (dy / dist) * force;
        }

        // Apply friction
        particles[i].vx *= 0.985f;
        particles[i].vy *= 0.985f;

        // Move
        particles[i].x += particles[i].vx;
        particles[i].y += particles[i].vy;

        // Screen wrap
        if (particles[i].x < 0) particles[i].x += width;
        if (particles[i].x >= width) particles[i].x -= width;
        if (particles[i].y < 0) particles[i].y += height;
        if (particles[i].y >= height) particles[i].y -= height;

        // Draw particle (single pixel)
        int px = (int)particles[i].x;
        int py = (int)particles[i].y;
        
        if (px >= 0 && px < (int)width && py >= 0 && py < (int)height) {
            uint32_t p_offset = (py * width + px) * 4;
            pixels[p_offset + 0] = (uint8_t)(particles[i].r * 255);
            pixels[p_offset + 1] = (uint8_t)(particles[i].g * 255);
            pixels[p_offset + 2] = (uint8_t)(particles[i].b * 255);
            pixels[p_offset + 3] = 255;
        }
    }
    return 0;
}
