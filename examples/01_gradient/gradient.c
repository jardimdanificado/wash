#include <stdint.h>

__attribute__((export_name("_start")))
void* _start(uint8_t* pixels, uint32_t width, uint32_t height) {
    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t offset = (y * width + x) * 4;
            uint8_t grad_r = (uint8_t)((x * 255) / width);
            uint8_t grad_g = (uint8_t)((y * 255) / height);
            uint8_t grad_b = 128;
            uint8_t alpha = 128; // 50% de opacidade (0 a 255)

            // Blend do gradiente com o pixel que já estava na memória
            pixels[offset + 0] = (uint8_t)((grad_r * alpha + pixels[offset + 0] * (255 - alpha)) / 255);
            pixels[offset + 1] = (uint8_t)((grad_g * alpha + pixels[offset + 1] * (255 - alpha)) / 255);
            pixels[offset + 2] = (uint8_t)((grad_b * alpha + pixels[offset + 2] * (255 - alpha)) / 255);
            pixels[offset + 3] = 255;
        }
    }
    return 0;
}