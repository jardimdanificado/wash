#include <stdint.h>

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
    float k = (int)(x * 0.1591549f); // x / (2*PI)
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
            rec->normal = normalize(vec_sub(vec_add(ro, vec_mul(rd, root)), center));
            rec->albedo = albedo; rec->mat = mat; rec->ior = ior; return 1;
        }
        root = (-half_b + sqrtd) / a;
        if (root < t_max && root > t_min) {
            rec->t = root;
            rec->normal = normalize(vec_sub(vec_add(ro, vec_mul(rd, root)), center));
            rec->albedo = albedo; rec->mat = mat; rec->ior = ior; return 1;
        }
    }
    return 0;
}

static int hit_aa_plane(int axis, float coord, int positive_normal, Vec3 ro, Vec3 rd, float t_min, float t_max, HitRecord *rec, Vec3 albedo, int mat) {
    float rd_c = (axis==0)?rd.x:(axis==1)?rd.y:rd.z;
    float ro_c = (axis==0)?ro.x:(axis==1)?ro.y:ro.z;
    if (rd_c == 0.0f) return 0;
    float t = (coord - ro_c) / rd_c;
    if (t > t_min && t < t_max) {
        rec->t = t; rec->normal = (Vec3){0, 0, 0};
        if (axis == 0) rec->normal.x = positive_normal ? 1.0f : -1.0f;
        else if (axis == 1) rec->normal.y = positive_normal ? 1.0f : -1.0f;
        else rec->normal.z = positive_normal ? 1.0f : -1.0f;
        rec->albedo = albedo; rec->mat = mat; return 1;
    }
    return 0;
}

static int map_world(Vec3 ro, Vec3 rd, HitRecord *rec) {
    HitRecord temp; int hit_anything = 0; float closest = 10000.0f;

    // Paredes da Cornell Box
    if (hit_aa_plane(1, -1.0f, 1, ro, rd, 0.001f, closest, &temp, (Vec3){0.8f, 0.8f, 0.8f}, 0)) { hit_anything = 1; closest = temp.t; *rec = temp; }
    if (hit_aa_plane(1, 3.0f, 0, ro, rd, 0.001f, closest, &temp, (Vec3){0.8f, 0.8f, 0.8f}, 0)) { hit_anything = 1; closest = temp.t; *rec = temp; }
    if (hit_aa_plane(0, -3.0f, 1, ro, rd, 0.001f, closest, &temp, (Vec3){0.8f, 0.1f, 0.1f}, 0)) { hit_anything = 1; closest = temp.t; *rec = temp; }
    if (hit_aa_plane(0, 3.0f, 0, ro, rd, 0.001f, closest, &temp, (Vec3){0.1f, 0.8f, 0.1f}, 0)) { hit_anything = 1; closest = temp.t; *rec = temp; }
    if (hit_aa_plane(2, -6.0f, 1, ro, rd, 0.001f, closest, &temp, (Vec3){0.8f, 0.8f, 0.8f}, 0)) { hit_anything = 1; closest = temp.t; *rec = temp; }
    if (hit_aa_plane(2, 2.0f, 0, ro, rd, 0.001f, closest, &temp, (Vec3){0.8f, 0.8f, 0.8f}, 0)) { hit_anything = 1; closest = temp.t; *rec = temp; }

    // Luz no teto
    if (hit_sphere((Vec3){0.0f, 2.8f, -3.0f}, 0.8f, ro, rd, 0.001f, closest, &temp, (Vec3){25.0f, 25.0f, 25.0f}, 1, 0.0f)) { hit_anything = 1; closest = temp.t; *rec = temp; }

    // Esfera 1 (Vidro maciço / Dielectric) no meio
    if (hit_sphere((Vec3){0.0f, 0.2f, -3.0f}, 1.2f, ro, rd, 0.001f, closest, &temp, (Vec3){1.0f, 1.0f, 1.0f}, 3, 1.5f)) { hit_anything = 1; closest = temp.t; *rec = temp; }

    // Esfera 2 (Metal perfeito) à esquerda
    if (hit_sphere((Vec3){-1.5f, -0.4f, -4.5f}, 0.6f, ro, rd, 0.001f, closest, &temp, (Vec3){0.9f, 0.9f, 0.9f}, 2, 0.0f)) { hit_anything = 1; closest = temp.t; *rec = temp; }

    // Esfera 3 (Difusa Dourada) à direita
    if (hit_sphere((Vec3){1.5f, -0.4f, -2.5f}, 0.6f, ro, rd, 0.001f, closest, &temp, (Vec3){0.8f, 0.6f, 0.2f}, 0, 0.0f)) { hit_anything = 1; closest = temp.t; *rec = temp; }

    return hit_anything;
}

