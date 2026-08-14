#ifndef WASH_H
#define WASH_H

#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

/**
 * wash.h - Native C Host API for Wash Shaders
 * Equivalent to wash.js for native C/C++ environments.
 */

#include "wasm3.h"
#include "m3_env.h"
#include "m3_core.h"

typedef struct {
    IM3Environment env;
    IM3Runtime runtime;
    IM3Module module;
    IM3Function start_fn;
    uint8_t* memory;
    uint32_t memory_size;
    uint32_t heap_base;
    uint8_t* buffer;      // Pointer to user data starting at heap_base
    uint32_t buffer_size;
    uint8_t* wasm_bytes;
} wash_t;

static inline int wash_init(wash_t* w, const char* wasm_path, uint32_t user_size) {
    memset(w, 0, sizeof(wash_t));

    FILE* f = fopen(wasm_path, "rb");
    if (!f) {
        fprintf(stderr, "[wash] Error: Could not open WASM file: %s\n", wasm_path);
        return 0;
    }
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);

    w->wasm_bytes = (uint8_t*)malloc(fsize);
    if (!w->wasm_bytes || fread(w->wasm_bytes, 1, fsize, f) != (size_t)fsize) {
        fclose(f);
        return 0;
    }
    fclose(f);

    w->env = m3_NewEnvironment();
    if (!w->env) return 0;

    // Allocate 128KB stack
    w->runtime = m3_NewRuntime(w->env, 128 * 1024, NULL);
    if (!w->runtime) return 0;

    M3Result result = m3_ParseModule(w->env, &w->module, w->wasm_bytes, fsize);
    if (result) {
        fprintf(stderr, "[wash] m3_ParseModule error: %s\n", result);
        return 0;
    }

    result = m3_LoadModule(w->runtime, w->module);
    if (result) {
        fprintf(stderr, "[wash] m3_LoadModule error: %s\n", result);
        return 0;
    }

    result = m3_FindFunction(&w->start_fn, w->runtime, "_start");
    if (result) {
        fprintf(stderr, "[wash] m3_FindFunction '_start' error: %s\n", result);
        return 0;
    }

    // Default fallback heap_base = 64KB (65536)
    w->heap_base = 65536;

    // Automatic reading of __heap_base if exported by the compiler (like in wash.js)
    IM3Global g_heap = m3_FindGlobal(w->module, "__heap_base");
    if (g_heap) {
        M3TaggedValue g_val;
        if (m3_GetGlobal(g_heap, &g_val) == m3Err_none) {
            w->heap_base = (uint32_t)g_val.value.i32;
        }
    }

    w->memory = m3_GetMemory(w->runtime, &w->memory_size, 0);

    // Ensure memory is large enough for heap_base + user_size
    uint32_t required_bytes = w->heap_base + user_size;
    if (w->memory_size < required_bytes) {
        uint32_t num_pages = (required_bytes + 65535) / 65536;
        size_t total_alloc = sizeof(M3MemoryHeader) + (size_t)num_pages * 65536;
        M3MemoryHeader* new_header = (M3MemoryHeader*)realloc(w->runtime->memory.mallocated, total_alloc);
        if (new_header) {
            new_header->runtime = w->runtime;
            new_header->length = (size_t)num_pages * 65536;
            w->runtime->memory.mallocated = new_header;
            w->runtime->memory.numPages = num_pages;
            w->memory = m3_GetMemory(w->runtime, &w->memory_size, 0);
        }
    }

    if (!w->memory) {
        fprintf(stderr, "[wash] Error: Failed to acquire WASM linear memory.\n");
        return 0;
    }

    w->buffer = w->memory + w->heap_base;
    w->buffer_size = user_size;
    return 1;
}

static inline int wash_run(wash_t* w) {
    M3Result result = m3_CallV(w->start_fn, w->heap_base);
    if (result) {
        fprintf(stderr, "[wash] Execution error: %s\n", result);
        return 0;
    }
    return 1;
}

static inline void wash_free(wash_t* w) {
    if (w->runtime) m3_FreeRuntime(w->runtime);
    if (w->env) m3_FreeEnvironment(w->env);
    if (w->wasm_bytes) free(w->wasm_bytes);
}

#endif // WASH_H
