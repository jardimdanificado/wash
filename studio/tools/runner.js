// Interactive WASM Runner & Inspector

/**
 * Inspects WASM binary structure (exports, imports, memory)
 * @param {Uint8Array|ArrayBuffer} wasmBytes 
 */
export async function inspectWasm(wasmBytes) {
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    const module = await WebAssembly.compile(bytes);

    const imports = WebAssembly.Module.imports(module);
    const exports = WebAssembly.Module.exports(module);

    return {
        size: bytes.byteLength,
        imports,
        exports
    };
}

/**
 * Instantiates and executes a WASM binary with an interactive sandbox
 * @param {Uint8Array|ArrayBuffer} wasmBytes 
 * @param {object} customImports 
 * @param {function} onLog 
 */
export async function instantiateWasm(wasmBytes, customImports = {}, onLog = console.log) {
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);

    let memory = null;

    const defaultImports = {
        env: {
            print: (val) => onLog(`[env.print] ${val}`),
            print_num: (val) => onLog(`[env.print_num] ${val}`),
            print_char: (ch) => onLog(String.fromCharCode(ch)),
            abort: () => onLog(`[ABORT called]`),
            ...customImports.env
        },
        wasi_snapshot_preview1: {
            proc_exit: (code) => onLog(`[WASI] proc_exit: ${code}`),
            fd_write: (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
                if (!memory) return 0;
                const view = new DataView(memory.buffer);
                const mem8 = new Uint8Array(memory.buffer);
                let totalWritten = 0;
                let text = "";

                for (let i = 0; i < iovs_len; i++) {
                    const ptr = view.getUint32(iovs_ptr + i * 8, true);
                    const len = view.getUint32(iovs_ptr + i * 8 + 4, true);
                    const slice = mem8.slice(ptr, ptr + len);
                    text += new TextDecoder().decode(slice);
                    totalWritten += len;
                }

                if (nwritten_ptr) {
                    view.setUint32(nwritten_ptr, totalWritten, true);
                }

                onLog(`[stdout/err] ${text.replace(/\n$/, '')}`);
                return 0;
            },
            fd_close: () => 0,
            fd_seek: () => 0,
            fd_read: () => 0,
            ...customImports.wasi_snapshot_preview1
        }
    };

    const result = await WebAssembly.instantiate(bytes, defaultImports);
    const instance = result.instance || result;

    if (instance.exports.memory) {
        memory = instance.exports.memory;
    }

    return {
        instance,
        module: result.module,
        exports: instance.exports,
        memory
    };
}
