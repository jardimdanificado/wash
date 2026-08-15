/**
 * Wash - WebAssembly Shared Memory & Universal Compute API
 */

let globalShaderCounter = 0;

// Safety registry to automatically clean up workers if forgotten by GC
const workerRegistry = typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry(w => { try { w.terminate(); } catch (_) {} })
    : null;

/**
 * Transforms an unlinked WebAssembly module with internal memory into
 * an imported memory module that imports (env, memory).
 * Strictly preserves WebAssembly numerical section ordering.
 */
export function makeWasmImportMemory(bytes) {
    const u8 = new Uint8Array(bytes);
    if (u8.length < 8) return bytes;
    if (u8[0] !== 0x00 || u8[1] !== 0x61 || u8[2] !== 0x73 || u8[3] !== 0x6d) return bytes;

    let pos = 8;
    const sections = [];

    while (pos < u8.length) {
        const secStart = pos;
        const secId = u8[pos++];
        let len = 0, shift = 0;
        let valid = false;
        while (pos < u8.length) {
            const b = u8[pos++];
            len |= (b & 0x7f) << shift;
            shift += 7;
            if ((b & 0x80) === 0) {
                valid = true;
                break;
            }
        }
        if (!valid) break;
        const secEnd = pos + len;
        if (secEnd > u8.length) break;
        sections.push({ id: secId, data: u8.slice(secStart, secEnd) });
        pos = secEnd;
    }

    const hasImport = sections.some(s => s.id === 2);
    const hasMemorySec = sections.some(s => s.id === 5);

    if (!hasImport && hasMemorySec) {
        const importPayload = new Uint8Array([
            0x02, 0x0f, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x01
        ]);

        const newSections = [];
        let importInserted = false;

        for (const s of sections) {
            if (s.id === 5) {
                // Remove Section 5 (Memory) since memory is now imported in Section 2
                continue;
            }
            if (s.id > 2 && !importInserted) {
                newSections.push(importPayload);
                importInserted = true;
            }
            newSections.push(s.data);
        }

        if (!importInserted) {
            newSections.push(importPayload);
        }

        let totalLen = 8;
        for (const s of newSections) totalLen += s.length;

        const out = new Uint8Array(totalLen);
        out.set(u8.slice(0, 8), 0);
        let cur = 8;
        for (const s of newSections) {
            out.set(s, cur);
            cur += s.length;
        }

        return out;
    }

    return bytes;
}

/**
 * Reads a null-terminated UTF-8 string from a WebAssembly memory buffer at the given pointer.
 */
export function wash_read_string(memoryOrBuffer, ptr) {
    if (!memoryOrBuffer || ptr === 0) return "";
    const buf = memoryOrBuffer.buffer || memoryOrBuffer;
    const u8 = new Uint8Array(buf);
    let len = 0;
    while (ptr + len < u8.length && u8[ptr + len] !== 0) {
        len++;
    }
    return new TextDecoder().decode(u8.subarray(ptr, ptr + len));
}

/**
 * Writes a UTF-8 null-terminated string into a memory buffer at the given byte offset.
 */
export function wash_write_string(memoryOrBuffer, str, offset = 0) {
    const buf = memoryOrBuffer.buffer || memoryOrBuffer;
    const bytes = new TextEncoder().encode(str + "\0");
    new Uint8Array(buf, offset, bytes.length).set(bytes);
    return offset;
}

/**
 * Encodes complex JS types (strings, typed arrays, arrays, booleans, wash_memory)
 * into numeric Wasm values or heap pointers.
 */
