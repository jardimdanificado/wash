#include <stdint.h>

__attribute__((export_name("_start")))
void* _start(uint8_t* pixels, uint32_t width, uint32_t height) {
    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t offset = (y * width + x) * 4;
            pixels[offset + 0] = (uint8_t)((x * 255) / width);   // R
            pixels[offset + 1] = (uint8_t)((y * 255) / height);  // G
            pixels[offset + 2] = 128;                            // B
            pixels[offset + 3] = 255;                            // A
        }
    }
    return 0;
}
