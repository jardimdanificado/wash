#include <stdint.h>

typedef struct { float x; float y; float z; } Vec3;

static float min_f(float a, float b) { return a < b ? a : b; }
static float max_f(float a, float b) { return a > b ? a : b; }
static float clamp_f(float x, float a, float b) { return max_f(a, min_f(b, x)); }

static Vec3 vec_add(Vec3 a, Vec3 b) { return (Vec3){a.x + b.x, a.y + b.y, a.z + b.z}; }
static Vec3 vec_sub(Vec3 a, Vec3 b) { return (Vec3){a.x - b.x, a.y - b.y, a.z - b.z}; }
static Vec3 vec_mul(Vec3 a, float s) { return (Vec3){a.x * s, a.y * s, a.z * s}; }
static float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

static float length(Vec3 v) {
    return __builtin_sqrtf(v.x*v.x + v.y*v.y + v.z*v.z);
}

static Vec3 normalize(Vec3 v) {
    float len = length(v);
    if (len <= 0.00001f) return (Vec3){0.0f, 0.0f, 0.0f};
    return vec_mul(v, 1.0f / len);
}

// Scene definition
static float map(Vec3 p, int *mat) {
    // 1. Plane at y = -1.0
    float d = p.y + 1.0f;
    int m = 1;

    // 2. Torus at (0, 0, 4)
    // q = vec2(length(p.xz) - t.x, p.y)
    float px = p.x;
    float pz = p.z - 4.0f;
    float l_xz = __builtin_sqrtf(px*px + pz*pz);
    float qx = l_xz - 1.2f;
    float qy = p.y;
    float d_torus = __builtin_sqrtf(qx*qx + qy*qy) - 0.4f;
    if (d_torus < d) {
        d = d_torus;
        m = 2;
    }

    // 3. Sphere at (1.5, 0.5, 3.0)
    float sx = p.x - 1.5f;
    float sy = p.y - 0.5f;
    float sz = p.z - 3.0f;
    float d_sphere = __builtin_sqrtf(sx*sx + sy*sy + sz*sz) - 0.7f;
    if (d_sphere < d) {
        d = d_sphere;
        m = 3;
    }

    if (mat) *mat = m;
    return d;
}

// Calculate normal via gradient
static Vec3 calc_normal(Vec3 p) {
    const float eps = 0.001f;
    Vec3 n = {
        map((Vec3){p.x + eps, p.y, p.z}, 0) - map((Vec3){p.x - eps, p.y, p.z}, 0),
        map((Vec3){p.x, p.y + eps, p.z}, 0) - map((Vec3){p.x, p.y - eps, p.z}, 0),
        map((Vec3){p.x, p.y, p.z + eps}, 0) - map((Vec3){p.x, p.y, p.z - eps}, 0)
    };
    return normalize(n);
}

// Soft shadow raymarching
static float softshadow(Vec3 ro, Vec3 rd, float mint, float maxt, float k) {
    float res = 1.0f;
    float t = mint;
    for (int i = 0; i < 32 && t < maxt; i++) {
        float h = map(vec_add(ro, vec_mul(rd, t)), 0);
        if (h < 0.001f) return 0.0f;
        res = min_f(res, k * h / t);
        t += clamp_f(h, 0.02f, 0.20f);
    }
    return clamp_f(res, 0.0f, 1.0f);
}

static uint8_t to_byte(float x) {
    return (uint8_t)(clamp_f(x, 0.0f, 1.0f) * 255.0f);
}

void* _start(uint8_t* data)
{
    uint32_t width = *(uint32_t*)(data + 0);
    uint32_t height = *(uint32_t*)(data + 4);
    uint8_t* pixels = data + 8;

    Vec3 light = {2.0f, 4.0f, -1.0f};
    Vec3 camera = {0.0f, 0.5f, -2.5f};
    float aspect = (float)width / (float)height;

    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            float sx = (((float)x + 0.5f) / (float)width) * 2.0f - 1.0f;
            float sy = 1.0f - (((float)y + 0.5f) / (float)height) * 2.0f;

            Vec3 ray = {sx * aspect, sy, 1.5f};
            ray = normalize(ray);

            // Raymarching loop
            float t = 0.0f;
            int mat = -1;
            int hit = 0;
            const float MAX_T = 20.0f;

            for (int i = 0; i < 64; ++i) {
                Vec3 p = vec_add(camera, vec_mul(ray, t));
                float d = map(p, &mat);
                if (d < 0.001f) {
                    hit = 1;
                    break;
                }
                t += d;
                if (t > MAX_T) break;
            }

            float red = 0.0f, green = 0.0f, blue = 0.0f;

            if (hit) {
                Vec3 p = vec_add(camera, vec_mul(ray, t));
                Vec3 n = calc_normal(p);
                Vec3 l = normalize(vec_sub(light, p));

                float diffuse = max_f(0.0f, dot(n, l));
                
                // Shadow
                float shadow = softshadow(vec_add(p, vec_mul(n, 0.01f)), l, 0.02f, 10.0f, 8.0f);
                float ao = clamp_f(1.0f - (float)t/MAX_T, 0.0f, 1.0f); // fake AO based on distance
                
                float lighting = 0.1f * ao + 0.9f * diffuse * shadow;

                if (mat == 1) { // Plane
                    int checker = (((int)(p.x * 1.5f) + (int)(p.z * 1.5f)) & 1);
                    float base = checker ? 0.2f : 0.4f;
                    red = base * lighting;
                    green = base * lighting;
                    blue = (base * 1.1f) * lighting;
                } else if (mat == 2) { // Torus
                    red = 0.9f * lighting;
                    green = 0.2f * lighting;
                    blue = 0.1f * lighting;
                } else if (mat == 3) { // Sphere
                    red = 0.1f * lighting;
                    green = 0.6f * lighting;
                    blue = 0.9f * lighting;
                }
            } else {
                // Sky
                float ty = 0.5f * (ray.y + 1.0f);
                red = 0.05f + 0.10f * ty;
                green = 0.10f + 0.20f * ty;
                blue = 0.20f + 0.40f * ty;
            }

            uint32_t offset = (y * width + x) * 4;
            pixels[offset + 0] = to_byte(red);
            pixels[offset + 1] = to_byte(green);
            pixels[offset + 2] = to_byte(blue);
            pixels[offset + 3] = 255;
        }
    }

    return 0;
}
