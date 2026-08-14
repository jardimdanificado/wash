import { wash_memory, wash_load, wash_run, wash_worker, makeWasmImportMemory } from "../wash.js";
import { PRESETS } from "./presets.js";

// DOM Elements
const tabList = document.querySelector("#tabList");
const addTabBtn = document.querySelector("#addTabBtn");
const codeEditor = document.querySelector("#codeEditor");
const codeHighlight = document.querySelector("#codeHighlight");
const compileBtn = document.querySelector("#compileBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const uploadZipBtn = document.querySelector("#uploadZipBtn");
const zipFileInput = document.querySelector("#zipFileInput");
const presetSelect = document.querySelector("#presetSelect");
const playPauseBtn = document.querySelector("#playPauseBtn");
const clearLogsBtn = document.querySelector("#clearLogsBtn");
const consoleOutput = document.querySelector("#consoleOutput");
const canvas = document.querySelector("#viewport");
const ctx = canvas.getContext("2d");
const fpsStat = document.querySelector("#fpsStat");
const statusMsg = document.querySelector("#statusMsg");
const docsBtn = document.querySelector("#docsBtn");
const closeDocsBtn = document.querySelector("#closeDocsBtn");
const docsModal = document.querySelector("#docsModal");

if (docsBtn && docsModal) {
    docsBtn.addEventListener("click", () => {
        docsModal.style.display = "flex";
        if (typeof Prism !== "undefined") {
            Prism.highlightAllUnder(docsModal);
        }
    });

    closeDocsBtn?.addEventListener("click", () => {
        docsModal.style.display = "none";
    });

    docsModal.addEventListener("click", (e) => {
        if (e.target === docsModal) docsModal.style.display = "none";
    });

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && docsModal.style.display !== "none") {
            docsModal.style.display = "none";
        }
    });
}

// State
let tabs = [];
let activeTabId = null;
let compiledShaders = {}; // filename -> Uint8Array
let compilerWorker = null;
let isPlaying = true;
let animFrameId = null;
let currentOnFrame = null;
let washJsSource = "";

// Interaction State
let mouseX = 0.5, mouseY = 0.5, isMouseDown = 0;

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width;
    mouseY = (e.clientY - rect.top) / rect.height;
});
canvas.addEventListener("mousedown", () => isMouseDown = 1);
window.addEventListener("mouseup", () => isMouseDown = 0);

// Initialize Compiler Worker
function initWorker() {
    if (compilerWorker) compilerWorker.terminate();
    compilerWorker = new Worker("compiler-worker.js", { type: "module" });
}

