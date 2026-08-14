import { wash_memory, wash_load, wash_run, wash_worker, makeWasmImportMemory } from "../wash.js";
import { PRESETS } from "./presets.js";
import { TOOL_PRESETS } from "./tools/presets.js";
import { compileJsToC } from "./tools/porffor.js";
import { wasmToWat, watToWasm, wasmDecompile } from "./tools/wabt.js";
import { optimizeWasm } from "./tools/binaryen.js";
import { inspectWasm, instantiateWasm } from "./tools/runner.js";

// =============================================================================
// DOM Elements
// =============================================================================
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
const copyLogsBtn = document.querySelector("#copyLogsBtn");
const consoleOutput = document.querySelector("#consoleOutput");
const canvas = document.querySelector("#viewport");
const ctx = canvas.getContext("2d");
const fpsStat = document.querySelector("#fpsStat");
const statusMsg = document.querySelector("#statusMsg");
const workspaceStats = document.querySelector("#workspaceStats");

// Docs Modal
const docsBtn = document.querySelector("#docsBtn");
const closeDocsBtn = document.querySelector("#closeDocsBtn");
const docsModal = document.querySelector("#docsModal");

// Tools Modal
const toolsBtn = document.querySelector("#toolsBtn");
const closeToolsBtn = document.querySelector("#closeToolsBtn");
const toolsModal = document.querySelector("#toolsModal");
const toolsTabs = document.querySelectorAll(".tools-tab");
const toolPanes = document.querySelectorAll(".tool-pane");

// Quick Actions
const btnQuickInspect = document.querySelector("#btnQuickInspect");
const btnQuickWat = document.querySelector("#btnQuickWat");
const btnQuickOpt = document.querySelector("#btnQuickOpt");

// File Explorer (VFS)
const toggleSidebarBtn = document.querySelector("#toggleSidebarBtn");
const fileExplorer = document.querySelector("#fileExplorer");
const vfsTreeContainer = document.querySelector("#vfsTreeContainer");
const vfsNewFileBtn = document.querySelector("#vfsNewFileBtn");
const vfsNewFolderBtn = document.querySelector("#vfsNewFolderBtn");
const vfsExportZipBtn = document.querySelector("#vfsExportZipBtn");
const vfsDropZone = document.querySelector("#vfsDropZone");

// =============================================================================
// State Management
// =============================================================================
const vfs = new Map(); // path -> { path, name, type, content, isBinary }
let openTabs = [];     // paths currently open in the tab bar
let activeFilePath = null;
let compiledShaders = {}; // filename -> Uint8Array
let compilerWorker = null;
let isPlaying = true;
let animFrameId = null;
let currentOnFrame = null;
let washJsSource = "";

// Pointer Coordinates & Interaction
let mouseX = 0.5, mouseY = 0.5, isMouseDown = 0;
canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width;
    mouseY = (e.clientY - rect.top) / rect.height;
});
canvas.addEventListener("mousedown", () => isMouseDown = 1);
window.addEventListener("mouseup", () => isMouseDown = 0);

// =============================================================================
// Logging & Console
// =============================================================================
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
clearLogsBtn?.addEventListener("click", clearLogs);

copyLogsBtn?.addEventListener("click", () => {
    const text = Array.from(consoleOutput.children).map(c => c.textContent).join("\n");
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            const oldText = copyLogsBtn.textContent;
            copyLogsBtn.textContent = "✔ COPIED!";
            setTimeout(() => copyLogsBtn.textContent = oldText, 1500);
        }).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
});

function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    if (copyLogsBtn) {
        copyLogsBtn.textContent = "✔ COPIED!";
        setTimeout(() => copyLogsBtn.textContent = "📋 COPY", 1500);
    }
}

