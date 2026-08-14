#include <stdint.h>

/**
 * Example 8: Parallel Monte Carlo Path Tracer
 * High-performance sliced rendering designed for multi-worker CPU parallelism.
 */

typedef struct { float x, y, z; } Vec3;
static Vec3 vec_add(Vec3 a, Vec3 b) { return (Vec3){a.x + b.x, a.y + b.y, a.z + b.z}; }
static Vec3 vec_sub(Vec3 a, Vec3 b) { return (Vec3){a.x - b.x, a.y - b.y, a.z - b.z}; }
static Vec3 vec_mul(Vec3 a, float s) { return (Vec3){a.x * s, a.y * s, a.z * s}; }
static Vec3 vec_mul_v(Vec3 a, Vec3 b) { return (Vec3){a.x * b.x, a.y * b.y, a.z * b.z}; }
static float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static float length(Vec3 v) { return __builtin_sqrtf(v.x*v.x + v.y*v.y + v.z*v.z); }
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
    float r = __builtin_sqrtf(1.0f - z * z);
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
        float sqrtd = __builtin_sqrtf(discriminant);
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
        root = (-half_b + sqrtd) / a;
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

static int hit_scene(Vec3 ro, Vec3 rd, float t_min, float t_max, HitRecord *rec) {
    HitRecord temp_rec;
    int hit_anything = 0;
    float closest = t_max;

    // Ground (Diffuse checkerboard pattern)
    if (hit_sphere((Vec3){0.0f, -1000.5f, -1.0f}, 1000.0f, ro, rd, t_min, closest, &temp_rec, (Vec3){0.8f, 0.8f, 0.8f}, 0, 1.0f)) {
        hit_anything = 1;
        closest = temp_rec.t;
        *rec = temp_rec;
        Vec3 p = vec_add(ro, vec_mul(rd, rec->t));
        int cx = (int)__builtin_floorf(p.x * 2.0f);
        int cz = (int)__builtin_floorf(p.z * 2.0f);
        if ((cx + cz) % 2 == 0) rec->albedo = (Vec3){0.3f, 0.3f, 0.35f};
        else rec->albedo = (Vec3){0.9f, 0.9f, 0.95f};
    }

    // Glass Sphere (Center)
    if (hit_sphere((Vec3){0.0f, 0.0f, -1.5f}, 0.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){1.0f, 1.0f, 1.0f}, 3, 1.5f)) {
        hit_anything = 1;
        closest = temp_rec.t;
        *rec = temp_rec;
    }

    // Polished Gold Metal Sphere (Right)
    if (hit_sphere((Vec3){1.1f, 0.0f, -1.3f}, 0.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){0.85f, 0.7f, 0.2f}, 2, 1.0f)) {
        hit_anything = 1;
        closest = temp_rec.t;
        *rec = temp_rec;
    }

    // Matte Blue Sphere (Left)
    if (hit_sphere((Vec3){-1.1f, 0.0f, -1.3f}, 0.5f, ro, rd, t_min, closest, &temp_rec, (Vec3){0.2f, 0.4f, 0.9f}, 0, 1.0f)) {
        hit_anything = 1;
        closest = temp_rec.t;
        *rec = temp_rec;
    }

    // Warm Overhead Light (Emissive)
    if (hit_sphere((Vec3){0.0f, 5.0f, -2.0f}, 2.0f, ro, rd, t_min, closest, &temp_rec, (Vec3){12.0f, 10.0f, 8.0f}, 1, 1.0f)) {
        hit_anything = 1;
        closest = temp_rec.t;
        *rec = temp_rec;
    }

    return hit_anything;
}

static int refract(Vec3 v, Vec3 n, float ni_over_nt, Vec3 *refracted) {
    Vec3 uv = normalize(v);
    float dt = dot(uv, n);
    float discriminant = 1.0f - ni_over_nt * ni_over_nt * (1.0f - dt * dt);
    if (discriminant > 0) {
        *refracted = vec_sub(vec_mul(vec_sub(uv, vec_mul(n, dt)), ni_over_nt), vec_mul(n, __builtin_sqrtf(discriminant)));
        return 1;
    }
    return 0;
}

static float schlick(float cosine, float ior) {
    float r0 = (1.0f - ior) / (1.0f + ior);
    r0 = r0 * r0;
    float one_minus_c = 1.0f - cosine;
    return r0 + (1.0f - r0) * (one_minus_c*one_minus_c*one_minus_c*one_minus_c*one_minus_c);
}

