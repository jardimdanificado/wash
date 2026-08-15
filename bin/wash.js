#!/usr/bin/env node

/**
 * Wash Terminal Canvas Runner
 * Zero-dependency WebAssembly shader, compute & multi-language pipeline runner for terminals.
 * Supports:
 *   - 24-bit TrueColor ANSI half-block rendering (▀) at 60 FPS
 *   - Interactive Mouse tracking (SGR mode) & Keyboard (WASD, Space, Q)
 *   - CPU Multi-threading / Slices across all available CPU cores (node:worker_threads)
 *   - Multi-Language Split Screen (simultaneously run C, Rust, Zig, AssemblyScript, V, WAT)
 *   - Auto-adaptive function signatures (1 to 12 arguments, bounds, uniforms, camera)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { wash_memory, wash_load, wash_run } from "../wash.js";

// =============================================================================
// Worker Thread Logic (Parallel Slices)
// =============================================================================
if (!isMainThread) {
    const { wasmBytes, width, height, totalSize, isPathTracer } = workerData;
    let shader = null;
    let mem = null;

    async function initWorker() {
        mem = wash_memory(totalSize);
        shader = await wash_load(wasmBytes, mem, {
            env: { console_log: () => {}, get_random: () => Math.random() }
        });
    }

    const initPromise = initWorker();

    parentPort.on("message", async (msg) => {
        await initPromise;
        const { startY, endY, frameCount, threadId, camX, camY, camZ, pitch, yaw, time, mouseX, mouseY, isMouseDown, returnSlice } = msg;

        if (isPathTracer) {
            // Correct argument order matching 08_parallel_pathtracer/main.c:
            // _start(data, width, height, frameCount, camX, camY, camZ, pitch, yaw, startY, endY, threadId, totalThreads)
            wash_run(shader, mem, width, height, frameCount, camX, camY, camZ, pitch, yaw, startY, endY, threadId, 1);
        } else {
            wash_run(shader, mem, width, height, time, 0, startY, width, endY);
        }

        // Extract rendered pixel slice to transfer back
        const pixelOffset = isPathTracer ? (width * height * 12) : 0;
        const sliceByteOffset = mem.heapBase + pixelOffset + (startY * width * 4);
        const sliceByteLength = (endY - startY) * width * 4;
        const slice = new Uint8Array(mem.buffer, sliceByteOffset, sliceByteLength);

        // Transfer copy back to main thread
        const copy = slice.slice().buffer;
        parentPort.postMessage({ threadId, startY, endY, buffer: copy }, [copy]);
    });
} else {
    // =============================================================================
    // Main Thread / CLI Process
    // =============================================================================
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        console.log(`
\x1b[1;33mWASH TERMINAL CANVAS RUNNER\x1b[0m
\x1b[90mZero-dependency WebAssembly shader & parallel pipeline runner in your terminal\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  wash <shader.wasm ...> [options]
  node bin/wash.js <shader.wasm ...> [options]

\x1b[1mOPTIONS:\x1b[0m
  -w, --width <num>       Custom canvas width in pixels (default: terminal columns)
  -h, --height <num>      Custom canvas height in pixels (default: 2x terminal rows)
  -f, --fps <num>         Target frames per second (default: 60)
  -t, --threads <num>     Number of parallel CPU worker threads (default: CPU cores)
  --no-mouse              Disable mouse tracking
  --help                  Show this help message

\x1b[1mEXAMPLES:\x1b[0m
  \x1b[36m# Single Shaders:\x1b[0m
  node bin/wash.js examples/04_interactive/main.wasm
  node bin/wash.js examples/05_physics/main.wasm
  node bin/wash.js examples/06_pathtracer/main.wasm

  \x1b[36m# Multi-Threaded Parallel Path Tracer (Workers & Slices):\x1b[0m
  node bin/wash.js examples/08_parallel_pathtracer/main.wasm --threads 8

  \x1b[36m# Multi-Language Split Screen (Simultaneously renders C, Rust, Zig, AS, V, WAT):\x1b[0m
  node bin/wash.js \\
    examples/11_multi_language_parallel/shader_c.wasm \\
    examples/11_multi_language_parallel/shader_rust.wasm \\
    examples/11_multi_language_parallel/shader_zig.wasm \\
    examples/11_multi_language_parallel/shader_as.wasm \\
    examples/11_multi_language_parallel/shader_v.wasm \\
    examples/11_multi_language_parallel/shader_wat.wasm

\x1b[1mCONTROLS:\x1b[0m
  \x1b[36mMouse Move / Drag\x1b[0m   Interact with shader (Julia fractals, particles, camera)
  \x1b[36mW, A, S, D\x1b[0m          Move camera in 3D raytracers
  \x1b[36mSpace\x1b[0m               Pause / Resume animation
  \x1b[36mQ / Esc / Ctrl+C\x1b[0m    Exit runner
`);
        process.exit(0);
    }

    const wasmFilePaths = [];
    let customWidth = null;
    let customHeight = null;
    let targetFps = 60;
    let numThreads = Math.max(1, os.cpus().length);
    let enableMouse = true;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-w" || arg === "--width") {
            customWidth = parseInt(args[++i], 10);
        } else if (arg === "-h" || arg === "--height") {
            customHeight = parseInt(args[++i], 10);
        } else if (arg === "-f" || arg === "--fps") {
            targetFps = parseInt(args[++i], 10) || 60;
        } else if (arg === "-t" || arg === "--threads") {
            numThreads = Math.max(1, parseInt(args[++i], 10) || 1);
        } else if (arg === "--no-mouse") {
            enableMouse = false;
        } else if (!arg.startsWith("-")) {
            wasmFilePaths.push(arg);
        }
    }

    if (wasmFilePaths.length === 0) {
        console.error("\x1b[31mError: No .wasm file specified.\x1b[0m");
        process.exit(1);
    }

    const resolvedWasmPaths = wasmFilePaths.map(f => path.resolve(process.cwd(), f));
    for (const p of resolvedWasmPaths) {
        if (!fs.existsSync(p)) {
            console.error(`\x1b[31mError: File not found: ${p}\x1b[0m`);
            process.exit(1);
        }
    }

    // =============================================================================
    // Terminal Raw Mode & Lifecycle
    // =============================================================================
    let isRawMode = false;
    let isCleanedUp = false;

    function setupTerminal() {
        if (process.stdout.isTTY) {
            process.stdout.write("\x1b[?1049h\x1b[?25l");
            if (enableMouse) {
                process.stdout.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
            }
        }

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding("utf8");
            isRawMode = true;
        }
    }

    function restoreTerminal() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        if (process.stdout.isTTY) {
            if (enableMouse) {
                process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1006l");
            }
            process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[0m");
        }

        if (isRawMode && process.stdin.isTTY) {
            try {
                process.stdin.setRawMode(false);
                process.stdin.pause();
            } catch (_) {}
        }
    }

    process.on("exit", restoreTerminal);
    process.on("SIGINT", () => { restoreTerminal(); process.exit(0); });
    process.on("SIGTERM", () => { restoreTerminal(); process.exit(0); });
    process.on("uncaughtException", (err) => {
        restoreTerminal();
        console.error("\x1b[31mUncaught Exception:\x1b[0m", err);
        process.exit(1);
    });

    // =============================================================================
    // User Interaction (Mouse & Keyboard)
    // =============================================================================
    let mouseX = 0.5;
    let mouseY = 0.5;
    let isMouseDown = 0;
    let isPaused = false;
    let frameCount = 0;
    let camX = 0.0, camY = 0.5, camZ = 1.0;
    let pitch = 0.0, yaw = Math.PI;

    const keys = { w: false, a: false, s: false, d: false };

    process.stdin.on("data", (data) => {
        if (data === "\u0003" || data === "q" || data === "Q" || data === "\u001b") {
            restoreTerminal();
            process.exit(0);
        }

        if (data === " ") {
            isPaused = !isPaused;
            return;
        }

        const lower = data.toLowerCase();
        if (lower === "w") { keys.w = true; setTimeout(() => keys.w = false, 100); }
        if (lower === "a") { keys.a = true; setTimeout(() => keys.a = false, 100); }
        if (lower === "s") { keys.s = true; setTimeout(() => keys.s = false, 100); }
        if (lower === "d") { keys.d = true; setTimeout(() => keys.d = false, 100); }

        if (enableMouse && data.startsWith("\x1b[<")) {
            const matches = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g);
            if (matches) {
                for (const m of matches) {
                    const parts = m.slice(3, -1).split(";");
                    const btn = parseInt(parts[0], 10);
                    const col = parseInt(parts[1], 10);
                    const row = parseInt(parts[2], 10);
                    const type = m.slice(-1);

                    const termCols = process.stdout.columns || 80;
                    const termRows = (process.stdout.rows || 24) - 1;

                    mouseX = Math.max(0, Math.min(1, (col - 1) / Math.max(1, termCols - 1)));
                    mouseY = Math.max(0, Math.min(1, (row - 1) / Math.max(1, termRows - 1)));

                    if (type === "M") {
                        if (btn === 0 || btn === 32) isMouseDown = 1;
                    } else if (type === "m") {
                        if (btn === 0) isMouseDown = 0;
                    }
                }
            }
        }
    });

    // =============================================================================
    // Main Runner Engine
    // =============================================================================
    async function main() {
        setupTerminal();

        const termCols = process.stdout.columns || 80;
        const termRows = process.stdout.rows || 24;

        const W = customWidth || termCols;
        const H = customHeight || Math.max(2, (termRows - 2) * 2);

        const isMultiShader = resolvedWasmPaths.length > 1;
        const firstFile = resolvedWasmPaths[0];

        const isParallelPathtracer = firstFile.includes("08_parallel_pathtracer") || firstFile.includes("parallel_pathtracer");
        const isPathtracer = isParallelPathtracer || firstFile.includes("pathtracer") || firstFile.includes("06");
        const isPhysics = firstFile.includes("physics") || firstFile.includes("05");

        // Unified output pixel buffer (RGBA)
        const framePixels = new Uint8Array(W * H * 4);

        // Multi-Worker Threads setup if parallel pathtracer or requested
        let workers = [];
        let isUsingWorkers = false;

        if (isParallelPathtracer && numThreads > 1) {
            isUsingWorkers = true;
            const wasmBytes = fs.readFileSync(firstFile);
            const totalSize = (W * H * 12) + (W * H * 4);

            for (let t = 0; t < numThreads; t++) {
                const w = new Worker(fileURLToPath(import.meta.url), {
                    workerData: { wasmBytes, width: W, height: H, totalSize, isPathTracer: true }
                });
                workers.push(w);
            }
        }

        // Shaders instance setup for single or multi-language split screen
        const loadedShaders = [];
        for (const filePath of resolvedWasmPaths) {
            const wasmBytes = fs.readFileSync(filePath);
            let totalSize = W * H * 4;
            if (isPathtracer) totalSize = (W * H * 12) + (W * H * 4);
            else if (isPhysics) totalSize = (W * H * 4) + (20000 * 28);

            const mem = wash_memory(totalSize);
            const shader = await wash_load(wasmBytes, mem, {
                env: { console_log: () => {}, get_random: () => Math.random() }
            });

            // Inspect export entry to determine arity
            const candidates = [
                shader.exports.v_start,
                shader.exports.render,
                shader.exports._start,
                shader.exports.main
            ].filter(fn => typeof fn === "function");
            const entry = candidates.find(fn => fn.length > 0) || candidates[0];
            const arity = entry ? entry.length : 0;

            loadedShaders.push({
                filePath,
                name: path.basename(filePath).replace(".wasm", ""),
                shader,
                mem,
                entry,
                arity
            });
        }

        let lastFpsTime = performance.now();
        let fpsFrames = 0;
        let currentFps = "0.0";
        const frameInterval = 1000 / targetFps;

        async function tick() {
            const now = performance.now();

            if (!isPaused) {
                // 3D Camera Controls
                if (keys.w || keys.s || keys.a || keys.d) {
                    const speed = 0.08;
                    const s = Math.sin(yaw), c = Math.cos(yaw);
                    if (keys.w) { camX += -s * speed; camZ += c * speed; }
                    if (keys.s) { camX -= -s * speed; camZ -= c * speed; }
                    if (keys.d) { camX -= c * speed; camZ -= s * speed; }
                    if (keys.a) { camX += c * speed; camZ += s * speed; }
                    frameCount = 0;
                }

                if (isMouseDown && isPathtracer) {
                    yaw = Math.PI + (mouseX - 0.5) * 2.5;
                    pitch = (mouseY - 0.5) * 1.5;
                    frameCount = 0;
                }

                // EXECUTION DISPATCH
                if (isUsingWorkers) {
                    // Multi-threaded CPU Slices
                    const sliceHeight = Math.ceil(H / numThreads);
                    const promises = workers.map((w, t) => {
                        const startY = t * sliceHeight;
                        const endY = Math.min(H, (t + 1) * sliceHeight);
                        return new Promise((resolve) => {
                            const handler = (msg) => {
                                if (msg.threadId === t) {
                                    w.off("message", handler);
                                    new Uint8Array(framePixels.buffer, msg.startY * W * 4, msg.buffer.byteLength).set(new Uint8Array(msg.buffer));
                                    resolve();
                                }
                            };
                            w.on("message", handler);
                            w.postMessage({ startY, endY, frameCount, threadId: t, camX, camY, camZ, pitch, yaw });
                        });
                    });
                    await Promise.all(promises);
                    frameCount++;
                } else if (isMultiShader) {
                    // Multi-Language Split Screen: Render vertical strips for each language
                    const numShaders = loadedShaders.length;
                    const stripWidth = Math.floor(W / numShaders);

                    for (let i = 0; i < numShaders; i++) {
                        const s = loadedShaders[i];
                        const startX = i * stripWidth;
                        const endX = (i === numShaders - 1) ? W : (i + 1) * stripWidth;
                        const startY = 0;
                        const endY = H;

                        // Execute with auto-adaptive arity
                        if (s.arity === 8) {
                            // (pixels, width, height, time, startX, startY, endX, endY)
                            s.shader.run(s.mem, W, H, now * 0.001, startX, startY, endX, endY);
                        } else if (s.arity === 4) {
                            s.shader.run(s.mem, W, H, now * 0.001);
                        } else {
                            s.shader.run(s.mem, W, H, now * 0.001, mouseX, mouseY, isMouseDown);
                        }

                        // Copy this strip to main framePixels buffer
                        const srcU8 = new Uint8Array(s.mem.buffer, s.mem.heapBase, W * H * 4);
                        for (let y = startY; y < endY; y++) {
                            const rowOffset = y * W * 4;
                            const srcStart = rowOffset + startX * 4;
                            const srcEnd = rowOffset + endX * 4;
                            framePixels.set(srcU8.subarray(srcStart, srcEnd), srcStart);
                        }
                    }
                } else {
                    // Single shader execution with automatic signature detection
                    const s = loadedShaders[0];
                    const pixelOffset = isPathtracer ? (W * H * 12) : 0;

                    if (s.arity >= 12 || isParallelPathtracer) {
                        // Parallel Pathtracer signature:
                        // _start(data, W, H, frameCount, camX, camY, camZ, pitch, yaw, startY, endY, threadId, totalThreads)
                        wash_run(s.shader, s.mem, W, H, frameCount, camX, camY, camZ, pitch, yaw, 0, H, 0, 1);
                        frameCount++;
                    } else if (s.arity === 9) {
                        frameCount = wash_run(s.shader, s.mem, W, H, frameCount, camX, camY, camZ, pitch, yaw) || (frameCount + 1);
                    } else if (s.arity === 8) {
                        // Multi-language bounded shader: (pixels, W, H, time, 0, 0, W, H)
                        wash_run(s.shader, s.mem, W, H, now * 0.001, 0, 0, W, H);
                    } else if (s.arity === 7 || isPhysics) {
                        wash_run(s.shader, s.mem, W, H, mouseX, mouseY, 20000, isMouseDown);
                    } else if (s.arity === 6) {
                        wash_run(s.shader, s.mem, W, H, now * 0.001, mouseX, mouseY);
                    } else if (s.arity === 4) {
                        wash_run(s.shader, s.mem, W, H, now * 0.001);
                    } else if (s.arity === 3) {
                        wash_run(s.shader, s.mem, W, H);
                    } else {
                        wash_run(s.shader, s.mem, W, H, now * 0.001, mouseX, mouseY, isMouseDown);
                    }

                    const srcU8 = new Uint8Array(s.mem.buffer, s.mem.heapBase + pixelOffset, W * H * 4);
                    framePixels.set(srcU8);
                }
            }

            // =========================================================================
            // High-Speed ANSI Half-Block Blitter (\u2580: Upper FG, Lower BG)
            // =========================================================================
            let out = "\x1b[H";
            let lastFg = -1;
            let lastBg = -1;

            for (let y = 0; y < H; y += 2) {
                const row1 = y * W * 4;
                const row2 = (y + 1 < H) ? (y + 1) * W * 4 : row1;

                for (let x = 0; x < W; ++x) {
                    const off1 = row1 + (x * 4);
                    const off2 = row2 + (x * 4);

                    const r1 = framePixels[off1 + 0], g1 = framePixels[off1 + 1], b1 = framePixels[off1 + 2];
                    const r2 = framePixels[off2 + 0], g2 = framePixels[off2 + 1], b2 = framePixels[off2 + 2];

                    const fgKey = (r1 << 16) | (g1 << 8) | b1;
                    const bgKey = (r2 << 16) | (g2 << 8) | b2;

                    if (fgKey !== lastFg) {
                        out += `\x1b[38;2;${r1};${g1};${b1}m`;
                        lastFg = fgKey;
                    }
                    if (bgKey !== lastBg) {
                        out += `\x1b[48;2;${r2};${g2};${b2}m`;
                        lastBg = bgKey;
                    }

                    out += "▀";
                }
                out += "\x1b[0m\n";
                lastFg = -1;
                lastBg = -1;
            }

            // Render Status Bar
            fpsFrames++;
            if (now - lastFpsTime >= 500) {
                currentFps = ((fpsFrames * 1000) / (now - lastFpsTime)).toFixed(1);
                fpsFrames = 0;
                lastFpsTime = now;
            }

            let modeLabel = isUsingWorkers ? `\x1b[35m${numThreads} Threads\x1b[0m` : (isMultiShader ? `\x1b[35m${loadedShaders.length} Languages Split\x1b[0m` : `\x1b[36m${loadedShaders[0].name}\x1b[0m`);
            const status = `\x1b[1;33mWASH\x1b[0m │ ${modeLabel} (${W}x${H}) │ \x1b[32m${currentFps} FPS\x1b[0m │ Mouse: ${(mouseX * 100).toFixed(0)}%, ${(mouseY * 100).toFixed(0)}% │ \x1b[90m[Space: Pause, Q: Exit]\x1b[0m`;
            out += status.padEnd(W + 20, " ");

            process.stdout.write(out);

            setTimeout(tick, Math.max(1, frameInterval - (performance.now() - now)));
        }

        tick();
    }

    main().catch((err) => {
        restoreTerminal();
        console.error("\x1b[31mWash Runner Error:\x1b[0m", err);
        process.exit(1);
    });
}
