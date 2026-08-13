#include <stdint.h>

// Declare functions imported from JavaScript
extern void console_log(int value);
extern float get_random();

void* _start(uint8_t* data) {
    uint32_t width = *(uint32_t*)(data + 0);
    uint32_t height = *(uint32_t*)(data + 4);
    uint8_t* pixels = data + 8;

    // Invoke a JS function from C
    console_log(width);
    console_log(height);

    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t offset = (y * width + x) * 4;
            
            // Invoke Math.random() from JS
            float r = get_random();
            
            pixels[offset + 0] = (uint8_t)(r * 255);
            pixels[offset + 1] = (uint8_t)(r * 255);
            pixels[offset + 2] = (uint8_t)(r * 255);
            pixels[offset + 3] = 255;
        }
    }
    return 0;
}