static Vec3 ray_color(Vec3 ro, Vec3 rd, uint32_t *seed, int fast_mode) {
    Vec3 cur_ro = ro;
    Vec3 cur_rd = rd;
    Vec3 throughput = {1.0f, 1.0f, 1.0f};
    Vec3 accum_light = {0.0f, 0.0f, 0.0f};

    int max_depth = fast_mode ? 2 : 5;

    for (int depth = 0; depth < max_depth; depth++) {
        HitRecord rec;
        if (hit_scene(cur_ro, cur_rd, 0.001f, 10000.0f, &rec)) {
            if (rec.mat == 1) { // Emissive Light
                accum_light = vec_add(accum_light, vec_mul_v(throughput, rec.albedo));
                break;
            } else if (rec.mat == 0) { // Diffuse
                Vec3 target = vec_add(vec_add(vec_add(cur_ro, vec_mul(cur_rd, rec.t)), rec.normal), rand_unit_vector(seed));
                cur_ro = vec_add(cur_ro, vec_mul(cur_rd, rec.t));
                cur_rd = normalize(vec_sub(target, cur_ro));
                throughput = vec_mul_v(throughput, rec.albedo);
            } else if (rec.mat == 2) { // Metal
                Vec3 p = vec_add(cur_ro, vec_mul(cur_rd, rec.t));
                Vec3 ref = reflect(normalize(cur_rd), rec.normal);
                cur_ro = p;
                cur_rd = normalize(vec_add(ref, vec_mul(rand_unit_vector(seed), 0.05f)));
                throughput = vec_mul_v(throughput, rec.albedo);
            } else if (rec.mat == 3) { // Glass / Dielectric
                Vec3 outward_normal;
                Vec3 reflected = reflect(cur_rd, rec.normal);
                float ni_over_nt;
                Vec3 refracted;
                float reflect_prob;
                float cosine;
                Vec3 p = vec_add(cur_ro, vec_mul(cur_rd, rec.t));

                if (dot(cur_rd, rec.normal) > 0) {
                    outward_normal = vec_mul(rec.normal, -1.0f);
                    ni_over_nt = rec.ior;
                    cosine = rec.ior * dot(cur_rd, rec.normal) / length(cur_rd);
                } else {
                    outward_normal = rec.normal;
                    ni_over_nt = 1.0f / rec.ior;
                    cosine = -dot(cur_rd, rec.normal) / length(cur_rd);
                }

                if (refract(cur_rd, outward_normal, ni_over_nt, &refracted)) {
                    reflect_prob = schlick(cosine, rec.ior);
                } else {
                    reflect_prob = 1.0f;
                }

                if (rand_f(seed) < reflect_prob) {
                    cur_ro = p;
                    cur_rd = reflected;
                } else {
                    cur_ro = p;
                    cur_rd = refracted;
                }
            }
        } else {
            // Ambient Sky
            Vec3 unit_direction = normalize(cur_rd);
            float t = 0.5f * (unit_direction.y + 1.0f);
            Vec3 sky = vec_add(vec_mul((Vec3){1.0f, 1.0f, 1.0f}, (1.0f - t)), vec_mul((Vec3){0.4f, 0.6f, 0.9f}, t));
            accum_light = vec_add(accum_light, vec_mul_v(throughput, vec_mul(sky, 0.4f)));
            break;
        }
    }
    return accum_light;
}

// Slice rendering entry point for Multi-Worker parallelism
__attribute__((export_name("_start")))
void* _start(uint8_t* data) {
    uint32_t width       = *(uint32_t*)(data + 0);
    uint32_t height      = *(uint32_t*)(data + 4);
    uint32_t frame_count = *(uint32_t*)(data + 8);
    float cam_x          = *(float*)(data + 12);
    float cam_y          = *(float*)(data + 16);
    float cam_z          = *(float*)(data + 20);
    float pitch          = *(float*)(data + 24);
    float yaw            = *(float*)(data + 28);
    uint32_t start_y     = *(uint32_t*)(data + 32);
    uint32_t end_y       = *(uint32_t*)(data + 36);
    uint32_t thread_id   = *(uint32_t*)(data + 40);

    if (end_y > height) end_y = height;
    if (start_y >= end_y) return 0;

    // Header size = 48 bytes
    float* acc_buffer = (float*)(data + 48);
    uint8_t* pixels   = data + 48 + width * height * 12;

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

    for (uint32_t y = start_y; y < end_y; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t seed = pcg_hash(y * width + x + frame_count * 719393 + thread_id * 10007);

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
            float r = __builtin_sqrtf(acc_buffer[offset + 0] * scale);
            float g = __builtin_sqrtf(acc_buffer[offset + 1] * scale);
            float b = __builtin_sqrtf(acc_buffer[offset + 2] * scale);

            uint32_t p_offset = (y * width + x) * 4;
            pixels[p_offset + 0] = (uint8_t)(r >= 1.0f ? 255 : r * 255);
            pixels[p_offset + 1] = (uint8_t)(g >= 1.0f ? 255 : g * 255);
            pixels[p_offset + 2] = (uint8_t)(b >= 1.0f ? 255 : b * 255);
            pixels[p_offset + 3] = 255;
        }
    }

    return 0;
}
