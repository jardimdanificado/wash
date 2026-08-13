#include <stdint.h>

void* _start(uint8_t* data) {
    uint32_t width = *(uint32_t*)(data + 0);
    uint32_t height = *(uint32_t*)(data + 4);
    float time = *(float*)(data + 8);
    float mouseX = *(float*)(data + 12);
    float mouseY = *(float*)(data + 16);
    
    // Pixel buffer starts at offset 20 now, because we added 12 bytes of floats
    uint8_t* pixels = data + 20;

    float aspect = (float)width / (float)height;

    // Map mouse to Julia set complex coordinates (cx, cy)
    float cx = (mouseX - 0.5f) * 2.0f;
    float cy = (mouseY - 0.5f) * 2.0f;

    // Time-based color shifting (using simple triangle wave instead of sinf)
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
            // Smooth coloring
            if (iter < max_iter) {
                t_color = __builtin_sqrtf(t_color); 
            } else {
                t_color = 0.0f; // Inner core is black
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
