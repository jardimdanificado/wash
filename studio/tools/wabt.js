// WABT Driver (wat2wasm, wasm2wat, wasm-decompile)
// WebAssembly Binary Toolkit integration

let wabtInstance = null;

export async function initWabt() {
    if (!wabtInstance) {
        if (!window.WabtModule) {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://unpkg.com/wabt@1.0.35/index.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load WABT from CDN"));
                document.head.appendChild(script);
            });
        }
        wabtInstance = await window.WabtModule();
    }
    return wabtInstance;
}

/**
 * Converts WebAssembly Text (WAT) to WASM binary
 * @param {string} watCode 
 * @param {object} options 
 * @returns {Promise<Uint8Array>}
 */
export async function watToWasm(watCode, options = {}) {
    const wabt = await initWabt();
    const features = {
        exceptions: true,
        mutable_globals: true,
        sat_float_to_int: true,
        sign_extension: true,
        simd: true,
        threads: true,
        multi_value: true,
        tail_call: true,
        bulk_memory: true,
        reference_types: true,
        annotations: true,
        gc: true,
        ...(options.features || {})
    };

    let module;
    try {
        module = wabt.parseWat("input.wat", watCode, features);
        const { buffer } = module.toBinary({
            log: false,
            canonicalize_lebs: true,
            relocatable: false,
            write_debug_names: true
        });
        return buffer;
    } finally {
        if (module) module.destroy();
    }
}

/**
 * Converts WASM binary to WebAssembly Text (WAT)
 * @param {Uint8Array|ArrayBuffer} wasmBytes 
 * @param {object} options 
 * @returns {Promise<string>}
 */
export async function wasmToWat(wasmBytes, options = {}) {
    const wabt = await initWabt();
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    const features = {
        exceptions: true,
        mutable_globals: true,
        sat_float_to_int: true,
        sign_extension: true,
        simd: true,
        threads: true,
        multi_value: true,
        tail_call: true,
        bulk_memory: true,
        reference_types: true,
        annotations: true,
        gc: true,
        ...(options.features || {})
    };

    let module;
    try {
        module = wabt.readWasm(bytes, { readDebugNames: true, ...features });
        module.generateNames();
        module.applyNames();
        return module.toText({
            foldExprs: options.foldExprs !== undefined ? options.foldExprs : false,
            inlineExport: options.inlineExport !== undefined ? options.inlineExport : false
        });
    } finally {
        if (module) module.destroy();
    }
}

/**
 * Decompiles WASM binary into C-like pseudo-code (wasm-decompile)
 * @param {Uint8Array|ArrayBuffer} wasmBytes 
 * @returns {Promise<string>}
 */
export async function wasmDecompile(wasmBytes) {
    const wabt = await initWabt();
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    let module;
    try {
        module = wabt.readWasm(bytes, { readDebugNames: true });
        module.generateNames();
        module.applyNames();
        return module.toDecompile({ inlineExport: true });
    } finally {
        if (module) module.destroy();
    }
}