// Log to Virtual Console
function log(msg, type = "info") {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    consoleOutput.appendChild(entry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clearLogs() {
    consoleOutput.innerHTML = "";
}
clearLogsBtn.addEventListener("click", clearLogs);

// Syntax Highlighting Synchronization
function updateHighlight() {
    const active = tabs.find(t => t.id === activeTabId);
    if (!active) return;

    const lang = active.type === "c" ? "c" : "javascript";
    codeHighlight.className = `language-${lang}`;
    codeHighlight.textContent = codeEditor.value + (codeEditor.value.endsWith("\n") ? " " : "");

    if (typeof Prism !== "undefined") {
        Prism.highlightElement(codeHighlight);
    }
}

function syncScroll() {
    codeHighlight.parentElement.scrollTop = codeEditor.scrollTop;
    codeHighlight.parentElement.scrollLeft = codeEditor.scrollLeft;
}

codeEditor.addEventListener("input", () => {
    updateHighlight();
    const current = tabs.find(t => t.id === activeTabId);
    if (current) current.code = codeEditor.value;
});

codeEditor.addEventListener("scroll", syncScroll);

// Tab Management
function renderTabs() {
    tabList.innerHTML = "";
    tabs.forEach(tab => {
        const btn = document.createElement("button");
        btn.className = `tab ${tab.id === activeTabId ? "active" : ""}`;
        btn.textContent = tab.name;

        if (tab.type === "c" && tabs.filter(t => t.type === "c").length > 1) {
            const closeSpan = document.createElement("span");
            closeSpan.className = "tab-close";
            closeSpan.textContent = "×";
            closeSpan.onclick = (e) => {
                e.stopPropagation();
                removeTab(tab.id);
            };
            btn.appendChild(closeSpan);
        }

        btn.onclick = () => switchTab(tab.id);
        tabList.appendChild(btn);
    });
}

function switchTab(id) {
    if (activeTabId) {
        const current = tabs.find(t => t.id === activeTabId);
        if (current) current.code = codeEditor.value;
    }
    activeTabId = id;
    const next = tabs.find(t => t.id === id);
    if (next) {
        codeEditor.value = next.code;
        updateHighlight();
        syncScroll();
    }
    renderTabs();
}

function addTab(name = "shader2.c", code = "") {
    const id = "tab_" + Date.now();
    tabs.push({ id, name, type: "c", code });
    switchTab(id);
}

function removeTab(id) {
    tabs = tabs.filter(t => t.id !== id);
    if (activeTabId === id) {
        activeTabId = tabs[0].id;
    }
    switchTab(activeTabId);
}

addTabBtn.addEventListener("click", () => {
    const count = tabs.filter(t => t.type === "c").length + 1;
    const name = `shader${count}.c`;
    const defaultCode = `#include <stdint.h>

__attribute__((export_name("_start")))
void* _start(uint8_t* pixels, uint32_t width, uint32_t height) {
    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            uint32_t off = (y * width + x) * 4;
            pixels[off + 0] = (uint8_t)((x * 255) / width);
            pixels[off + 1] = 160;
            pixels[off + 2] = (uint8_t)((y * 255) / height);
            pixels[off + 3] = 255;
        }
    }
    return 0;
}
`;
    addTab(name, defaultCode);
});

// Load Preset
function loadPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    activeTabId = null; // Reset activeTabId so switchTab doesn't flush previous tab's editor text into the new preset
    tabs = JSON.parse(JSON.stringify(preset.tabs));
    switchTab(tabs[0].id);
    log(`Preset loaded: ${preset.name}`, "info");
    compileAndRun();
}

presetSelect.addEventListener("change", (e) => loadPreset(e.target.value));

// In-Browser Compiler Service
async function compileShader(filename, code) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString();
        const handler = (e) => {
            if (e.data.id !== id) return;
            compilerWorker.removeEventListener("message", handler);

            if (e.data.logs) {
                e.data.logs.split("\n").filter(Boolean).forEach(l => log(l, "info"));
            }

            if (e.data.status === "ok") {
                resolve({
                    outFileName: e.data.outFileName,
                    wasmBytes: e.data.wasmBytes
                });
            } else {
                reject(new Error(e.data.error || "Compilation failed"));
            }
        };

        compilerWorker.addEventListener("message", handler);
        compilerWorker.postMessage({
            id,
            type: "compile",
            filename,
            code
        });
    });
}

// Compile All & Execute Pipeline
async function compileAndRun() {
    const current = tabs.find(t => t.id === activeTabId);
    if (current) current.code = codeEditor.value;

    log("Starting multi-shader compilation pipeline...", "info");
    statusMsg.textContent = "COMPILING...";
    statusMsg.style.color = "var(--yellow-bright)";
    compileBtn.disabled = true;

    if (animFrameId) cancelAnimationFrame(animFrameId);
    currentOnFrame = null;

    try {
        initWorker();
        const cTabs = tabs.filter(t => t.type === "c");
        compiledShaders = {};

        // Compile all C shaders
        for (const tab of cTabs) {
            log(`Compiling ${tab.name} -> WebAssembly...`, "info");
            const res = await compileShader(tab.name, tab.code);
            const importedBytes = makeWasmImportMemory(res.wasmBytes);
            compiledShaders[res.outFileName] = new Uint8Array(importedBytes);
            log(`✔ ${res.outFileName} built successfully (${res.wasmBytes.byteLength} B)`, "ok");
        }

        // Map compiled shaders to Uint8Array URLs / buffers for wash_load
        const shaderBlobs = {};
        for (const [name, bytes] of Object.entries(compiledShaders)) {
            const blob = new Blob([bytes], { type: "application/wasm" });
            shaderBlobs[name] = URL.createObjectURL(blob);
        }

        // Prepare JS Execution Environment
        const jsTab = tabs.find(t => t.type === "js");
        if (!jsTab) throw new Error("No main.js tab found in project!");

        log("Executing main.js pipeline...", "info");

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const pipelineFactory = new AsyncFunction(
            "wash_memory",
            "wash_load",
            "wash_run",
            "wash_worker",
            "shaders",
            "width",
            "height",
            "canvas",
            "ctx",
            jsTab.code
        );

        currentOnFrame = await pipelineFactory(
            wash_memory,
            wash_load,
            wash_run,
            wash_worker,
            shaderBlobs,
            canvas.width,
            canvas.height,
            canvas,
            ctx
        );

        log("✔ Pipeline running at 60 FPS!", "ok");
        statusMsg.textContent = "RUNNING";
        statusMsg.style.color = "var(--green-bright)";
        startRenderLoop();

    } catch (err) {
        log(`❌ Error: ${err.message}`, "err");
        statusMsg.textContent = "ERROR";
        statusMsg.style.color = "var(--red-bright)";
    } finally {
        compileBtn.disabled = false;
    }
}

