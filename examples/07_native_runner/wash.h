#ifndef WASH_H
#define WASH_H

#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

/**
 * wash.h - Native C Host API for Wash Shaders
 * Equivalent to wash.js for native C/C++ environments using Wasm3.
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

typedef struct {
    IM3Module module;
    IM3Function start_fn;
    uint32_t heap_base;
} wash_shader_t;

typedef struct {
    IM3Environment env;
    IM3Runtime runtime;
    uint8_t* memory;
    uint32_t memory_size;
    uint32_t heap_base;
    uint8_t* buffer;
    uint32_t user_size;
} wash_runtime_t;

// Single-shader convenience loader
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

    w->heap_base = 65536;
    IM3Global g_heap = m3_FindGlobal(w->module, "__heap_base");
    if (g_heap) {
        M3TaggedValue g_val;
        if (m3_GetGlobal(g_heap, &g_val) == m3Err_none) {
            w->heap_base = (uint32_t)g_val.value.i32;
        }
    }

    w->memory = m3_GetMemory(w->runtime, &w->memory_size, 0);
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

// -------------------------------------------------------------
// Multi-shader shared memory pipeline API
// -------------------------------------------------------------
static inline int wash_runtime_init(wash_runtime_t* rt, uint32_t user_size) {
    memset(rt, 0, sizeof(wash_runtime_t));
    rt->env = m3_NewEnvironment();
    if (!rt->env) return 0;

    rt->runtime = m3_NewRuntime(rt->env, 128 * 1024, NULL);
    if (!rt->runtime) return 0;

    rt->heap_base = 65536;
    rt->user_size = user_size;
    return 1;
}

static inline int wash_shader_load(wash_runtime_t* rt, wash_shader_t* s, const char* wasm_path) {
    FILE* f = fopen(wasm_path, "rb");
    if (!f) return 0;
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);

    uint8_t* bytes = (uint8_t*)malloc(fsize);
    if (!bytes || fread(bytes, 1, fsize, f) != (size_t)fsize) {
        fclose(f);
        if (bytes) free(bytes);
        return 0;
    }
    fclose(f);

    M3Result res = m3_ParseModule(rt->env, &s->module, bytes, fsize);
    if (res) { free(bytes); return 0; }

    res = m3_LoadModule(rt->runtime, s->module);
    if (res) { free(bytes); return 0; }

    res = m3_FindFunction(&s->start_fn, rt->runtime, "_start");
    if (res) { free(bytes); return 0; }

    s->heap_base = 65536;
    IM3Global g = m3_FindGlobal(s->module, "__heap_base");
    if (g) {
        M3TaggedValue val;
        if (m3_GetGlobal(g, &val) == m3Err_none) s->heap_base = (uint32_t)val.value.i32;
    }

    // Ensure memory is sized for this runtime
    rt->memory = m3_GetMemory(rt->runtime, &rt->memory_size, 0);
    uint32_t required = rt->heap_base + rt->user_size;
    if (rt->memory_size < required) {
        uint32_t num_pages = (required + 65535) / 65536;
        size_t total_alloc = sizeof(M3MemoryHeader) + (size_t)num_pages * 65536;
        M3MemoryHeader* new_header = (M3MemoryHeader*)realloc(rt->runtime->memory.mallocated, total_alloc);
        if (new_header) {
            new_header->runtime = rt->runtime;
            new_header->length = (size_t)num_pages * 65536;
            rt->runtime->memory.mallocated = new_header;
            rt->runtime->memory.numPages = num_pages;
            rt->memory = m3_GetMemory(rt->runtime, &rt->memory_size, 0);
        }
    }
    rt->buffer = rt->memory + rt->heap_base;
    return 1;
}

static inline int wash_shader_run(wash_runtime_t* rt, wash_shader_t* s) {
    M3Result res = m3_CallV(s->start_fn, rt->heap_base);
    return res == m3Err_none;
}

#endif // WASH_H
