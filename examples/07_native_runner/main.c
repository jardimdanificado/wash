#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <math.h>

#include <SDL2/SDL.h>

/**
 * Example 7: Native SDL2 Runner for Wash Shaders
 *
 * Runs the EXACT same WebAssembly shaders compiled for Wash in a native
 * desktop window with SDL2, updating uniforms (time, mouse, keyboard, camera)
 * and streaming the RGBA frame buffer to an SDL texture at high FPS.
 */

#if defined(USE_WASM3)
#include "wash.h"
#endif

typedef enum {
    SHADER_TYPE_GENERIC,     // [W: u32, H: u32, Pixels: W*H*4]
    SHADER_TYPE_INTERACTIVE, // [W: u32, H: u32, Time: f32, MouseX: f32, MouseY: f32, Pixels: W*H*4]
    SHADER_TYPE_PHYSICS,     // [W: u32, H: u32, MouseX: f32, MouseY: f32, MouseDown: u32, Time: f32, Pixels: W*H*4]
    SHADER_TYPE_PATHTRACER   // [Headers: 32 bytes, Accumulation: W*H*12, Pixels: W*H*4]
} ShaderType;

static ShaderType detect_shader_type(const char* filename) {
    if (strstr(filename, "interactive") || strstr(filename, "04")) return SHADER_TYPE_INTERACTIVE;
    if (strstr(filename, "physics") || strstr(filename, "05"))     return SHADER_TYPE_PHYSICS;
    if (strstr(filename, "pathtracer") || strstr(filename, "06"))  return SHADER_TYPE_PATHTRACER;
    return SHADER_TYPE_GENERIC;
}

