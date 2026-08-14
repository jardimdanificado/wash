/**
 * Wash Studio - Built-in Multi-Shader Project Presets
 */

export const PRESETS = {
  pipeline: {
    name: "01. Shared Memory Multi-Shader Pipeline (2 Shaders)",
    description: "Two separate C shaders (simulate.c and render.c) communicating seamlessly on a single shared memory buffer.",
    tabs: [
      {
        id: "simulate",
        name: "simulate.c",
        type: "c",
        code: `#include <stdint.h>

/**
 * Shader 1: Particle Dynamics Simulation
 * Reads and updates 8,000 orbital particles in the shared memory buffer.
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

static float sqrt_fast(float x) {
    if (x <= 0.0f) return 0.0f;
    float guess = x * 0.5f;
    for (int i = 0; i < 6; ++i) {
        guess = 0.5f * (guess + x / guess);
    }
    return guess;
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

        if (p->life <= 0.0f || frame_count == 0) {
            float angle = rand_f(&seed) * 6.2831853f;
            float radius = 10.0f + rand_f(&seed) * 80.0f;
            p->x = cx + cos_fast(angle) * radius;
            p->y = cy + sin_fast(angle) * radius;

            float speed = 1.0f + rand_f(&seed) * 2.5f;
            p->vx = -sin_fast(angle) * speed;
            p->vy = cos_fast(angle) * speed;
            p->life = 0.5f + rand_f(&seed) * 0.5f;
        }

        float gx = is_down ? (target_x - p->x) : (cx - p->x);
        float gy = is_down ? (target_y - p->y) : (cy - p->y);
        float dist_sq = gx * gx + gy * gy + 100.0f;
        float dist = sqrt_fast(dist_sq);

        float gravity_force = (is_down ? 1800.0f : 850.0f) / dist_sq;
        if (gravity_force > 1.2f) gravity_force = 1.2f;

        p->vx += (gx / dist) * gravity_force;
        p->vy += (gy / dist) * gravity_force;

        // Vortex tangential force
        p->vx += (-gy / dist) * 0.12f;
        p->vy += (gx / dist) * 0.12f;

        p->vx *= 0.985f;
        p->vy *= 0.985f;

        p->x += p->vx;
        p->y += p->vy;
        p->life -= 0.003f;

        if (p->x < 0) p->x += (float)width;
        if (p->x >= (float)width) p->x -= (float)width;
        if (p->y < 0) p->y += (float)height;
        if (p->y >= (float)height) p->y -= (float)height;
    }

    return 0;
}
`
      },
      {
        id: "render",
        name: "render.c",
        type: "c",
        code: `#include <stdint.h>

/**
 * Shader 2: Particle Rasterizer & Trail Post-FX
 * Reads particles from shared memory and draws luminous trails directly to RGBA pixels.
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

static float sqrt_fast(float x) {
    if (x <= 0.0f) return 0.0f;
    float guess = x * 0.5f;
    for (int i = 0; i < 5; ++i) {
        guess = 0.5f * (guess + x / guess);
    }
    return guess;
}

__attribute__((export_name("_start")))
void* _start(
    const Particle* particles,
    uint8_t* pixels,
    uint32_t width,
    uint32_t height,
    uint32_t num_particles
) {
    // 1. Trail decay effect
    uint32_t total_pixels = width * height;
    for (uint32_t i = 0; i < total_pixels; ++i) {
        uint32_t off = i * 4;
        pixels[off + 0] = (uint8_t)((pixels[off + 0] * 215) >> 8);
        pixels[off + 1] = (uint8_t)((pixels[off + 1] * 215) >> 8);
        pixels[off + 2] = (uint8_t)((pixels[off + 2] * 225) >> 8);
        pixels[off + 3] = 255;
    }

    // 2. Additive particle glow
    for (uint32_t i = 0; i < num_particles; ++i) {
        const Particle* p = &particles[i];
        int px = (int)p->x;
        int py = (int)p->y;

        if (px < 1 || px >= (int)width - 1 || py < 1 || py >= (int)height - 1) continue;

        float speed = sqrt_fast(p->vx * p->vx + p->vy * p->vy);
        uint8_t r = (uint8_t)(speed * 40.0f);
        uint8_t g = (uint8_t)(140.0f + p->life * 100.0f);
        uint8_t b = (uint8_t)(255.0f * (1.0f - p->life * 0.3f));

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
`
      },
      {
        id: "main_js",
        name: "main.js",
        type: "js",
        code: `// Orchestrates simulate.wasm and render.wasm on shared memory
const NUM_PARTICLES = 8000;
const PARTICLE_BYTES = NUM_PARTICLES * 20;
const PIXEL_BYTES = width * height * 4;
const TOTAL_SIZE = PARTICLE_BYTES + PIXEL_BYTES;
const PIXEL_OFFSET = PARTICLE_BYTES;

// 1. Single shared memory buffer
const sharedMem = wash_memory(TOTAL_SIZE);

// Create sub-buffer memory views
const particlesMem = { heapBase: sharedMem.heapBase, buffer: sharedMem.buffer };
const pixelsMem    = { heapBase: sharedMem.heapBase + PIXEL_OFFSET, buffer: sharedMem.buffer };

// 2. Load compiled shaders attaching the SAME memory
const simulateShader = await wash_load(shaders["simulate.wasm"], sharedMem);
const renderShader   = await wash_load(shaders["render.wasm"], sharedMem);

// 3. Render loop called every frame by the studio
let frameCount = 0;

return function onFrame({ time, mouseX, mouseY, isMouseDown, ctx, imgData }) {
    // Stage 1: Physical simulation in shared memory
    wash_run(simulateShader, particlesMem, width, height, NUM_PARTICLES, mouseX, mouseY, isMouseDown ? 1 : 0, frameCount);

    // Stage 2: Rasterization & trail post-processing on the same memory
    wash_run(renderShader, particlesMem, pixelsMem, width, height, NUM_PARTICLES);

    // Stage 3: Blit pixels to Canvas
    const pixels = sharedMem.rawU8(PIXEL_OFFSET, PIXEL_BYTES);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);

    frameCount++;
};
`
      }
    ]
  },

  pathtracer: {
    name: "02. Monte Carlo Path Tracer (Interactive 3D)",
    description: "Real-time physically-based ray tracer with ground plane, glass, gold and diffuse materials. Accumulates light over time.",
    tabs: [
      {
        id: "pathtracer",
        name: "pathtracer.c",
        type: "c",
        code: `#include <stdint.h>

typedef struct { float x, y, z; } Vec3;
static Vec3 vec_add(Vec3 a, Vec3 b) { return (Vec3){a.x + b.x, a.y + b.y, a.z + b.z}; }
static Vec3 vec_sub(Vec3 a, Vec3 b) { return (Vec3){a.x - b.x, a.y - b.y, a.z - b.z}; }
static Vec3 vec_mul(Vec3 a, float s) { return (Vec3){a.x * s, a.y * s, a.z * s}; }
static Vec3 vec_mul_v(Vec3 a, Vec3 b) { return (Vec3){a.x * b.x, a.y * b.y, a.z * b.z}; }
static float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

static float sqrt_fast(float x) {
    if (x <= 0.0f) return 0.0f;
    float guess = x * 0.5f;
    for (int i = 0; i < 5; ++i) guess = 0.5f * (guess + x / guess);
    return guess;
}

static float length(Vec3 v) { return sqrt_fast(v.x*v.x + v.y*v.y + v.z*v.z); }
static Vec3 normalize(Vec3 v) { float l = length(v); return l > 0 ? vec_mul(v, 1.0f/l) : (Vec3){0,0,0}; }
static Vec3 reflect(Vec3 v, Vec3 n) { return vec_sub(v, vec_mul(n, 2.0f * dot(v, n))); }

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
static float cos_fast(float x) { return sin_fast(x + 1.5707963f); }

static Vec3 rand_unit_vector(uint32_t *seed) {
    float z = rand_f(seed) * 2.0f - 1.0f;
    float a = rand_f(seed) * 6.2831853f;
    float r = sqrt_fast(1.0f - z * z);
    return (Vec3){r * cos_fast(a), r * sin_fast(a), z};
}

typedef struct {
    float t;
    Vec3 normal;
    Vec3 albedo;
    int mat; // 0=Diffuse, 1=Emissive, 2=Metal, 3=Glass
    float ior;
} HitRecord;

static int hit_sphere(Vec3 center, float radius, Vec3 ro, Vec3 rd, float t_min, float t_max, HitRecord *rec, Vec3 albedo, int mat, float ior) {
    Vec3 oc = vec_sub(ro, center);
    float a = dot(rd, rd);
    float half_b = dot(oc, rd);
    float c = dot(oc, oc) - radius*radius;
    float discriminant = half_b*half_b - a*c;
    if (discriminant > 0) {
        float sqrtd = sqrt_fast(discriminant);
        float root = (-half_b - sqrtd) / a;
        if (root < t_max && root > t_min) {
            rec->t = root;
            Vec3 p = vec_add(ro, vec_mul(rd, rec->t));
            rec->normal = vec_mul(vec_sub(p, center), 1.0f / radius);
            rec->albedo = albedo;
            rec->mat = mat;
            rec->ior = ior;
            return 1;
        }
    }
    return 0;
}

static int hit_aa_plane(int axis, float pos, int positive_normal, Vec3 ro, Vec3 rd, float t_min, float t_max, HitRecord *rec, Vec3 albedo, int mat) {
    float ro_axis = (axis == 0 ? ro.x : (axis == 1 ? ro.y : ro.z));
    float rd_axis = (axis == 0 ? rd.x : (axis == 1 ? rd.y : rd.z));
    if (rd_axis > -0.00001f && rd_axis < 0.00001f) return 0;
    float t = (pos - ro_axis) / rd_axis;
    if (t < t_max && t > t_min) {
        rec->t = t;
        rec->normal = (Vec3){0, 0, 0};
        if (axis == 0) rec->normal.x = positive_normal ? 1.0f : -1.0f;
        else if (axis == 1) rec->normal.y = positive_normal ? 1.0f : -1.0f;
        else rec->normal.z = positive_normal ? 1.0f : -1.0f;
        rec->albedo = albedo;
        rec->mat = mat;
        rec->ior = 1.0f;
        return 1;
    }
    return 0;
}

static int hit_scene(Vec3 ro, Vec3 rd, float t_min, float t_max, HitRecord *rec) {
    HitRecord temp_rec;
    int hit_anything = 0;
    float closest = t_max;

    // Ground Plane with Checkerboard Pattern at Y = -0.5
    if (hit_aa_plane(1, -0.5f, 1, ro, rd, t_min, closest, &temp_rec, (Vec3){0.8f, 0.8f, 0.8f}, 0)) {
        Vec3 p = vec_add(ro, vec_mul(rd, temp_rec.t));
        int cx = (int)(p.x * 2.0f + 1000.0f);
        int cz = (int)(p.z * 2.0f + 1000.0f);
        int check = (cx + cz) & 1;
        temp_rec.albedo = check ? (Vec3){0.85f, 0.85f, 0.88f} : (Vec3){0.25f, 0.28f, 0.32f};
        hit_anything = 1; closest = temp_rec.t; *rec = temp_rec;
    }

    // Glass Center Sphere
    if (hit_sphere((Vec3){0.0f, 0.0f, -1.5f}, 0.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){1.0f, 1.0f, 1.0f}, 3, 1.5f)) {
        hit_anything = 1; closest = temp_rec.t; *rec = temp_rec;
    }
    // Gold Metal Right Sphere
    if (hit_sphere((Vec3){1.1f, 0.0f, -1.3f}, 0.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){0.9f, 0.75f, 0.25f}, 2, 1.0f)) {
        hit_anything = 1; closest = temp_rec.t; *rec = temp_rec;
    }
    // Diffuse Cyan Left Sphere
    if (hit_sphere((Vec3){-1.1f, 0.0f, -1.3f}, 0.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){0.15f, 0.65f, 0.85f}, 0, 1.0f)) {
        hit_anything = 1; closest = temp_rec.t; *rec = temp_rec;
    }
    // Overhead Sun / Soft Emissive Light
    if (hit_sphere((Vec3){1.5f, 4.5f, -2.5f}, 1.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){12.0f, 11.0f, 9.0f}, 1, 1.0f)) {
        hit_anything = 1; closest = temp_rec.t; *rec = temp_rec;
    }
    return hit_anything;
}

static Vec3 ray_color(Vec3 ro, Vec3 rd, uint32_t *seed, int fast_mode) {
    Vec3 cur_ro = ro, cur_rd = rd;
    Vec3 throughput = {1.0f, 1.0f, 1.0f};
    Vec3 accum_light = {0.0f, 0.0f, 0.0f};
    int max_depth = fast_mode ? 2 : 4;

    for (int depth = 0; depth < max_depth; depth++) {
        HitRecord rec;
        if (hit_scene(cur_ro, cur_rd, 0.001f, 1000.0f, &rec)) {
            Vec3 hit_point = vec_add(cur_ro, vec_mul(cur_rd, rec.t));

            if (rec.mat == 1) { // Light
                accum_light = vec_add(accum_light, vec_mul_v(throughput, rec.albedo));
                break;
            } else if (rec.mat == 0) { // Diffuse
                Vec3 target = vec_add(vec_add(hit_point, rec.normal), rand_unit_vector(seed));
                cur_ro = vec_add(hit_point, vec_mul(rec.normal, 0.002f)); // Offset ray origin to eliminate shadow acne
                cur_rd = normalize(vec_sub(target, cur_ro));
                throughput = vec_mul_v(throughput, rec.albedo);
            } else if (rec.mat == 2) { // Metal
                Vec3 ref = reflect(normalize(cur_rd), rec.normal);
                cur_ro = vec_add(hit_point, vec_mul(rec.normal, 0.002f));
                cur_rd = normalize(vec_add(ref, vec_mul(rand_unit_vector(seed), 0.04f)));
                throughput = vec_mul_v(throughput, rec.albedo);
            } else if (rec.mat == 3) { // Glass
                Vec3 ref = reflect(cur_rd, rec.normal);
                cur_ro = vec_add(hit_point, vec_mul(rec.normal, 0.002f));
                cur_rd = ref;
            }
        } else {
            // Sky gradient
            Vec3 unit_direction = normalize(cur_rd);
            float t = 0.5f * (unit_direction.y + 1.0f);
            Vec3 sky = vec_add(vec_mul((Vec3){1.0f, 1.0f, 1.0f}, (1.0f - t)), vec_mul((Vec3){0.45f, 0.65f, 0.95f}, t));
            accum_light = vec_add(accum_light, vec_mul_v(throughput, vec_mul(sky, 0.5f)));
            break;
        }
    }
    return accum_light;
}

__attribute__((export_name("_start")))
uint32_t _start(
    uint8_t* data,
    uint32_t width,
    uint32_t height,
    uint32_t frame_count,
    float cam_x,
    float cam_y,
    float cam_z,
    float pitch,
    float yaw
) {
    if (width == 0 || height == 0) return 0;

    float* acc_buffer = (float*)(data);
    uint8_t* pixels = data + width * height * 12;

    int fast_mode = (frame_count == 0);
    Vec3 camera = {cam_x, cam_y, cam_z};

    float cp = cos_fast(pitch);
    float sp = sin_fast(pitch);
    float cy = cos_fast(yaw);
    float sy = sin_fast(yaw);

    Vec3 w = {-cp*sy, -sp, cp*cy};
    Vec3 world_up = {0, 1, 0};
    Vec3 u = normalize((Vec3){w.y*world_up.z - w.z*world_up.y, w.z*world_up.x - w.x*world_up.z, w.x*world_up.y - w.y*world_up.x});
    Vec3 v = {w.y*u.z - w.z*u.y, w.z*u.x - w.x*u.z, w.x*u.y - w.y*u.x};

    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t seed = pcg_hash(y * width + x + frame_count * 719393);

            float u_coord = (float)(x + (fast_mode ? 0.5f : rand_f(&seed))) / (width - 1);
            float v_coord = (float)(y + (fast_mode ? 0.5f : rand_f(&seed))) / (height - 1);

            Vec3 horizontal = vec_mul(u, 2.0f);
            Vec3 vertical = vec_mul(v, 1.5f);
            Vec3 lower_left = vec_sub(vec_sub(camera, vec_mul(horizontal, 0.5f)), vec_mul(vertical, 0.5f));
            lower_left = vec_add(lower_left, w);

            Vec3 rd = vec_add(lower_left, vec_mul(horizontal, u_coord));
            rd = vec_add(rd, vec_mul(vertical, v_coord));
            rd = normalize(vec_sub(rd, camera));

            Vec3 color = ray_color(camera, rd, &seed, fast_mode);

            uint32_t offset = (y * width + x) * 3;
            if (fast_mode) {
                acc_buffer[offset + 0] = color.x;
                acc_buffer[offset + 1] = color.y;
                acc_buffer[offset + 2] = color.z;
            } else {
                acc_buffer[offset + 0] += color.x;
                acc_buffer[offset + 1] += color.y;
                acc_buffer[offset + 2] += color.z;
            }

            float scale = fast_mode ? 1.0f : 1.0f / (frame_count + 1);
            float r = sqrt_fast(acc_buffer[offset + 0] * scale);
            float g = sqrt_fast(acc_buffer[offset + 1] * scale);
            float b = sqrt_fast(acc_buffer[offset + 2] * scale);

            uint32_t p_offset = (y * width + x) * 4;
            pixels[p_offset + 0] = (uint8_t)(r >= 1.0f ? 255 : r * 255);
            pixels[p_offset + 1] = (uint8_t)(g >= 1.0f ? 255 : g * 255);
            pixels[p_offset + 2] = (uint8_t)(b >= 1.0f ? 255 : b * 255);
            pixels[p_offset + 3] = 255;
        }
    }

    return frame_count + 1;
}
`
      },
      {
        id: "main_js",
        name: "main.js",
        type: "js",
        code: `const ACC_SIZE = width * height * 12;
const PIXEL_SIZE = width * height * 4;
const SIZE = ACC_SIZE + PIXEL_SIZE;
const PIXEL_OFFSET = ACC_SIZE;

const mem = wash_memory(SIZE);
const shader = await wash_load(shaders["pathtracer.wasm"], mem);

let camX = 0.0, camY = 0.6, camZ = 1.2;
let pitch = 0.0, yaw = Math.PI;
let frameCount = 0;

return function onFrame({ mouseX, mouseY, isMouseDown, ctx, imgData }) {
    if (isMouseDown) {
        yaw = Math.PI + (mouseX - 0.5) * 2.5;
        pitch = (mouseY - 0.5) * 1.5;
        frameCount = 0;
    }

    frameCount = wash_run(shader, mem, width, height, frameCount, camX, camY, camZ, pitch, yaw);

    imgData.data.set(mem.rawU8(PIXEL_OFFSET, PIXEL_SIZE));
    ctx.putImageData(imgData, 0, 0);
};
`
      }
    ]
  },

  fractal: {
    name: "03. Interactive Julia Fractal",
    description: "Real-time Julia fractal with dynamic mouse coordinates and time-based color cycling.",
    tabs: [
      {
        id: "fractal",
        name: "fractal.c",
        type: "c",
        code: `#include <stdint.h>

static float sqrt_fast(float x) {
    if (x <= 0.0f) return 0.0f;
    float guess = x * 0.5f;
    for (int i = 0; i < 5; ++i) {
        guess = 0.5f * (guess + x / guess);
    }
    return guess;
}

__attribute__((export_name("_start")))
void* _start(uint8_t* pixels, uint32_t width, uint32_t height, float time, float mouseX, float mouseY) {
    float aspect = (float)width / (float)height;

    float cx = (mouseX - 0.5f) * 2.0f;
    float cy = (mouseY - 0.5f) * 2.0f;

    float t = time * 0.001f;
    float t1 = t - (int)t; if(t1 < 0) t1 += 1.0f;
    float t2 = (t + 0.33f) - (int)(t + 0.33f); if(t2 < 0) t2 += 1.0f;
    float t3 = (t + 0.66f) - (int)(t + 0.66f); if(t3 < 0) t3 += 1.0f;
    
    float base_r = t1 < 0.5f ? t1 * 2.0f : (1.0f - t1) * 2.0f;
    float base_g = t2 < 0.5f ? t2 * 2.0f : (1.0f - t2) * 2.0f;
    float base_b = t3 < 0.5f ? t3 * 2.0f : (1.0f - t3) * 2.0f;

    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            float zx = (((float)x / width) - 0.5f) * 3.0f * aspect;
            float zy = (((float)y / height) - 0.5f) * 3.0f;

            int iter = 0;
            const int max_iter = 100;
            while (zx * zx + zy * zy < 4.0f && iter < max_iter) {
                float tmp = zx * zx - zy * zy + cx;
                zy = 2.0f * zx * zy + cy;
                zx = tmp;
                iter++;
            }

            float t_color = (float)iter / max_iter;
            if (iter < max_iter) {
                t_color = sqrt_fast(t_color); 
            } else {
                t_color = 0.0f;
            }
            
            uint32_t offset = (y * width + x) * 4;
            pixels[offset + 0] = (uint8_t)(t_color * base_r * 255);
            pixels[offset + 1] = (uint8_t)(t_color * base_g * 255);
            pixels[offset + 2] = (uint8_t)(t_color * base_b * 255);
            pixels[offset + 3] = 255;
        }
    }
    return 0;
}
`
      },
      {
        id: "main_js",
        name: "main.js",
        type: "js",
        code: `const mem = wash_memory(width * height * 4);
const shader = await wash_load(shaders["fractal.wasm"], mem);

return function onFrame({ time, mouseX, mouseY, ctx, imgData }) {
    wash_run(shader, mem, width, height, time, mouseX, mouseY);

    imgData.data.set(mem.u8);
    ctx.putImageData(imgData, 0, 0);
};
`
      }
    ]
  },

  gradient: {
    name: "04. Simple Gradient",
    description: "Minimalist starting template demonstrating zero-overhead pixel rendering.",
    tabs: [
      {
        id: "gradient",
        name: "gradient.c",
        type: "c",
        code: `#include <stdint.h>

__attribute__((export_name("_start")))
void* _start(uint8_t* pixels, uint32_t width, uint32_t height) {
    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t offset = (y * width + x) * 4;
            pixels[offset + 0] = (uint8_t)((x * 255) / width);   // R
            pixels[offset + 1] = (uint8_t)((y * 255) / height);  // G
            pixels[offset + 2] = 160;                            // B
            pixels[offset + 3] = 255;                            // A
        }
    }
    return 0;
}
`
      },
      {
        id: "main_js",
        name: "main.js",
        type: "js",
        code: `const mem = wash_memory(width * height * 4);
const shader = await wash_load(shaders["gradient.wasm"], mem);

return function onFrame({ ctx, imgData }) {
    wash_run(shader, mem, width, height);

    imgData.data.set(mem.u8);
    ctx.putImageData(imgData, 0, 0);
};
`
      }
    ]
  }
};
