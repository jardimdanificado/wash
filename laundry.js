/**
 * Laundry - Standalone WebAssembly Developer Tooling & Compilation SDK
 * 
 * Provides in-browser C compilation to WebAssembly, Binaryen optimizations (wasm-opt),
 * WABT binary/text utilities (wat2wasm, wasm2wat, wasm-decompile), WASM structure inspection & sandbox execution,
 * built-in project presets, and ZIP archive export/import.
 */

// C Compilation
export { compileC, getCompilerWorker, terminateCompilerWorker } from "./tools/compiler.js";

// Binaryen wasm-opt
export { optimizeWasm, initBinaryen } from "./tools/binaryen.js";

// WABT (wat2wasm, wasm2wat, wasm-decompile)
export { watToWasm, wasmToWat, wasmDecompile, initWabt } from "./tools/wabt.js";

// WASM Inspection & Sandboxed Runner
export { inspectWasm, instantiateWasm } from "./tools/runner.js";

// Project Presets & Templates
export { PRESETS, getPresets, getPreset } from "./tools/presets.js";

// Standalone ZIP Project Export & Import
export { exportProjectZip, importProjectZip, initJSZip } from "./tools/zip.js";

// WebAssembly Bytecode Memory Transform
export { makeWasmImportMemory } from "./wash.js";
