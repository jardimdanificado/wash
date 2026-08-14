// Porffor Driver (JS -> C and JS -> WASM)
// CanadaHonk/porffor standalone compiler

globalThis.process ??= {
    argv: ["porffor-browser", "--target=c", "--quiet"],
    version: undefined,
    env: {}
};
globalThis.file = "script.js";

let porfforCompilePromise = null;

export async function initPorffor() {
    if (!porfforCompilePromise) {
        porfforCompilePromise = import(
            "https://esm.sh/gh/CanadaHonk/porffor/compiler/index.js?standalone&target=es2022"
        ).then(mod => mod.default);
    }
    return porfforCompilePromise;
}

/**
 * Transpiles JavaScript source code to C
 * @param {string} source 
 * @returns {Promise<{cCode: string, logs: string}>}
 */
export async function compileJsToC(source) {
    const compile = await initPorffor();
    const oldLog = console.log;
    let captured = "";

    console.log = (...args) => {
        captured += args.map(String).join(" ") + "\n";
    };

    try {
        await compile(source, false, false);
    } finally {
        console.log = oldLog;
    }

    return {
        cCode: captured,
        logs: captured ? "Porffor C generation completed." : "No output produced."
    };
}

/**
 * Compiles JavaScript source directly to WASM binary bytes
 * @param {string} source
 * @returns {Promise<{wasmBytes: Uint8Array, wasmHex: string}>}
 */
export async function compileJsToWasm(source) {
    const compile = await initPorffor();
    globalThis.process.argv = ["porffor-browser", "--target=wasm", "--quiet"];
    
    const res = await compile(source, false, false);
    if (res && res.wasm) {
        return {
            wasmBytes: new Uint8Array(res.wasm),
            wasmHex: Array.from(new Uint8Array(res.wasm)).map(b => b.toString(16).padStart(2, "0")).join(" ")
        };
    }
    throw new Error("Porffor did not produce a WASM binary object directly. Try generating C first.");
}
