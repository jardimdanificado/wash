/**
 * Laundry - In-Browser C to WebAssembly Compiler Driver
 */

let activeWorker = null;
let compileIdCounter = 0;
const pendingCompiles = new Map();

/**
 * Initializes or retrieves the compiler Web Worker.
 * @param {object} options
 * @returns {Worker}
 */
export function getCompilerWorker(options = {}) {
    if (!activeWorker) {
        const workerUrl = options.workerUrl || new URL("./compiler-worker.js", import.meta.url).href;
        activeWorker = new Worker(workerUrl, { type: "module" });

        activeWorker.onmessage = (e) => {
            const { id, status, wasmBytes, outFileName, logs, error } = e.data;
            const resolver = pendingCompiles.get(id);
            if (!resolver) return;
            pendingCompiles.delete(id);

            if (status === "ok") {
                resolver.resolve({
                    wasmBytes: new Uint8Array(wasmBytes),
                    outFileName,
                    logs
                });
            } else {
                const err = new Error(error || "Compilation failed");
                err.logs = logs;
                resolver.reject(err);
            }
        };

        activeWorker.onerror = (err) => {
            for (const [, resolver] of pendingCompiles.entries()) {
                resolver.reject(new Error(`Compiler Worker error: ${err.message || String(err)}`));
            }
            pendingCompiles.clear();
        };
    }
    return activeWorker;
}

/**
 * Terminates the current compiler worker to free resources.
 */
export function terminateCompilerWorker() {
    if (activeWorker) {
        try { activeWorker.terminate(); } catch (_) {}
        activeWorker = null;
        pendingCompiles.clear();
    }
}

/**
 * Compiles C source code to WebAssembly binary (.wasm).
 * @param {string} cCode - The C source code string
 * @param {object} options - Options: { filename?: string, baseDir?: string, workerUrl?: string }
 * @returns {Promise<{ wasmBytes: Uint8Array, outFileName: string, logs: string }>}
 */
export function compileC(cCode, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const worker = getCompilerWorker(options);
            const id = ++compileIdCounter;
            const filename = options.filename || "shader.c";
            const baseDir = options.baseDir || "";
            const entryPoint = options.entryPoint || "";

            pendingCompiles.set(id, { resolve, reject });

            worker.postMessage({
                id,
                type: "compile",
                filename,
                code: cCode,
                baseDir,
                entryPoint
            });
        } catch (err) {
            reject(err);
        }
    });
}
