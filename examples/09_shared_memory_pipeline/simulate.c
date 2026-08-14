#include <stdint.h>

/**
 * Shader 1: Particle Physics Simulation Kernel
 *
 * Reads & updates particle dynamics (positions, velocities, lifetimes)
 * in the shared heap buffer. Does NOT know anything about pixel rendering!
 * Uniforms are received directly as typed arguments.
 */

typedef struct {
    float x, y;
    float vx, vy;
    float life;
} Particle;

static uint32_t pcg_hash(uint32_t input) {
    uint32_t state = input * 747796405u + 2891336453u;
    uint32_t word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

static float rand_f(uint32_t *seed) {
    *seed = pcg_hash(*seed);
    return (float)(*seed) / 4294967296.0f;
}

static float sin_fast(float x) {
    float k = (int)(x * 0.1591549f);
    x = x - k * 6.2831853f;
    if (x < -3.14159265f) x += 6.2831853f;
    if (x >  3.14159265f) x -= 6.2831853f;
    float abs_x = x < 0 ? -x : x;
    return (16.0f * x * (3.14159265f - abs_x)) / (49.348022f - 4.0f * abs_x * (3.14159265f - abs_x));
}

static float cos_fast(float x) {
    return sin_fast(x + 1.5707963f);
}

__attribute__((export_name("_start")))
void* _start(
    Particle* particles,
    uint32_t width,
    uint32_t height,
    uint32_t num_particles,
    float mouse_x,
    float mouse_y,
    uint32_t is_down,
    uint32_t frame_count
) {
    float cx = (float)width * 0.5f;
    float cy = (float)height * 0.5f;
    float target_x = mouse_x * (float)width;
    float target_y = mouse_y * (float)height;

    uint32_t seed = frame_count * 1664525u + 1013904223u;

    for (uint32_t i = 0; i < num_particles; ++i) {
        Particle* p = &particles[i];

        // Respawn dead or out-of-bounds particles
        if (p->life <= 0.0f || frame_count == 0) {
            float angle = rand_f(&seed) * 6.2831853f;
            float radius = 10.0f + rand_f(&seed) * 60.0f;
            p->x = cx + cos_fast(angle) * radius;
            p->y = cy + sin_fast(angle) * radius;

            // Initial orbital velocity
            float speed = 1.0f + rand_f(&seed) * 2.5f;
            p->vx = -sin_fast(angle) * speed;
            p->vy = cos_fast(angle) * speed;
            p->life = 0.5f + rand_f(&seed) * 0.5f;
        }

        // Gravity well towards mouse / center
        float gx = is_down ? (target_x - p->x) : (cx - p->x);
        float gy = is_down ? (target_y - p->y) : (cy - p->y);
        float dist_sq = gx * gx + gy * gy + 100.0f;
        float dist = __builtin_sqrtf(dist_sq);

        float gravity_force = (is_down ? 1800.0f : 850.0f) / dist_sq;
        if (gravity_force > 1.2f) gravity_force = 1.2f;

        p->vx += (gx / dist) * gravity_force;
        p->vy += (gy / dist) * gravity_force;

        // Vortex tangential acceleration
        float perp_x = -gy / dist;
        float perp_y = gx / dist;
        p->vx += perp_x * 0.12f;
        p->vy += perp_y * 0.12f;

        // Damping / drag
        p->vx *= 0.985f;
        p->vy *= 0.985f;

        // Euler integration
        p->x += p->vx;
        p->y += p->vy;
        p->life -= 0.003f;

        // Boundary wrap
        if (p->x < 0) p->x += (float)width;
        if (p->x >= (float)width) p->x -= (float)width;
        if (p->y < 0) p->y += (float)height;
        if (p->y >= (float)height) p->y -= (float)height;
    }

    return 0;
}