function resolveArg(arg, targetMemory, scratchOffset = 0) {
    if (arg === null || arg === undefined) return 0;
    if (typeof arg === "number") return arg;
    if (typeof arg === "bigint") return arg;
    if (typeof arg === "boolean") return arg ? 1 : 0;

    // 1. wash_memory object
    if (arg && typeof arg === "object" && arg.heapBase !== undefined) {
        return arg.heapBase;
    }

    // 2. String -> UTF-8 pointer with \0
    if (typeof arg === "string") {
        if (!targetMemory) throw new Error("[Wash] Cannot pass string argument without an attached memory buffer.");
        const encoder = new TextEncoder();
        const bytes = encoder.encode(arg + "\0");
        targetMemory.ensureSize?.(scratchOffset + bytes.length + 1024);
        const ptr = targetMemory.heapBase + scratchOffset;
        new Uint8Array(targetMemory.buffer, ptr, bytes.length).set(bytes);
        return ptr;
    }

    // 3. TypedArray / ArrayBufferView
    if (ArrayBuffer.isView(arg)) {
        if (targetMemory && arg.buffer === targetMemory.buffer) {
            return arg.byteOffset;
        }
        if (!targetMemory) throw new Error("[Wash] Cannot pass TypedArray without an attached memory buffer.");
        const bytes = new Uint8Array(arg.buffer, arg.byteOffset, arg.byteLength);
        targetMemory.ensureSize?.(scratchOffset + bytes.length + 1024);
        const ptr = targetMemory.heapBase + scratchOffset;
        new Uint8Array(targetMemory.buffer, ptr, bytes.length).set(bytes);
        return ptr;
    }

    // 4. Array of Numbers
    if (Array.isArray(arg)) {
        if (!targetMemory) throw new Error("[Wash] Cannot pass Array without an attached memory buffer.");
        const floats = new Float32Array(arg);
        const bytes = new Uint8Array(floats.buffer);
        targetMemory.ensureSize?.(scratchOffset + bytes.length + 1024);
        const ptr = targetMemory.heapBase + scratchOffset;
        new Uint8Array(targetMemory.buffer, ptr, bytes.length).set(bytes);
        return ptr;
    }

    // Fallback: convert to number or return as-is
    return Number(arg) || 0;
}

/**
 * Creates or wraps a shared WebAssembly.Memory buffer for multi-shader pipelines.
 * @param {number} userSize Size in bytes needed by your application
 * @param {number} heapBase Base offset where data begins (default: 65536)
 */
export function wash_memory(userSize = 65536, heapBase = 65536) {
    const totalRequired = heapBase + userSize;
    const pages = Math.ceil(totalRequired / 65536);
    
    let memory = new WebAssembly.Memory({
        initial: pages
    });

    const wrapper = {
        get memory() { return memory; },
        set memory(m) { memory = m; },
        heapBase,
        userSize,
        get buffer() { return memory.buffer; },
        get u8() { return new Uint8Array(memory.buffer, heapBase, userSize); },
        get view() { return new DataView(memory.buffer, heapBase, userSize); },
        rawU8(offset = 0, size = userSize) {
            return new Uint8Array(memory.buffer, heapBase + offset, size);
        },
        rawView(offset = 0, size = userSize) {
            return new DataView(memory.buffer, heapBase + offset, size);
        },
        readString(ptr) {
            return wash_read_string(memory, ptr);
        },
        writeString(str, offset = 0) {
            return wash_write_string(memory, str, heapBase + offset);
        },
        grow(additionalBytes) {
            const neededPages = Math.ceil((memory.buffer.byteLength + additionalBytes) / 65536);
            const currentPages = memory.buffer.byteLength / 65536;
            if (neededPages > currentPages) {
                memory.grow(neededPages - currentPages);
            }
        },
        ensureSize(size) {
            const neededPages = Math.ceil((heapBase + size) / 65536);
            const currentPages = memory.buffer.byteLength / 65536;
            if (neededPages > currentPages) {
                memory.grow(neededPages - currentPages);
            }
        }
    };

    return wrapper;
}

/**
 * Loads and instantiates a WASM shader, optionally attaching a shared memory.
 * @param {string|WebAssembly.Module|Uint8Array|ArrayBuffer} source URL, pre-compiled Module, or bytes
 * @param {object|WebAssembly.Memory} sharedMemory Optional shared memory wrapper or WebAssembly.Memory
 * @param {object} imports Extra imports
 */