static float schlick(float cosine, float ref_idx) {
    float r0 = (1.0f - ref_idx) / (1.0f + ref_idx);
    r0 = r0 * r0;
    float m = 1.0f - cosine;
    return r0 + (1.0f - r0) * m * m * m * m * m;
}

static Vec3 refract(Vec3 uv, Vec3 n, float etai_over_etat) {
    float cos_theta = -dot(uv, n);
    if (cos_theta > 1.0f) cos_theta = 1.0f;
    Vec3 r_out_perp = vec_mul(vec_add(uv, vec_mul(n, cos_theta)), etai_over_etat);
    float r_out_parallel_sq = 1.0f - dot(r_out_perp, r_out_perp);
    if (r_out_parallel_sq < 0.0f) r_out_parallel_sq = 0.0f;
    Vec3 r_out_parallel = vec_mul(n, -__builtin_sqrtf(r_out_parallel_sq));
    return vec_add(r_out_perp, r_out_parallel);
}

static Vec3 ray_color(Vec3 ro, Vec3 rd, uint32_t *seed, int fast_mode) {
    Vec3 attenuation = {1.0f, 1.0f, 1.0f};
    
    for (int depth = 0; depth < 5; depth++) {
        HitRecord rec;
        if (map_world(ro, rd, &rec)) {
            if (rec.mat == 1) return vec_mul_v(attenuation, rec.albedo); // Luz

            // Fast preview mode: Apenas iluminação direta simples sem rebatimentos
            if (fast_mode) {
                Vec3 light_pos = {0.0f, 2.8f, -3.0f};
                Vec3 hit_point = vec_add(ro, vec_mul(rd, rec.t));
                Vec3 light_dir = normalize(vec_sub(light_pos, hit_point));
                float diff = dot(rec.normal, light_dir);
                if (diff < 0.2f) diff = 0.2f;
                return vec_mul_v(attenuation, vec_mul(rec.albedo, diff));
            }

            Vec3 hit_point = vec_add(ro, vec_mul(rd, rec.t));
            
            if (rec.mat == 0) { // Diffuse
                rd = normalize(vec_add(rec.normal, rand_unit_vector(seed)));
                ro = vec_add(hit_point, vec_mul(rec.normal, 0.001f));
                attenuation = vec_mul_v(attenuation, rec.albedo);
            } else if (rec.mat == 2) { // Metal
                rd = reflect(rd, rec.normal);
                ro = vec_add(hit_point, vec_mul(rec.normal, 0.001f));
                attenuation = vec_mul_v(attenuation, rec.albedo);
            } else if (rec.mat == 3) { // Glass
                float refraction_ratio = (dot(rd, rec.normal) < 0.0f) ? (1.0f / rec.ior) : rec.ior;
                Vec3 out_normal = (dot(rd, rec.normal) < 0.0f) ? rec.normal : vec_mul(rec.normal, -1.0f);
                float cos_theta = -dot(rd, out_normal);
                if (cos_theta > 1.0f) cos_theta = 1.0f;
                float sin_theta = __builtin_sqrtf(1.0f - cos_theta*cos_theta);
                
                // TIR (Total Internal Reflection)
                if (refraction_ratio * sin_theta > 1.0f || schlick(cos_theta, refraction_ratio) > rand_f(seed)) {
                    rd = reflect(rd, out_normal);
                } else {
                    rd = refract(rd, out_normal, refraction_ratio);
                }
                ro = vec_add(hit_point, vec_mul(rd, 0.005f)); // Usa a direção do próprio raio pra escapar da acne
            }
        } else {
            return (Vec3){0, 0, 0};
        }
    }
    return (Vec3){0, 0, 0};
}

void* _start(uint8_t* data) {
    uint32_t width = *(uint32_t*)(data + 0);
    uint32_t height = *(uint32_t*)(data + 4);
    uint32_t frame_count = *(uint32_t*)(data + 8);
    float cam_x = *(float*)(data + 12);
    float cam_y = *(float*)(data + 16);
    float cam_z = *(float*)(data + 20);
    float pitch = *(float*)(data + 24);
    float yaw   = *(float*)(data + 28);
    
    // Header tem 32 bytes agora.
    float* acc_buffer = (float*)(data + 32);
    uint8_t* pixels = data + 32 + width * height * 12;

    int fast_mode = (frame_count == 0);

    Vec3 camera = {cam_x, cam_y, cam_z};
    
    // Calcula vetores direções a partir de pitch e yaw
    float cp = cos_fast(pitch);
    float sp = sin_fast(pitch);
    float cy = cos_fast(yaw);
    float sy = sin_fast(yaw);
    
    Vec3 w = {-cp*sy, -sp, cp*cy}; // Look direction
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
    
    *(uint32_t*)(data + 8) = frame_count + 1;
    return 0;
}