compileBtn.addEventListener("click", compileAndRun);

// Global Keyboard Shortcut: Ctrl+Enter / Cmd+Enter to Run
window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        compileAndRun();
    }
});

// Render Loop
let framesCount = 0;
let lastFpsTime = performance.now();
const imgData = ctx.createImageData(canvas.width, canvas.height);

function startRenderLoop() {
    function loop(time) {
        if (!isPlaying || !currentOnFrame) return;

        try {
            currentOnFrame({
                time,
                mouseX,
                mouseY,
                isMouseDown,
                ctx,
                imgData
            });

            framesCount++;
            const now = performance.now();
            if (now - lastFpsTime >= 500) {
                const fps = (framesCount * 1000) / (now - lastFpsTime);
                fpsStat.textContent = fps.toFixed(1);
                framesCount = 0;
                lastFpsTime = now;
            }
        } catch (err) {
            log(`Runtime error: ${err.message}`, "err");
            statusMsg.textContent = "RUNTIME ERROR";
            statusMsg.style.color = "var(--red-bright)";
            return;
        }

        animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
}

playPauseBtn.addEventListener("click", () => {
    isPlaying = !isPlaying;
    playPauseBtn.textContent = isPlaying ? "PAUSE" : "RESUME";
    if (isPlaying) startRenderLoop();
});

// Code Editor Tab Support (Insert Spaces on Tab)
codeEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        const start = codeEditor.selectionStart;
        const end = codeEditor.selectionEnd;
        codeEditor.value = codeEditor.value.substring(0, start) + "    " + codeEditor.value.substring(end);
        codeEditor.selectionStart = codeEditor.selectionEnd = start + 4;
        updateHighlight();
    }
});

// Fetch wash.js for ZIP bundling
fetch("../wash.js")
    .then(res => res.text())
    .then(text => { washJsSource = text; })
    .catch(() => {});

// Import / Load ZIP Archive
async function loadZipFile(file) {
    if (typeof JSZip === "undefined") {
        log("JSZip library not loaded yet. Please try again.", "err");
        return;
    }

    try {
        log(`Reading ZIP archive: ${file.name}...`, "info");
        const zip = await JSZip.loadAsync(file);
        const newTabs = [];

        // 1. Extract all .c files
        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const basename = relativePath.split("/").pop();

            if (basename.endsWith(".c")) {
                const text = await zipEntry.async("text");
                newTabs.push({
                    id: "tab_" + Math.random().toString(36).substring(2, 9),
                    name: basename,
                    type: "c",
                    code: text
                });
            }
        }

        // 2. Extract main.js
        let foundJs = false;
        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const basename = relativePath.split("/").pop();

            if (basename === "main.js") {
                const text = await zipEntry.async("text");
                newTabs.push({
                    id: "main_js",
                    name: "main.js",
                    type: "js",
                    code: text
                });
                foundJs = true;
                break;
            }
        }

        if (!foundJs) {
            // Check if there is another .js file (excluding wash.js)
            for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
                if (zipEntry.dir) continue;
                const basename = relativePath.split("/").pop();
                if (basename.endsWith(".js") && basename !== "wash.js") {
                    const text = await zipEntry.async("text");
                    newTabs.push({
                        id: "main_js",
                        name: "main.js",
                        type: "js",
                        code: text
                    });
                    foundJs = true;
                    break;
                }
            }
        }

        if (newTabs.length === 0) {
            log("No .c shader or main.js source files found in ZIP.", "err");
            return;
        }

        if (!foundJs) {
            // Create default main.js orchestrator
            newTabs.push({
                id: "main_js",
                name: "main.js",
                type: "js",
                code: `const mem = wash_memory(width * height * 4);
const firstShaderName = Object.keys(shaders)[0];
const shader = await wash_load(shaders[firstShaderName], mem);

return function onFrame({ ctx, imgData }) {
    wash_run(shader, mem, width, height);
    imgData.data.set(mem.u8);
    ctx.putImageData(imgData, 0, 0);
};
`
            });
        }

        activeTabId = null;
        tabs = newTabs;
        switchTab(tabs[0].id);
        log(`✔ Successfully imported ${newTabs.length} file(s) from ${file.name}!`, "ok");
        compileAndRun();

    } catch (err) {
        log(`Failed to read ZIP: ${err.message}`, "err");
    }
}