// =============================================================================
// Virtual Filesystem (VFS) Operations
// =============================================================================
function getFileExtension(filename) {
    const parts = filename.split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function detectFileType(filename) {
    const ext = getFileExtension(filename);
    if (ext === "c" || ext === "h") return "c";
    if (ext === "js" || ext === "mjs") return "js";
    if (ext === "wat") return "wat";
    if (ext === "wasm") return "wasm";
    return "other";
}

function vfsSetFile(path, content, isBinary = false) {
    const cleanPath = path.replace(/^\/+/, "");
    const name = cleanPath.split("/").pop();
    const type = detectFileType(name);
    vfs.set(cleanPath, {
        path: cleanPath,
        name,
        type,
        content,
        isBinary
    });
    renderVfsTree();
    updateWorkspaceStats();
}

function vfsDeleteFile(path) {
    vfs.delete(path);
    closeTab(path);
    renderVfsTree();
    updateWorkspaceStats();
}

function vfsRenameFile(oldPath, newPath) {
    const file = vfs.get(oldPath);
    if (!file) return;
    vfs.delete(oldPath);
    vfsSetFile(newPath, file.content, file.isBinary);
    const tabIdx = openTabs.indexOf(oldPath);
    if (tabIdx !== -1) {
        openTabs[tabIdx] = newPath;
        if (activeFilePath === oldPath) {
            activeFilePath = newPath;
        }
        renderTabs();
    }
}

function updateWorkspaceStats() {
    if (!workspaceStats) return;
    const count = vfs.size;
    workspaceStats.textContent = `${count} file${count === 1 ? "" : "s"}`;
}

// Render VFS Tree
function renderVfsTree() {
    if (!vfsTreeContainer) return;
    vfsTreeContainer.innerHTML = "";

    const sortedPaths = Array.from(vfs.keys()).sort();

    sortedPaths.forEach(path => {
        const file = vfs.get(path);
        const node = document.createElement("div");
        node.className = `vfs-node ${activeFilePath === path ? "active" : ""}`;

        let icon = "📄";
        if (file.type === "c") icon = "🔨";
        else if (file.type === "js") icon = "⚡";
        else if (file.type === "wat") icon = "📑";
        else if (file.type === "wasm") icon = "⚙️";

        node.innerHTML = `
            <div class="vfs-node-content" title="${path}">
                <span class="vfs-icon">${icon}</span>
                <span>${file.name}</span>
            </div>
            <div class="vfs-node-actions">
                <button class="icon-btn btn-rename" title="Rename">✏️</button>
                <button class="icon-btn btn-delete" title="Delete">🗑️</button>
            </div>
        `;

        node.addEventListener("click", () => openFileInEditor(path));

        const renameBtn = node.querySelector(".btn-rename");
        renameBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const newName = prompt("New filename / path:", path);
            if (newName && newName.trim() && newName !== path) {
                vfsRenameFile(path, newName.trim());
            }
        });

        const deleteBtn = node.querySelector(".btn-delete");
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Delete file "${path}"?`)) {
                vfsDeleteFile(path);
            }
        });

        vfsTreeContainer.appendChild(node);
    });
}

function openFileInEditor(path) {
    const file = vfs.get(path);
    if (!file) return;

    if (!openTabs.includes(path)) {
        openTabs.push(path);
    }
    switchTab(path);
}

function closeTab(path) {
    openTabs = openTabs.filter(p => p !== path);
    if (activeFilePath === path) {
        activeFilePath = openTabs.length > 0 ? openTabs[openTabs.length - 1] : null;
    }
    renderTabs();
    if (activeFilePath) {
        switchTab(activeFilePath);
    } else {
        codeEditor.value = "";
        updateHighlight();
    }
}

// Sidebar Toggle
toggleSidebarBtn?.addEventListener("click", () => {
    fileExplorer.classList.toggle("collapsed");
});

// VFS New File & New Folder
vfsNewFileBtn?.addEventListener("click", () => {
    const filename = prompt("Enter new filename (e.g. shader2.c, helper.js, module.wat):", "shader2.c");
    if (!filename || !filename.trim()) return;
    const clean = filename.trim();
    if (vfs.has(clean)) {
        alert("A file with this name already exists.");
        return;
    }
    const defaultContent = clean.endsWith(".c")
        ? `#include <stdint.h>\n\n__attribute__((export_name("_start")))\nuint32_t _start(uint8_t* pixels, uint32_t width, uint32_t height) {\n    return 1;\n}\n`
        : clean.endsWith(".js")
        ? `// wash pipeline script\nreturn function onFrame({ ctx, imgData }) {};\n`
        : "";
    vfsSetFile(clean, defaultContent);
    openFileInEditor(clean);
});

vfsNewFolderBtn?.addEventListener("click", () => {
    const folder = prompt("Enter folder name:", "shaders");
    if (!folder || !folder.trim()) return;
    const clean = folder.trim().replace(/\/+$/, "");
    const placeholder = `${clean}/readme.txt`;
    vfsSetFile(placeholder, `Folder ${clean}`);
    renderVfsTree();
});

vfsExportZipBtn?.addEventListener("click", () => downloadBtn.click());