int main(int argc, char** argv) {
    const char* wasm_path = "../06_pathtracer/main.wasm";
    uint32_t width = 600;
    uint32_t height = 400;

    if (argc >= 2) wasm_path = argv[1];
    if (argc >= 4) {
        width = (uint32_t)atoi(argv[2]);
        height = (uint32_t)atoi(argv[3]);
    }

    ShaderType type = detect_shader_type(wasm_path);

    // Calculate memory buffer and pixel offset exactly matching each shader's web layout
    uint32_t total_size = 0;
    uint32_t pixel_offset = 0;

    if (type == SHADER_TYPE_PATHTRACER) {
        // Path tracer needs: 32 bytes (headers) + W*H*12 (accumulation buffer) + W*H*4 (pixel buffer)
        total_size = 32 + (width * height * 12) + (width * height * 4);
        pixel_offset = 32 + (width * height * 12);
    } else if (type == SHADER_TYPE_INTERACTIVE) {
        total_size = 20 + (width * height * 4);
        pixel_offset = 20;
    } else if (type == SHADER_TYPE_PHYSICS) {
        total_size = 24 + (width * height * 4);
        pixel_offset = 24;
    } else {
        total_size = 8 + (width * height * 4);
        pixel_offset = 8;
    }

    printf("====================================================\n");
    printf(" Wash Native SDL2 Runner\n");
    printf("====================================================\n");
    printf("WASM Shader : %s\n", wasm_path);
    printf("Resolution  : %ux%u\n", width, height);
    printf("Buffer Size : %.2f MB\n", (double)total_size / (1024.0 * 1024.0));
    printf("Pixel Offset: %u bytes\n", pixel_offset);
    if (type == SHADER_TYPE_PATHTRACER) {
        printf("Controls    : Click & Drag mouse to look, W/A/S/D to move, ESC to exit.\n");
    }

    // Initialize SDL2
    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        fprintf(stderr, "SDL_Init Error: %s\n", SDL_GetError());
        return 1;
    }

    char title[128];
    snprintf(title, sizeof(title), "Wash Native SDL2 - %s (%ux%u)", wasm_path, width, height);

    SDL_Window* window = SDL_CreateWindow(
        title,
        SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
        width, height,
        SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE
    );
    if (!window) {
        fprintf(stderr, "SDL_CreateWindow Error: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }

    SDL_Renderer* renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
    if (!renderer) {
        renderer = SDL_CreateRenderer(window, -1, 0);
    }

    SDL_Texture* texture = SDL_CreateTexture(
        renderer,
        SDL_PIXELFORMAT_RGBA32,
        SDL_TEXTUREACCESS_STREAMING,
        width, height
    );

#if defined(USE_WASM3)
    wash_t w;
    if (!wash_init(&w, wasm_path, total_size)) {
        fprintf(stderr, "Failed to load WASM shader: %s\n", wasm_path);
        SDL_DestroyTexture(texture);
        SDL_DestroyRenderer(renderer);
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }
#else
    uint8_t* fake_memory = (uint8_t*)calloc(1, total_size);
#endif

    bool running = true;
    SDL_Event event;

    // Interaction state
    float mouseX = 0.5f, mouseY = 0.5f;
    uint32_t isMouseDown = 0;
    bool isDragging = false;

    // Camera state for 3D shaders (Path Tracer)
    float camX = 0.0f, camY = 0.5f, camZ = 1.0f;
    float pitch = 0.0f, yaw = 3.14159265f;
    uint32_t frameCount = 0;
    bool key_w = false, key_a = false, key_s = false, key_d = false;

    uint32_t frame_count = 0;
    uint32_t last_fps_time = SDL_GetTicks();

    while (running) {
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT) {
                running = false;
            } else if (event.type == SDL_KEYDOWN) {
                if (event.key.keysym.sym == SDLK_ESCAPE) running = false;
                if (event.key.keysym.sym == SDLK_w) key_w = true;
                if (event.key.keysym.sym == SDLK_a) key_a = true;
                if (event.key.keysym.sym == SDLK_s) key_s = true;
                if (event.key.keysym.sym == SDLK_d) key_d = true;
            } else if (event.type == SDL_KEYUP) {
                if (event.key.keysym.sym == SDLK_w) key_w = false;
                if (event.key.keysym.sym == SDLK_a) key_a = false;
                if (event.key.keysym.sym == SDLK_s) key_s = false;
                if (event.key.keysym.sym == SDLK_d) key_d = false;
            } else if (event.type == SDL_MOUSEMOTION) {
                int win_w, win_h;
                SDL_GetWindowSize(window, &win_w, &win_h);
                mouseX = (float)event.motion.x / (float)win_w;
                mouseY = (float)event.motion.y / (float)win_h;

                if (isDragging) {
                    yaw -= (float)event.motion.xrel * 0.005f;
                    pitch -= (float)event.motion.yrel * 0.005f;
                    if (pitch > 1.57f) pitch = 1.57f;
                    if (pitch < -1.57f) pitch = -1.57f;
                    frameCount = 0; // Reset accumulation for Fast Preview
                }
            } else if (event.type == SDL_MOUSEBUTTONDOWN) {
                isMouseDown = 1;
                if (event.button.button == SDL_BUTTON_LEFT) isDragging = true;
            } else if (event.type == SDL_MOUSEBUTTONUP) {
                isMouseDown = 0;
                if (event.button.button == SDL_BUTTON_LEFT) isDragging = false;
            }
        }

        // Process WASD camera movement for Path Tracer
        bool moved = false;
        if (key_w || key_a || key_s || key_d) {
            moved = true;
            const float speed = 0.05f;
            float s = sinf(yaw);
            float c = cosf(yaw);

            if (key_w) { camX += -s * speed; camZ += c * speed; }
            if (key_s) { camX -= -s * speed; camZ -= c * speed; }
            if (key_d) { camX -= c * speed; camZ -= s * speed; }
            if (key_a) { camX += c * speed; camZ += s * speed; }

            frameCount = 0; // Trigger Fast Preview
        }

        float time_ms = (float)SDL_GetTicks();
        uint8_t* buffer_ptr = NULL;

#if defined(USE_WASM3)
        buffer_ptr = w.buffer;
#else
        buffer_ptr = fake_memory;
#endif

        // Write uniforms into WASM memory exactly like the JS frontend does
        *(uint32_t*)(buffer_ptr + 0) = width;
        *(uint32_t*)(buffer_ptr + 4) = height;

        if (type == SHADER_TYPE_INTERACTIVE) {
            *(float*)(buffer_ptr + 8) = time_ms;
            *(float*)(buffer_ptr + 12) = mouseX;
            *(float*)(buffer_ptr + 16) = mouseY;
        } else if (type == SHADER_TYPE_PHYSICS) {
            *(float*)(buffer_ptr + 8) = mouseX;
            *(float*)(buffer_ptr + 12) = mouseY;
            *(uint32_t*)(buffer_ptr + 16) = isMouseDown;
            *(float*)(buffer_ptr + 20) = time_ms;
        } else if (type == SHADER_TYPE_PATHTRACER) {
            *(uint32_t*)(buffer_ptr + 8) = frameCount;
            *(float*)(buffer_ptr + 12) = camX;
            *(float*)(buffer_ptr + 16) = camY;
            *(float*)(buffer_ptr + 20) = camZ;
            *(float*)(buffer_ptr + 24) = pitch;
            *(float*)(buffer_ptr + 28) = yaw;
        }

#if defined(USE_WASM3)
        // Execute shader function
        wash_run(&w);
#endif

        if (type == SHADER_TYPE_PATHTRACER) {
            // Read updated frameCount from WASM memory (the shader increments it)
            frameCount = *(uint32_t*)(buffer_ptr + 8);
        }

        // Stream output RGBA pixels directly to SDL2 Texture
        const uint8_t* pixels = buffer_ptr + pixel_offset;
        SDL_UpdateTexture(texture, NULL, pixels, width * 4);

        // Render texture to screen
        SDL_RenderClear(renderer);
        SDL_RenderCopy(renderer, texture, NULL, NULL);
        SDL_RenderPresent(renderer);

        frame_count++;
        uint32_t now = SDL_GetTicks();
        if (now - last_fps_time >= 1000) {
            float fps = (frame_count * 1000.0f) / (float)(now - last_fps_time);
            if (type == SHADER_TYPE_PATHTRACER) {
                snprintf(title, sizeof(title), "Wash SDL2 - %s [Samples: %u | %.1f FPS]", wasm_path, frameCount, fps);
            } else {
                snprintf(title, sizeof(title), "Wash SDL2 - %s [%.1f FPS | %ux%u]", wasm_path, fps, width, height);
            }
            SDL_SetWindowTitle(window, title);
            frame_count = 0;
            last_fps_time = now;
        }
    }

    // Cleanup
#if defined(USE_WASM3)
    wash_free(&w);
#else
    free(fake_memory);
#endif

    SDL_DestroyTexture(texture);
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();

    printf("Wash SDL2 runner closed successfully.\n");
    return 0;
}