uploadZipBtn.addEventListener("click", () => zipFileInput.click());

zipFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await loadZipFile(file);
    zipFileInput.value = "";
});

// Drag and drop ZIP files into Wash Studio
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith(".zip")) {
            await loadZipFile(file);
        }
    }
});

// Download Standalone Project ZIP
downloadBtn.addEventListener("click", async () => {
    const current = tabs.find(t => t.id === activeTabId);
    if (current) current.code = codeEditor.value;

    if (typeof JSZip === "undefined") {
        alert("JSZip library is still loading. Please try again in a moment.");
        return;
    }

    log("Bundling project into ZIP archive...", "info");
    const zip = new JSZip();

    // 1. wash.js
    zip.file("wash.js", washJsSource || "// wash.js");

    // 2. All .c files
    const cTabs = tabs.filter(t => t.type === "c");
    cTabs.forEach(t => {
        zip.file(t.name, t.code);
    });

    // 3. All compiled .wasm files
    for (const [name, bytes] of Object.entries(compiledShaders)) {
        zip.file(name, bytes);
    }

    // 4. main.js
    const jsTab = tabs.find(t => t.type === "js");
    if (jsTab) {
        zip.file("main.js", jsTab.code);
    }

    // 5. Standalone index.html runner
    const htmlContent = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wash Standalone Application</title>
<style>
  body { background: #1d2021; color: #ebdbb2; font-family: monospace; text-align: center; margin: 0; padding: 24px; }
  canvas { border: 1px solid #504945; cursor: crosshair; image-rendering: pixelated; }
</style>
</head>
<body>
  <h2>Wash Project Export</h2>
  <canvas id="viewport" width="${canvas.width}" height="${canvas.height}"></canvas>

<script type="module">
import { wash_memory, wash_load, wash_run, wash_worker } from "./wash.js";

const canvas = document.querySelector("#viewport");
const ctx = canvas.getContext("2d");
const width = canvas.width, height = canvas.height;

const shaders = {
${cTabs.map(t => `  "${t.name.replace(/\.c$/, '.wasm')}": "./${t.name.replace(/\.c$/, '.wasm')}"`).join(",\n")}
};

let mouseX = 0.5, mouseY = 0.5, isMouseDown = 0;
canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width;
    mouseY = (e.clientY - rect.top) / rect.height;
});
canvas.addEventListener("mousedown", () => isMouseDown = 1);
window.addEventListener("mouseup", () => isMouseDown = 0);

const imgData = ctx.createImageData(width, height);

${jsTab ? jsTab.code : ""}

function loop(time) {
    onFrame({ time, mouseX, mouseY, isMouseDown, ctx, imgData });
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
<\/script>
</body>
</html>
`;
    zip.file("index.html", htmlContent);

    // 6. Makefile for native Clang compilation
    const makefileContent = `build:
${cTabs.map(t => `\tclang --target=wasm32 -O3 -fno-math-errno -nostdlib -Wl,--import-memory -Wl,--export=__heap_base -Wl,--export=_start ${t.name} -o ${t.name.replace(/\.c$/, '.wasm')}`).join("\n")}
`;
    zip.file("Makefile", makefileContent);

    // 7. README.md
    zip.file("README.md", `# Exported Wash Project

This project was built and exported from **Wash Studio**.

## Running Locally:
1. Start an HTTP server:
   \`\`\`bash
   python3 -m http.server 8080
   \`\`\`
2. Open \`http://localhost:8080\` in your browser!

## Compiling C Shaders with Clang:
\`\`\`bash
make
\`\`\`
`);

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wash_project.zip";
    a.click();
    URL.revokeObjectURL(url);
    log("✔ wash_project.zip successfully downloaded!", "ok");
});

// Initial load
loadPreset("pipeline");