// =============================================================================
// Editor & Tab Synchronization
// =============================================================================
function renderTabs() {
    tabList.innerHTML = "";
    openTabs.forEach(path => {
        const file = vfs.get(path);
        const name = file ? file.name : path;
        const btn = document.createElement("button");
        btn.className = `tab ${path === activeFilePath ? "active" : ""}`;
        btn.textContent = name;

        if (openTabs.length > 1) {
            const closeSpan = document.createElement("span");
            closeSpan.className = "tab-close";
            closeSpan.textContent = "×";
            closeSpan.onclick = (e) => {
                e.stopPropagation();
                closeTab(path);
            };
            btn.appendChild(closeSpan);
        }

        btn.onclick = () => switchTab(path);
        tabList.appendChild(btn);
    });

    renderVfsTree();
}

function switchTab(newPath) {
    // 1. Flush editor content only into the PREVIOUSLY active file if different
    if (activeFilePath && activeFilePath !== newPath && vfs.has(activeFilePath)) {
        const prevFile = vfs.get(activeFilePath);
        if (prevFile && !prevFile.isBinary) {
            prevFile.content = codeEditor.value;
        }
    }

    // 2. Set new active file and update editor
    activeFilePath = newPath;
    const file = vfs.get(newPath);
    if (file) {
        codeEditor.value = file.isBinary ? `// [Binary File: ${file.name} - ${file.content?.byteLength || 0} bytes]` : file.content;
        codeEditor.readOnly = !!file.isBinary;
        updateHighlight();
        syncScroll();
    }

    renderTabs();
}

function updateHighlight() {
    if (!activeFilePath) return;
    const file = vfs.get(activeFilePath);
    if (!file) return;

    let lang = "c";
    if (file.type === "js") lang = "javascript";
    else if (file.type === "wat") lang = "wasm";

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
    if (activeFilePath && vfs.has(activeFilePath)) {
        const cur = vfs.get(activeFilePath);
        if (!cur.isBinary) cur.content = codeEditor.value;
    }
});
codeEditor.addEventListener("scroll", syncScroll);

codeEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        const start = codeEditor.selectionStart;
        const end = codeEditor.selectionEnd;
        codeEditor.value = codeEditor.value.substring(0, start) + "    " + codeEditor.value.substring(end);
        codeEditor.selectionStart = codeEditor.selectionEnd = start + 4;
        updateHighlight();
        if (activeFilePath && vfs.has(activeFilePath)) {
            vfs.get(activeFilePath).content = codeEditor.value;
        }
    }
});

addTabBtn.addEventListener("click", () => {
    const cFiles = Array.from(vfs.keys()).filter(k => k.endsWith(".c"));
    const name = `shader${cFiles.length + 1}.c`;
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
    vfsSetFile(name, defaultCode);
    openFileInEditor(name);
});

// =============================================================================
// Presets Loader
// =============================================================================
function loadPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    // Reset active path BEFORE populating VFS so switchTab doesn't flush editor into new preset
    activeFilePath = null;
    vfs.clear();
    openTabs = [];

    preset.tabs.forEach(tab => {
        const cleanName = tab.name.replace(/^\/+/, "");
        vfs.set(cleanName, {
            path: cleanName,
            name: cleanName,
            type: detectFileType(cleanName),
            content: tab.code,
            isBinary: false
        });
        openTabs.push(cleanName);
    });

    renderVfsTree();
    updateWorkspaceStats();

    if (openTabs.length > 0) {
        switchTab(openTabs[0]);
    }

    log(`Preset loaded: ${preset.name}`, "info");
    compileAndRun();
}

presetSelect.addEventListener("change", (e) => loadPreset(e.target.value));

// =============================================================================
// Compiler Worker & Compilation Pipeline
// =============================================================================
function initWorker() {
    if (compilerWorker) compilerWorker.terminate();
    compilerWorker = new Worker("compiler-worker.js", { type: "module" });
}

