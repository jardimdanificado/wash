#include <stdint.h>

void* _start(uint8_t* data) {
    uint32_t width = *(uint32_t*)(data + 0);
    uint32_t height = *(uint32_t*)(data + 4);
    uint8_t* pixels = data + 8;

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