export async function wash_load(source, sharedMemory = null, imports = {}) {
    let actualSource = source;
    let actualSharedMemory = sharedMemory;
    let actualImports = imports;

    if (source && typeof source === "object" && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer) && !(source instanceof WebAssembly.Module)) {
        if (source.wasm || source.url || source.source) {
            actualSource = source.wasm || source.url || source.source;
            actualSharedMemory = source.memory || source.sharedMemory || sharedMemory;
            actualImports = source.imports || imports;
        }
    }

    const finalImports = { ...actualImports };

    let memObj = null;
    let heapBase = 65536;
    let userSize = 0;

    const wasiProxy = new Proxy(finalImports.wasi_snapshot_preview1 || {}, {
        get: (target, prop) => {
            if (prop in target) return target[prop];
            return () => 0;
        }
    });
    finalImports.wasi_snapshot_preview1 = wasiProxy;

    if (actualSharedMemory) {
        memObj = actualSharedMemory.memory ? actualSharedMemory.memory : actualSharedMemory;
        if (actualSharedMemory.heapBase) heapBase = actualSharedMemory.heapBase;
        if (actualSharedMemory.userSize) userSize = actualSharedMemory.userSize;
        
        finalImports.env = finalImports.env || {};
        finalImports.env.memory = memObj;
    }

    let instance;
    let module = null;

    if (typeof actualSource === "string") {
        try {
            const res = await WebAssembly.instantiateStreaming(fetch(actualSource), finalImports);
            instance = res.instance;
            module = res.module;
        } catch (_) {
            const res = await fetch(actualSource);
            const bytes = await res.arrayBuffer();
            const compiled = await WebAssembly.instantiate(bytes, finalImports);
            instance = compiled.instance || compiled;
            module = compiled.module;
        }
    } else if (actualSource instanceof WebAssembly.Module) {
        module = actualSource;
        const res = await WebAssembly.instantiate(actualSource, finalImports);
        instance = (res instanceof WebAssembly.Instance) ? res : (res.instance || res);
    } else {
        const bytes = (actualSource instanceof Uint8Array)
            ? (actualSource.byteOffset === 0 && actualSource.byteLength === actualSource.buffer.byteLength
                ? actualSource.buffer
                : actualSource.buffer.slice(actualSource.byteOffset, actualSource.byteOffset + actualSource.byteLength))
            : actualSource;
        const compiled = await WebAssembly.instantiate(bytes, finalImports);
        instance = compiled.instance || compiled;
        module = compiled.module;
    }

    // If module declared and exported its own memory, connect wrapper to it
    if (instance.exports.memory) {
        memObj = instance.exports.memory;
        if (sharedMemory && typeof sharedMemory === "object" && "memory" in sharedMemory) {
            sharedMemory.memory = memObj;
        }
    }

    if (instance.exports.__heap_base) {
        heapBase = instance.exports.__heap_base.value;
        if (sharedMemory && typeof sharedMemory === "object") {
            sharedMemory.heapBase = heapBase;
        }
    }

    // Ensure memory has enough pages for userSize
    if (memObj && userSize > 0) {
        const requiredPages = Math.ceil((heapBase + userSize) / 65536);
        const currentPages = memObj.buffer.byteLength / 65536;
        if (requiredPages > currentPages) {
            memObj.grow(requiredPages - currentPages);
        }
    }

    const shaderId = ++globalShaderCounter;

    const shader = {
        id: shaderId,
        instance,
        module,
        exports: instance.exports,
        get memory() { return memObj; },
        heapBase,
        userSize,
        readString: (ptr) => wash_read_string(memObj, ptr),
        writeString: (str, offset = 0) => wash_write_string(memObj, str, heapBase + offset),
        run: (...args) => {
            const candidates = [
                instance.exports.v_start,
                instance.exports.render,
                instance.exports._start,
                instance.exports.main
            ].filter(fn => typeof fn === "function");

            const entry = candidates.find(fn => fn.length > 0) || candidates[0];
            if (!entry) return;
            if (args.length === 0) return entry(heapBase);

            let scratchOffset = userSize > 0 ? userSize : 65536;
            const finalArgs = args.map(arg => {
                const val = resolveArg(arg, sharedMemory, scratchOffset);
                if (typeof arg === "string" || Array.isArray(arg)) {
                    scratchOffset += 1024;
                }
                return val;
            });
            return entry(...finalArgs);
        }
    };

    return shader;
}