async function compileShader(filename, code) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString();
        const handler = (e) => {
            if (e.data.id !== id) return;
            compilerWorker.removeEventListener("message", handler);

            if (e.data.logs) {
                e.data.logs.split("\n").filter(Boolean).forEach(l => {
                    const isErr = l.toLowerCase().includes("error") || l.includes("[STDERR]");
                    log(l, isErr ? "err" : "info");
                });
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

// Compile all C shaders and execute pipeline
async function compileAndRun() {
    if (activeFilePath && vfs.has(activeFilePath)) {
        const cur = vfs.get(activeFilePath);
        if (!cur.isBinary) cur.content = codeEditor.value;
    }

    log("Starting multi-shader compilation pipeline...", "info");
    statusMsg.textContent = "COMPILING...";
    statusMsg.style.color = "var(--yellow-bright)";
    compileBtn.disabled = true;

    if (animFrameId) cancelAnimationFrame(animFrameId);
    currentOnFrame = null;

    try {
        initWorker();
        compiledShaders = {};

        const cFiles = Array.from(vfs.values()).filter(f => f.type === "c" && f.name.endsWith(".c"));

        for (const file of cFiles) {
            log(`Compiling ${file.name} -> WebAssembly...`, "info");
            const res = await compileShader(file.name, file.content);
            const importedBytes = makeWasmImportMemory(res.wasmBytes);
            compiledShaders[res.outFileName] = new Uint8Array(importedBytes);
            vfs.set(res.outFileName, {
                path: res.outFileName,
                name: res.outFileName,
                type: "wasm",
                content: new Uint8Array(importedBytes),
                isBinary: true
            });
            log(`✔ ${res.outFileName} built successfully (${importedBytes.byteLength} B)`, "ok");
        }

        renderVfsTree();
        updateWorkspaceStats();
        updateToolShadersDropdowns();

        // Map compiled shaders to URLs for wash_load
        const shaderBlobs = {};
        for (const [name, bytes] of Object.entries(compiledShaders)) {
            const blob = new Blob([bytes], { type: "application/wasm" });
            shaderBlobs[name] = URL.createObjectURL(blob);
        }

        // Find main.js or any JS entry point in VFS
        let jsFile = vfs.get("main.js");
        if (!jsFile) {
            const allJs = Array.from(vfs.values()).filter(f => f.type === "js");
            if (allJs.length > 0) jsFile = allJs[0];
        }

        if (!jsFile) throw new Error("No main.js pipeline script found in workspace!");

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
            jsFile.content
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

window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        compileAndRun();
    }
});

// =============================================================================
// Render Loop
// =============================================================================
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

// =============================================================================
// ZIP Archive Import / Export
// =============================================================================
fetch("../wash.js")
    .then(res => res.text())
    .then(text => { washJsSource = text; })
    .catch(() => {});

async function loadZipArchive(file) {
    if (typeof JSZip === "undefined") {
        log("JSZip library not loaded yet.", "err");
        return;
    }

    try {
        log(`Reading ZIP archive: ${file.name}...`, "info");
        const zip = await JSZip.loadAsync(file);

        vfs.clear();
        openTabs = [];
        activeFilePath = null;

        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const basename = relativePath.split("/").pop();
            if (basename.startsWith(".")) continue;

            const ext = getFileExtension(basename);
            if (ext === "wasm") {
                const arrayBuffer = await zipEntry.async("arraybuffer");
                vfsSetFile(relativePath, new Uint8Array(arrayBuffer), true);
            } else {
                const text = await zipEntry.async("text");
                vfsSetFile(relativePath, text, false);
                openTabs.push(relativePath);
            }
        }

        if (openTabs.length === 0) {
            vfsSetFile("main.js", `return function onFrame({ ctx, imgData }) {};`);
            openTabs.push("main.js");
        }

        activeFilePath = openTabs[0];
        switchTab(activeFilePath);
        log(`✔ Successfully imported ${vfs.size} file(s) from ${file.name}!`, "ok");
        compileAndRun();

    } catch (err) {
        log(`Failed to read ZIP: ${err.message}`, "err");
    }
}

uploadZipBtn.addEventListener("click", () => zipFileInput.click());
zipFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await loadZipArchive(file);
    zipFileInput.value = "";
});

window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (vfsDropZone) vfsDropZone.classList.add("dragover");
});
window.addEventListener("dragleave", () => {
    if (vfsDropZone) vfsDropZone.classList.remove("dragover");
});
window.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (vfsDropZone) vfsDropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith(".zip")) {
            await loadZipArchive(file);
        } else {
            const text = await file.text();
            vfsSetFile(file.name, text);
            openFileInEditor(file.name);
            log(`Imported ${file.name} to workspace.`, "ok");
        }
    }
});

downloadBtn.addEventListener("click", async () => {
    if (activeFilePath && vfs.has(activeFilePath)) {
        const cur = vfs.get(activeFilePath);
        if (!cur.isBinary) cur.content = codeEditor.value;
    }

    if (typeof JSZip === "undefined") {
        alert("JSZip library is still loading.");
        return;
    }

    log("Bundling workspace into ZIP archive...", "info");
    const zip = new JSZip();

    // 1. VFS files
    for (const [path, file] of vfs.entries()) {
        zip.file(path, file.content);
    }

    // 2. wash.js
    zip.file("wash.js", washJsSource || "// wash.js");

    // 3. Standalone HTML
    const cFiles = Array.from(vfs.values()).filter(f => f.type === "c" && f.name.endsWith(".c"));
    const jsFile = vfs.get("main.js") || Array.from(vfs.values()).find(f => f.type === "js");

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
${cFiles.map(t => `  "${t.name.replace(/\.c$/, '.wasm')}": "./${t.name.replace(/\.c$/, '.wasm')}"`).join(",\n")}
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

${jsFile ? jsFile.content : ""}

function loop(time) {
    if (typeof onFrame === "function") {
        onFrame({ time, mouseX, mouseY, isMouseDown, ctx, imgData });
    }
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
<\/script>
</body>
</html>
`;
    zip.file("index.html", htmlContent);

    // 4. Makefile
    const makefileContent = `build:
${cFiles.map(t => `\tclang --target=wasm32 -O3 -fno-math-errno -nostdlib -Wl,--import-memory -Wl,--export=__heap_base -Wl,--export=_start ${t.name} -o ${t.name.replace(/\.c$/, '.wasm')}`).join("\n")}
`;
    zip.file("Makefile", makefileContent);

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wash_workspace.zip";
    a.click();
    URL.revokeObjectURL(url);
    log("✔ wash_workspace.zip successfully downloaded!", "ok");
});

// =============================================================================
// Tools Suite Integration
// =============================================================================
function openToolsModal(defaultTab = "pipeline") {
    toolsModal.style.display = "flex";
    switchToolTab(defaultTab);
    updateToolShadersDropdowns();
}

function switchToolTab(tabName) {
    toolsTabs.forEach(t => t.classList.toggle("active", t.getAttribute("data-tool") === tabName));
    toolPanes.forEach(p => p.classList.toggle("active", p.id === `pane-tool-${tabName}`));
}

toolsBtn?.addEventListener("click", () => openToolsModal("pipeline"));
closeToolsBtn?.addEventListener("click", () => toolsModal.style.display = "none");
docsBtn?.addEventListener("click", () => docsModal.style.display = "flex");
closeDocsBtn?.addEventListener("click", () => docsModal.style.display = "none");

toolsTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        switchToolTab(tab.getAttribute("data-tool"));
    });
});

window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (toolsModal.style.display !== "none") toolsModal.style.display = "none";
        if (docsModal.style.display !== "none") docsModal.style.display = "none";
    }
});

function updateToolShadersDropdowns() {
    const shaderNames = Object.keys(compiledShaders);
    const dropdowns = [
        document.querySelector("#binaryenShaderSelect"),
        document.querySelector("#wabtShaderSelect"),
        document.querySelector("#runnerShaderSelect")
    ];

    dropdowns.forEach(dd => {
        if (!dd) return;
        const curVal = dd.value;
        dd.innerHTML = "";
        if (shaderNames.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "-- No compiled shaders yet --";
            dd.appendChild(opt);
        } else {
            shaderNames.forEach(name => {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = `${name} (${compiledShaders[name].byteLength} B)`;
                dd.appendChild(opt);
            });
            if (curVal && shaderNames.includes(curVal)) dd.value = curVal;
        }
    });
}

// 1. Tool: Integrated Pipeline
const pipePresetSelect = document.querySelector("#pipePresetSelect");
const pipeJsInput = document.querySelector("#pipeJsInput");
const pipeOutput = document.querySelector("#pipeOutput");
const pipeMetricsBadge = document.querySelector("#pipeMetricsBadge");
const btnRunFullPipeline = document.querySelector("#btnRunFullPipeline");
const btnPipelineStepPorffor = document.querySelector("#btnPipelineStepPorffor");
const btnPipeInsertToVfs = document.querySelector("#btnPipeInsertToVfs");
const btnPipeToRunner = document.querySelector("#btnPipeToRunner");
let pipelineLastWasm = null;

if (pipePresetSelect) {
    pipeJsInput.value = TOOL_PRESETS.pipeline[0].code;
    pipePresetSelect.addEventListener("change", (e) => {
        const item = TOOL_PRESETS.pipeline.find(p => p.id === e.target.value);
        if (item) pipeJsInput.value = item.code;
    });

    btnPipelineStepPorffor.addEventListener("click", async () => {
        try {
            log("Pipeline Step 1: Porffor JS -> C...", "info");
            const res = await compileJsToC(pipeJsInput.value);
            pipeOutput.value = res.cCode;
            btnPipeInsertToVfs.disabled = false;
        } catch (err) {
            pipeOutput.value = `/* Porffor Error: */ ${err.message}`;
        }
    });

    btnRunFullPipeline.addEventListener("click", async () => {
        try {
            btnRunFullPipeline.disabled = true;
            log("🚀 Running Full WebAssembly Pipeline...", "info");

            // Step 1: JS -> C (Porffor)
            log("1. Transpiling JS to C (Porffor)...", "info");
            const porfforRes = await compileJsToC(pipeJsInput.value);

            // Step 2: C -> WASM (XCC Compiler Worker)
            log("2. Compiling C to WASM (Compiler Worker)...", "info");
            const xccRes = await compileShader("pipeline_generated.c", porfforRes.cCode);

            // Step 3: Binaryen Optimization
            log("3. Optimizing WASM with Binaryen (-O3)...", "info");
            const optRes = await optimizeWasm(xccRes.wasmBytes, { level: "O3" });

            // Step 4: Disassemble to WAT (WABT)
            log("4. Disassembling WAT with WABT...", "info");
            const wat = await wasmToWat(optRes.optimizedBytes);

            pipelineLastWasm = optRes.optimizedBytes;
            pipeOutput.value = `// Pipeline Success!\n// Final WASM Size: ${optRes.optimizedSize} bytes (${optRes.ratio})\n\n` + wat;
            pipeMetricsBadge.style.display = "inline-block";
            pipeMetricsBadge.textContent = `${optRes.optimizedSize} bytes (${optRes.ratio})`;
            btnPipeInsertToVfs.disabled = false;
            btnPipeToRunner.disabled = false;

            log(`✔ Full Pipeline Completed: ${optRes.ratio}`, "ok");
        } catch (err) {
            pipeOutput.value = `/* Pipeline Error: */\n${err.message}`;
            log(`Pipeline Error: ${err.message}`, "err");
        } finally {
            btnRunFullPipeline.disabled = false;
        }
    });

    btnPipeInsertToVfs.addEventListener("click", () => {
        const name = `pipeline_gen_${Date.now().toString(36).substring(4)}.c`;
        vfsSetFile(name, pipeOutput.value.startsWith("// Pipeline Success") ? pipeJsInput.value : pipeOutput.value);
        openFileInEditor(name);
        toolsModal.style.display = "none";
        log(`Saved pipeline output to workspace as ${name}`, "ok");
    });

    btnPipeToRunner.addEventListener("click", () => {
        if (!pipelineLastWasm) return;
        switchToolTab("runner");
        loadWasmIntoRunnerView(pipelineLastWasm, "pipeline_generated.wasm");
    });
}