/**
 * Executes a WASM shader with any arbitrary arguments in any position.
 * Returns the exact return value of the C _start function.
 * @param {object} shader Loaded shader instance from wash_load
 * @param {...any} args Arguments passed to C function
 */
export function wash_run(shader, ...args) {
    return shader.run(...args);
}

/**
 * Creates an isolated, explicit background Web Worker for parallel execution.
 * Can be reused across any shaders, accepts any argument types, and has zero external files.
 */
export function wash_worker() {
    const workerScript = `
        let shaderInstances = new Map();

        function resolveWorkerArg(arg, memory, heapBase, scratchOffset) {
            if (arg === null || arg === undefined) return 0;
            if (typeof arg === "number" || typeof arg === "bigint") return arg;
            if (typeof arg === "boolean") return arg ? 1 : 0;
            if (arg && typeof arg === "object" && arg.__isWashMem) return heapBase;
            if (typeof arg === "string") {
                const encoder = new TextEncoder();
                const bytes = encoder.encode(arg + "\\0");
                const ptr = heapBase + scratchOffset;
                new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
                return ptr;
            }
            if (Array.isArray(arg)) {
                const floats = new Float32Array(arg);
                const bytes = new Uint8Array(floats.buffer);
                const ptr = heapBase + scratchOffset;
                new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
                return ptr;
            }
            return Number(arg) || 0;
        }

        self.onmessage = async (e) => {
            const { id, type, shaderId, module, userSize, args, copyMemoryBack, returnOffset, returnLength } = e.data;

            if (type === "run") {
                try {
                    let record = shaderInstances.get(shaderId);
                    const heapBaseFallback = 65536;
                    const neededBytes = Math.max(
                        Number(userSize) || 0,
                        (Number(returnOffset) || 0) + (Number(returnLength) || 0),
                        65536
                    );

                    if (!record) {
                        const totalBytes = heapBaseFallback + neededBytes;
                        const reqPages = Math.max(2, Math.ceil(totalBytes / 65536));
                        
                        const workerMemory = new WebAssembly.Memory({ initial: reqPages });
                        const wasiProxy = new Proxy({}, {
                            get: (target, prop) => {
                                if (prop in target) return target[prop];
                                return () => 0;
                            }
                        });
                        const imports = {
                            env: { memory: workerMemory },
                            wasi_snapshot_preview1: wasiProxy
                        };

                        const res = await WebAssembly.instantiate(module, imports);
                        const instance = (res instanceof WebAssembly.Instance) ? res : (res.instance || res);
                        const memory = instance.exports.memory || workerMemory;
                        const heapBase = instance.exports.__heap_base ? instance.exports.__heap_base.value : heapBaseFallback;

                        record = { instance, memory, heapBase };
                        shaderInstances.set(shaderId, record);
                    }

                    const { instance, memory, heapBase } = record;

                    // Ensure worker memory has enough pages on EVERY run
                    const requiredTotal = heapBase + neededBytes;
                    const curPages = memory.buffer.byteLength / 65536;
                    const neededPages = Math.ceil(requiredTotal / 65536);
                    if (neededPages > curPages) {
                        memory.grow(neededPages - curPages);
                    }

                    let scratch = neededBytes;
                    const finalArgs = (args || []).map(arg => {
                        const val = resolveWorkerArg(arg, memory, heapBase, scratch);
                        if (typeof arg === "string" || Array.isArray(arg)) scratch += 1024;
                        return val;
                    });

                    const candidates = [
                        instance.exports.v_start,
                        instance.exports.render,
                        instance.exports._start,
                        instance.exports.main
                    ].filter(fn => typeof fn === "function");
                    const entry = candidates.find(fn => fn.length > 0) || candidates[0];
                    const ret = entry ? entry(...finalArgs) : undefined;

                    let transferBuffer = null;
                    if (returnLength > 0 && memory) {
                        const sliceU8 = new Uint8Array(memory.buffer, heapBase + (returnOffset || 0), returnLength);
                        transferBuffer = sliceU8.slice().buffer;
                    }

                    if (transferBuffer) {
                        self.postMessage({ id, status: "ok", result: ret, transferBuffer }, [transferBuffer]);
                    } else {
                        self.postMessage({ id, status: "ok", result: ret });
                    }
                } catch (err) {
                    self.postMessage({ id, status: "error", error: err.message });
                }
            }
        };
    `;

    const blob = new Blob([workerScript], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const nativeWorker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);

    let messageId = 0;
    const pending = new Map();

    nativeWorker.onmessage = (e) => {
        const { id, status, result, error, transferBuffer } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);

        if (status === "error") p.reject(new Error(error));
        else p.resolve({ result, transferBuffer });
    };

    nativeWorker.onerror = (err) => {
        for (const p of pending.values()) p.reject(err);
        pending.clear();
    };

    const workerHandle = {
        async run(shader, ...args) {
            const id = ++messageId;
            const module = shader.module || shader.instance;
            const shaderId = shader.id || 1;

            const serializedArgs = args.map(arg => {
                if (arg && typeof arg === "object" && arg.heapBase !== undefined) {
                    return { __isWashMem: true };
                }
                return arg;
            });

            let userSize = shader.userSize || (shader.memory ? shader.memory.buffer.byteLength : 0);
            for (const a of args) {
                if (a && typeof a === "object") {
                    if (a.userSize) userSize = Math.max(userSize, a.userSize);
                    if (a.buffer && a.buffer.byteLength) userSize = Math.max(userSize, a.buffer.byteLength);
                }
            }

            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                nativeWorker.postMessage({
                    id,
                    type: "run",
                    shaderId,
                    module,
                    userSize,
                    args: serializedArgs
                });
            }).then(res => res.result);
        },

        async runSlice(shader, returnOffset, returnLength, ...args) {
            const id = ++messageId;
            const module = shader.module || shader.instance;
            const shaderId = shader.id || 1;

            const serializedArgs = args.map(arg => {
                if (arg && typeof arg === "object" && arg.heapBase !== undefined) {
                    return { __isWashMem: true };
                }
                return arg;
            });

            let userSize = shader.userSize || (shader.memory ? shader.memory.buffer.byteLength : 0);
            for (const a of args) {
                if (a && typeof a === "object") {
                    if (a.userSize) userSize = Math.max(userSize, a.userSize);
                    if (a.buffer && a.buffer.byteLength) userSize = Math.max(userSize, a.buffer.byteLength);
                }
            }
            if (returnOffset !== undefined && returnLength !== undefined) {
                userSize = Math.max(userSize, (returnOffset || 0) + (returnLength || 0));
            }

            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                nativeWorker.postMessage({
                    id,
                    type: "run",
                    shaderId,
                    module,
                    userSize,
                    args: serializedArgs,
                    returnOffset,
                    returnLength
                });
            });
        },

        destroy() {
            nativeWorker.terminate();
            pending.clear();
        },

        // Support for ES2024 `using w = wash_worker()`
        [Symbol.dispose]() {
            this.destroy();
        }
    };

    workerRegistry?.register(workerHandle, nativeWorker);
    return workerHandle;
}

/**
 * Classic convenience shorthand for single-shader setups.
 */
export async function wash(url, size, imports = {}) {
    const mem = wash_memory(size);
    const shader = await wash_load(url, mem, imports);

    return {
        run: (...args) => shader.run(...args),
        memory: mem.memory,
        instance: shader.instance,
        u8: mem.u8,
        view: mem.view,
        readString: (ptr) => shader.readString(ptr),
        writeString: (str, offset = 0) => shader.writeString(str, offset)
    };
}

export const wash_shader = wash_load;