// 2. Tool: Porffor
const porfforPresetSelect = document.querySelector("#porfforPresetSelect");
const porfforSourceInput = document.querySelector("#porfforSourceInput");
const porfforCOutput = document.querySelector("#porfforCOutput");
const btnPorfforCompile = document.querySelector("#btnPorfforCompile");
const btnPorfforCreateShader = document.querySelector("#btnPorfforCreateShader");

if (porfforSourceInput) {
    porfforSourceInput.value = TOOL_PRESETS.porffor[0].code;
    porfforPresetSelect.addEventListener("change", (e) => {
        const item = TOOL_PRESETS.porffor.find(p => p.id === e.target.value);
        if (item) porfforSourceInput.value = item.code;
    });

    btnPorfforCompile.addEventListener("click", async () => {
        try {
            btnPorfforCompile.disabled = true;
            log("Transpiling JS to C with Porffor...", "info");
            const res = await compileJsToC(porfforSourceInput.value);
            porfforCOutput.value = res.cCode;
            btnPorfforCreateShader.disabled = false;
            log("Porffor C code generated.", "ok");
        } catch (err) {
            porfforCOutput.value = `/* Porffor Error: */\n${err.message}`;
            log(`Porffor Error: ${err.message}`, "err");
        } finally {
            btnPorfforCompile.disabled = false;
        }
    });

    btnPorfforCreateShader.addEventListener("click", () => {
        const name = `porffor_shader_${Date.now().toString(36).substring(4)}.c`;
        vfsSetFile(name, porfforCOutput.value);
        openFileInEditor(name);
        toolsModal.style.display = "none";
        log(`✔ Created ${name} in workspace.`, "ok");
    });
}

// 3. Tool: Binaryen
const binaryenShaderSelect = document.querySelector("#binaryenShaderSelect");
const binaryenLevelSelect = document.querySelector("#binaryenLevelSelect");
const btnBinaryenRunOpt = document.querySelector("#btnBinaryenRunOpt");
const btnBinaryenApply = document.querySelector("#btnBinaryenApply");
const btnBinaryenDownload = document.querySelector("#btnBinaryenDownload");
const binaryenMetricBadge = document.querySelector("#binaryenMetricBadge");
const binaryenOriginalWat = document.querySelector("#binaryenOriginalWat");
const binaryenOptWat = document.querySelector("#binaryenOptWat");
let lastOptimizedBytes = null;

if (btnBinaryenRunOpt) {
    binaryenShaderSelect.addEventListener("change", async () => {
        const name = binaryenShaderSelect.value;
        if (name && compiledShaders[name]) {
            try {
                binaryenOriginalWat.value = await wasmToWat(compiledShaders[name]);
            } catch (err) {
                binaryenOriginalWat.value = `/* Disassembly error: ${err.message} */`;
            }
        }
    });

    btnBinaryenRunOpt.addEventListener("click", async () => {
        const name = binaryenShaderSelect.value;
        if (!name || !compiledShaders[name]) {
            alert("Please select a compiled shader first.");
            return;
        }

        try {
            btnBinaryenRunOpt.disabled = true;
            const originalBytes = compiledShaders[name];
            const level = binaryenLevelSelect.value;
            log(`Running wasm-opt (-${level}) on ${name}...`, "info");

            const res = await optimizeWasm(originalBytes, { level });
            lastOptimizedBytes = res.optimizedBytes;

            binaryenOptWat.value = res.textWat;
            binaryenMetricBadge.style.display = "inline-block";
            binaryenMetricBadge.textContent = res.ratio;
            btnBinaryenApply.disabled = false;
            btnBinaryenDownload.disabled = false;

            log(`✔ Binaryen optimization done: ${res.ratio}`, "ok");
        } catch (err) {
            binaryenOptWat.value = `/* Binaryen error: ${err.message} */`;
            log(`Binaryen Error: ${err.message}`, "err");
        } finally {
            btnBinaryenRunOpt.disabled = false;
        }
    });

    btnBinaryenApply.addEventListener("click", () => {
        const name = binaryenShaderSelect.value;
        if (name && lastOptimizedBytes) {
            compiledShaders[name] = lastOptimizedBytes;
            vfs.set(name, {
                path: name,
                name,
                type: "wasm",
                content: lastOptimizedBytes,
                isBinary: true
            });
            renderVfsTree();
            log(`✔ Applied optimized binary to ${name}`, "ok");
            alert(`Optimized binary applied to ${name}! Run the project to test.`);
        }
    });

    btnBinaryenDownload.addEventListener("click", () => {
        if (!lastOptimizedBytes) return;
        const blob = new Blob([lastOptimizedBytes], { type: "application/wasm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = binaryenShaderSelect.value || "optimized.wasm";
        a.click();
        URL.revokeObjectURL(url);
    });
}

// 4. Tool: WABT
const wabtShaderSelect = document.querySelector("#wabtShaderSelect");
const wabtWatInput = document.querySelector("#wabtWatInput");
const wabtDecompileOutput = document.querySelector("#wabtDecompileOutput");
const btnWabtWasm2Wat = document.querySelector("#btnWabtWasm2Wat");
const btnWabtDecompile = document.querySelector("#btnWabtDecompile");
const btnWabtWat2Wasm = document.querySelector("#btnWabtWat2Wasm");
const btnWabtSaveToVfs = document.querySelector("#btnWabtSaveToVfs");

if (btnWabtWasm2Wat) {
    wabtWatInput.value = TOOL_PRESETS.wabt[0].code;

    btnWabtWasm2Wat.addEventListener("click", async () => {
        const name = wabtShaderSelect.value;
        if (!name || !compiledShaders[name]) {
            alert("Select a compiled shader first.");
            return;
        }
        try {
            const wat = await wasmToWat(compiledShaders[name]);
            wabtWatInput.value = wat;
            log(`wasm2wat disassembly generated for ${name}`, "ok");
        } catch (err) {
            wabtWatInput.value = `/* Error: ${err.message} */`;
        }
    });

    btnWabtDecompile.addEventListener("click", async () => {
        const name = wabtShaderSelect.value;
        if (!name || !compiledShaders[name]) {
            alert("Select a compiled shader first.");
            return;
        }
        try {
            const decomp = await wasmDecompile(compiledShaders[name]);
            wabtDecompileOutput.value = decomp;
            log(`wasm-decompile generated for ${name}`, "ok");
        } catch (err) {
            wabtDecompileOutput.value = `/* Decompile error: ${err.message} */`;
        }
    });

    btnWabtWat2Wasm.addEventListener("click", async () => {
        try {
            log("Compiling WAT to WASM (wat2wasm)...", "info");
            const wasmBytes = await watToWasm(wabtWatInput.value);
            const hex = Array.from(wasmBytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
            wabtDecompileOutput.value = `// wat2wasm compiled successfully (${wasmBytes.byteLength} bytes):\n${hex}`;
            log(`wat2wasm generated ${wasmBytes.byteLength} bytes.`, "ok");
        } catch (err) {
            wabtDecompileOutput.value = `/* wat2wasm error: ${err.message} */`;
        }
    });

    btnWabtSaveToVfs.addEventListener("click", () => {
        const name = `module_${Date.now().toString(36).substring(4)}.wat`;
        vfsSetFile(name, wabtWatInput.value);
        openFileInEditor(name);
        toolsModal.style.display = "none";
        log(`Saved WAT module to workspace: ${name}`, "ok");
    });
}

// 5. Tool: Runner & Inspector
const runnerShaderSelect = document.querySelector("#runnerShaderSelect");
const btnRunnerLoadShader = document.querySelector("#btnRunnerLoadShader");
const runnerExportsList = document.querySelector("#runnerExportsList");
const runnerConsoleOutput = document.querySelector("#runnerConsoleOutput");
const btnClearRunnerLogs = document.querySelector("#btnClearRunnerLogs");

btnClearRunnerLogs?.addEventListener("click", () => {
    runnerConsoleOutput.value = "";
});

async function loadWasmIntoRunnerView(wasmBytes, shaderName = "module.wasm") {
    runnerExportsList.innerHTML = "";
    runnerConsoleOutput.value = `[Inspector] Loading ${shaderName} (${wasmBytes.byteLength} bytes)...\n`;

    try {
        const info = await inspectWasm(wasmBytes);
        const { exports } = await instantiateWasm(wasmBytes, {}, (logMsg) => {
            runnerConsoleOutput.value += logMsg + "\n";
            runnerConsoleOutput.scrollTop = runnerConsoleOutput.scrollHeight;
        });

        const fnExports = info.exports.filter(e => e.kind === "function");

        if (fnExports.length === 0) {
            runnerExportsList.innerHTML = `<div style="color:var(--gray); padding:10px;">No exported functions found.</div>`;
            return;
        }

        fnExports.forEach(exp => {
            const card = document.createElement("div");
            card.className = "export-item";
            card.innerHTML = `
                <div>
                  <strong>${exp.name}()</strong>
                  <div style="font-size:10px; color:var(--gray);">exported function</div>
                </div>
                <button class="btn btn-sm btn-primary">Run</button>
            `;

            card.querySelector("button").addEventListener("click", () => {
                try {
                    runnerConsoleOutput.value += `\n>> Invoking '${exp.name}()'...\n`;
                    const fn = exports[exp.name];
                    const ret = fn();
                    runnerConsoleOutput.value += `<< Return value: ${ret}\n`;
                    runnerConsoleOutput.scrollTop = runnerConsoleOutput.scrollHeight;
                } catch (err) {
                    runnerConsoleOutput.value += `<< Execution error: ${err.message}\n`;
                }
            });

            runnerExportsList.appendChild(card);
        });

        runnerConsoleOutput.value += `[Inspector] Ready! ${fnExports.length} function(s) available for execution.\n`;
    } catch (err) {
        runnerExportsList.innerHTML = `<div style="color:var(--red-bright); padding:10px;">Error: ${err.message}</div>`;
        runnerConsoleOutput.value += `[Error] ${err.message}\n`;
    }
}

btnRunnerLoadShader?.addEventListener("click", () => {
    const name = runnerShaderSelect.value;
    if (name && compiledShaders[name]) {
        loadWasmIntoRunnerView(compiledShaders[name], name);
    } else {
        alert("Please compile a shader first or select one from the dropdown.");
    }
});

// Quick Editor Bar Buttons
btnQuickInspect?.addEventListener("click", () => {
    openToolsModal("runner");
    const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
    if (activeFile && activeFile.type === "c") {
        const wasmName = activeFile.name.replace(/\.c$/, ".wasm");
        if (compiledShaders[wasmName]) {
            runnerShaderSelect.value = wasmName;
            loadWasmIntoRunnerView(compiledShaders[wasmName], wasmName);
        }
    }
});

btnQuickWat?.addEventListener("click", async () => {
    openToolsModal("wabt");
    const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
    if (activeFile && activeFile.type === "c") {
        const wasmName = activeFile.name.replace(/\.c$/, ".wasm");
        if (compiledShaders[wasmName]) {
            wabtShaderSelect.value = wasmName;
            const wat = await wasmToWat(compiledShaders[wasmName]);
            wabtWatInput.value = wat;
        }
    }
});

btnQuickOpt?.addEventListener("click", async () => {
    openToolsModal("binaryen");
    const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
    if (activeFile && activeFile.type === "c") {
        const wasmName = activeFile.name.replace(/\.c$/, ".wasm");
        if (compiledShaders[wasmName]) {
            binaryenShaderSelect.value = wasmName;
            binaryenOriginalWat.value = await wasmToWat(compiledShaders[wasmName]);
        }
    }
});

// =============================================================================
// Initial Setup
// =============================================================================
loadPreset("pipeline");
