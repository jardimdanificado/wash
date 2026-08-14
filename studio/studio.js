import { wash_memory, wash_load, wash_run, wash_worker, makeWasmImportMemory } from "../wash.js";
import { PRESETS } from "./presets.js";
import { compileJsToC } from "./tools/porffor.js";
import { wasmToWat, watToWasm, wasmDecompile } from "./tools/wabt.js";
import { optimizeWasm } from "./tools/binaryen.js";

// =============================================================================
// DOM Elements
// =============================================================================
const tabList = document.querySelector("#tabList");
const monacoHost = document.querySelector("#monacoEditorContainer");
const consoleDrawer = document.querySelector("#consoleDrawer");
const consoleBadge = document.querySelector("#consoleBadge");
const toggleConsoleDrawerBtn = document.querySelector("#toggleConsoleDrawerBtn");
const statusBarConsoleBtn = document.querySelector("#statusBarConsoleBtn");
const statusBarViewportBtn = document.querySelector("#statusBarViewportBtn");
const statusBarActionsBtn = document.querySelector("#statusBarActionsBtn");
const floatingViewport = document.querySelector("#floatingViewport");
const floatingHeader = document.querySelector("#floatingHeader");
const floatingFps = document.querySelector("#floatingFps");
const floatingMinimizeBtn = document.querySelector("#floatingMinimizeBtn");
const floatingResizeBtn = document.querySelector("#floatingResizeBtn");
const zipFileInput = document.querySelector("#zipFileInput");
const presetsModal = document.querySelector("#presetsModal");
const closePresetsBtn = document.querySelector("#closePresetsBtn");
const brandBtn = document.querySelector("#brandBtn");
const commandPaletteBtn = document.querySelector("#commandPaletteBtn");
const commandPaletteModal = document.querySelector("#commandPaletteModal");
const commandPaletteInput = document.querySelector("#commandPaletteInput");
const commandPaletteList = document.querySelector("#commandPaletteList");
const playPauseBtn = document.querySelector("#playPauseBtn");
const clearLogsBtn = document.querySelector("#clearLogsBtn");
const copyLogsBtn = document.querySelector("#copyLogsBtn");
const consoleOutput = document.querySelector("#consoleOutput");
const canvas = document.querySelector("#viewport");
const ctx = canvas.getContext("2d");
const statusMsg = document.querySelector("#statusMsg");
const workspaceStats = document.querySelector("#workspaceStats");
const cursorPos = document.querySelector("#cursorPos");
const editorLanguage = document.querySelector("#editorLanguage");

// Docs Modal
const docsBtn = document.querySelector("#docsBtn");
const closeDocsBtn = document.querySelector("#closeDocsBtn");
const docsModal = document.querySelector("#docsModal");

// File Explorer (VFS)
const fileExplorer = document.querySelector("#fileExplorer");
const vfsTreeContainer = document.querySelector("#vfsTreeContainer");
const vfsDropZone = document.querySelector("#vfsDropZone");

// =============================================================================
// State Management
// =============================================================================
const vfs = new Map(); // cleanPath -> { path, name, type, content, isBinary, model }
const folderCollapsedState = new Map();
let openTabs = [];
let activeFilePath = null;
let compiledShaders = {}; // filename -> Uint8Array
let compilerWorker = null;
let isPlaying = true;
let animFrameId = null;
let currentOnFrame = null;
let washJsSource = "";

// Monaco Editor Instance
let monacoEditor = null;
let monacoApi = null;

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
    const logsText = Array.from(consoleOutput.children).map(c => c.textContent).join("\n");
    if (!logsText) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(logsText).then(() => {
            const oldText = copyLogsBtn.textContent;
            copyLogsBtn.textContent = "COPIED!";
            setTimeout(() => copyLogsBtn.textContent = oldText, 1500);
        }).catch(() => {
            fallbackCopy(logsText);
        });
    } else {
        fallbackCopy(logsText);
    }
});

function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
        if (copyLogsBtn) {
            copyLogsBtn.textContent = "COPIED!";
            setTimeout(() => copyLogsBtn.textContent = "COPY", 1500);
        }
    } catch (err) {}
    document.body.removeChild(ta);
}

// =============================================================================
// Monaco Editor Integration with Gruvbox Dark Theme
// =============================================================================
function getMonacoLanguage(filename) {
    const ext = getFileExtension(filename);
    if (ext === "c" || ext === "h") return "c";
    if (ext === "js" || ext === "mjs") return "javascript";
    if (ext === "wat") return "wat";
    if (ext === "json") return "json";
    if (ext === "md") return "markdown";
    return "plaintext";
}

async function initMonaco() {
    return new Promise((resolve) => {
        if (window.monaco) {
            setupMonaco(window.monaco);
            resolve();
            return;
        }

        window.require.config({
            paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" }
        });

        window.require(["vs/editor/editor.main"], () => {
            setupMonaco(window.monaco);
            resolve();
        });
    });
}

function setupMonaco(monaco) {
    monacoApi = monaco;

    monaco.editor.defineTheme("gruvbox-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "", foreground: "ebdbb2", background: "1d2021" },
            { token: "comment", foreground: "928374", fontStyle: "italic" },
            { token: "keyword", foreground: "fb4934", fontStyle: "bold" },
            { token: "identifier", foreground: "ebdbb2" },
            { token: "type", foreground: "8ec07c" },
            { token: "type.identifier", foreground: "fabd2f" },
            { token: "string", foreground: "b8bb26" },
            { token: "number", foreground: "d3869b" },
            { token: "delimiter", foreground: "a89984" },
            { token: "operator", foreground: "83a598" }
        ],
        colors: {
            "editor.background": "#1d2021",
            "editor.foreground": "#ebdbb2",
            "editor.lineHighlightBackground": "#282828",
            "editorCursor.foreground": "#fbf1c7",
            "editorWhitespace.foreground": "#504945",
            "editorIndentGuide.background": "#3c3836",
            "editorIndentGuide.activeBackground": "#504945",
            "editor.selectionBackground": "#504945",
            "editor.inactiveSelectionBackground": "#3c3836",
            "editorLineNumber.foreground": "#7c6f64",
            "editorLineNumber.activeForeground": "#fabd2f",
            "minimap.background": "#1d2021"
        }
    });

    monacoEditor = monaco.editor.create(monacoHost, {
        theme: "gruvbox-dark",
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
        fontSize: 13,
        lineHeight: 21,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        bracketPairColorization: { enabled: true },
        renderLineHighlight: "all"
    });

    monacoEditor.onDidChangeCursorPosition((e) => {
        if (cursorPos) {
            cursorPos.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        }
    });

    // Monaco Keyboard shortcuts
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        compileAndRun();
    });

    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        compileAndRun();
    });

    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
        openCommandPalette();
    });

    monacoEditor.addCommand(monaco.KeyCode.F1, () => {
        openCommandPalette();
    });
}

function getOrCreateModelForFile(file) {
    if (!monacoApi) return null;
    if (file.model) return file.model;

    const lang = getMonacoLanguage(file.name);
    const uri = monacoApi.Uri.parse(`file:///${file.path}`);
    let model = monacoApi.editor.getModel(uri);

    if (!model) {
        const textContent = file.isBinary ? `// [Binary File: ${file.name} - ${file.content?.byteLength || 0} bytes]` : (file.content || "");
        model = monacoApi.editor.createModel(textContent, lang, uri);
        
        if (!file.isBinary) {
            model.onDidChangeContent(() => {
                file.content = model.getValue();
            });
        }
    }

    file.model = model;
    return model;
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

    let file = vfs.get(cleanPath);
    if (file) {
        file.content = content;
        file.isBinary = isBinary;
        if (file.model && !isBinary && typeof content === "string") {
            file.model.setValue(content);
        }
    } else {
        file = {
            path: cleanPath,
            name,
            type,
            content,
            isBinary,
            model: null
        };
        vfs.set(cleanPath, file);
    }

    renderVfsTree();
    updateWorkspaceStats();
    return file;
}

function vfsDeleteFile(path) {
    const file = vfs.get(path);
    if (file && file.model) {
        file.model.dispose();
    }
    vfs.delete(path);
    closeTab(path);
    renderVfsTree();
    updateWorkspaceStats();
}

function vfsRenameFile(oldPath, newPath) {
    const file = vfs.get(oldPath);
    if (!file) return;
    
    if (file.model) {
        file.model.dispose();
        file.model = null;
    }
    
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

// Build and Render Hierarchical VFS Tree
function buildVfsHierarchy() {
    const root = { name: "", isFolder: true, path: "", children: new Map() };

    for (const [filePath, file] of vfs.entries()) {
        const parts = filePath.split("/");
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join("/");

            if (isLast) {
                current.children.set(part, { ...file, isFolder: false });
            } else {
                if (!current.children.has(part)) {
                    current.children.set(part, {
                        name: part,
                        path: currentPath,
                        isFolder: true,
                        children: new Map()
                    });
                }
                current = current.children.get(part);
            }
        }
    }
    return root;
}

function renderVfsTree() {
    if (!vfsTreeContainer) return;
    vfsTreeContainer.innerHTML = "";

    const hierarchy = buildVfsHierarchy();

    function renderNode(node, container) {
        const entries = Array.from(node.children.entries()).sort((a, b) => {
            if (a[1].isFolder !== b[1].isFolder) return a[1].isFolder ? -1 : 1;
            return a[0].localeCompare(b[0]);
        });

        entries.forEach(([name, item]) => {
            if (item.isFolder) {
                const folderDiv = document.createElement("div");
                folderDiv.className = "vfs-folder";

                const isCollapsed = folderCollapsedState.get(item.path) || false;

                const header = document.createElement("div");
                header.className = "vfs-folder-header";
                header.innerHTML = `
                    <div class="vfs-node-content" title="${item.path}">
                        <span class="vfs-icon">${isCollapsed ? "📁" : "📂"}</span>
                        <span>${name}</span>
                    </div>
                    <div class="vfs-node-actions">
                        <button class="icon-btn btn-add-in-folder" title="New file in folder">+📄</button>
                    </div>
                `;

                header.querySelector(".btn-add-in-folder").addEventListener("click", (e) => {
                    e.stopPropagation();
                    const newFileName = prompt(`Enter new filename in folder ${item.path}:`, "helper.c");
                    if (newFileName && newFileName.trim()) {
                        const fullPath = `${item.path}/${newFileName.trim().replace(/^\/+/, "")}`;
                        vfsSetFile(fullPath, "");
                        openFileInEditor(fullPath);
                    }
                });

                const childrenDiv = document.createElement("div");
                childrenDiv.className = `vfs-folder-children ${isCollapsed ? "collapsed" : ""}`;

                header.addEventListener("click", () => {
                    const nextCollapsed = !childrenDiv.classList.contains("collapsed");
                    childrenDiv.classList.toggle("collapsed", nextCollapsed);
                    folderCollapsedState.set(item.path, nextCollapsed);
                    header.querySelector(".vfs-icon").textContent = nextCollapsed ? "📁" : "📂";
                });

                renderNode(item, childrenDiv);

                folderDiv.appendChild(header);
                folderDiv.appendChild(childrenDiv);
                container.appendChild(folderDiv);
            } else {
                const nodeDiv = document.createElement("div");
                nodeDiv.className = `vfs-node ${activeFilePath === item.path ? "active" : ""}`;

                let icon = "📄";
                if (item.type === "c") icon = "🔨";
                else if (item.type === "js") icon = "⚡";
                else if (item.type === "wat") icon = "📑";
                else if (item.type === "wasm") icon = "⚙️";

                nodeDiv.innerHTML = `
                    <div class="vfs-node-content" title="${item.path}">
                        <span class="vfs-icon">${icon}</span>
                        <span>${item.name}</span>
                    </div>
                    <div class="vfs-node-actions">
                        <button class="icon-btn btn-rename" title="Rename">✏️</button>
                        <button class="icon-btn btn-delete" title="Delete">🗑️</button>
                    </div>
                `;

                nodeDiv.addEventListener("click", () => openFileInEditor(item.path));

                nodeDiv.querySelector(".btn-rename").addEventListener("click", (e) => {
                    e.stopPropagation();
                    const newPath = prompt("Rename path / filename:", item.path);
                    if (newPath && newPath.trim() && newPath.trim() !== item.path) {
                        vfsRenameFile(item.path, newPath.trim());
                    }
                });

                nodeDiv.querySelector(".btn-delete").addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete file "${item.path}"?`)) {
                        vfsDeleteFile(item.path);
                    }
                });

                container.appendChild(nodeDiv);
            }
        });
    }

    renderNode(hierarchy, vfsTreeContainer);
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
    }
}



// =============================================================================
// Floating Viewport & Console Drawer Controls
// =============================================================================
function toggleConsole(forceOpen = null) {
    if (!consoleDrawer) return;
    const shouldOpen = forceOpen !== null ? forceOpen : consoleDrawer.classList.contains("collapsed");
    consoleDrawer.classList.toggle("collapsed", !shouldOpen);
    setTimeout(() => monacoEditor?.layout(), 200);
}

function toggleFloatingViewport(forceOpen = null) {
    if (!floatingViewport) return;
    const isHidden = floatingViewport.style.display === "none";
    const shouldOpen = forceOpen !== null ? forceOpen : isHidden;
    
    if (shouldOpen) {
        floatingViewport.style.display = "flex";
        isPlaying = true;
        if (playPauseBtn) playPauseBtn.textContent = "PAUSE";
        startRenderLoop();
    } else {
        floatingViewport.style.display = "none";
        isPlaying = false;
        if (animFrameId) cancelAnimationFrame(animFrameId);
        if (playPauseBtn) playPauseBtn.textContent = "PLAY";
    }
}

// Floating Viewport Draggable Engine
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let winStartX = 0, winStartY = 0;

floatingHeader?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return; // Don't drag when clicking buttons
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    
    const rect = floatingViewport.getBoundingClientRect();
    winStartX = rect.left;
    winStartY = rect.top;
    
    // Switch from right-anchored to left/top anchored
    floatingViewport.style.right = "auto";
    floatingViewport.style.left = `${winStartX}px`;
    floatingViewport.style.top = `${winStartY}px`;
    e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
    if (!isDragging || !floatingViewport) return;
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    const newX = Math.max(10, Math.min(window.innerWidth - 100, winStartX + deltaX));
    const newY = Math.max(30, Math.min(window.innerHeight - 60, winStartY + deltaY));
    
    floatingViewport.style.left = `${newX}px`;
    floatingViewport.style.top = `${newY}px`;
});

window.addEventListener("mouseup", () => {
    isDragging = false;
});

floatingMinimizeBtn?.addEventListener("click", () => toggleFloatingViewport(false));
floatingResizeBtn?.addEventListener("click", () => {
    floatingViewport?.classList.toggle("expanded");
});

statusBarViewportBtn?.addEventListener("click", () => {
    const isHidden = floatingViewport?.style.display === "none";
    toggleFloatingViewport(isHidden);
});

statusBarActionsBtn?.addEventListener("click", openCommandPalette);
toggleConsoleDrawerBtn?.addEventListener("click", () => toggleConsole(false));
statusBarConsoleBtn?.addEventListener("click", () => toggleConsole());

// =============================================================================
// Editor Tab Synchronization
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
    activeFilePath = newPath;
    const file = vfs.get(newPath);

    if (file && monacoEditor) {
        const model = getOrCreateModelForFile(file);
        if (model) {
            monacoEditor.setModel(model);
            monacoEditor.updateOptions({ readOnly: !!file.isBinary });
        }

        if (editorLanguage) {
            editorLanguage.textContent = getMonacoLanguage(file.name).toUpperCase();
        }
        setTimeout(() => monacoEditor.layout(), 30);
    }

    renderTabs();
}



// =============================================================================
// Presets Loader
// =============================================================================
function loadPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    activeFilePath = null;
    vfs.forEach(f => { if (f.model) f.model.dispose(); });
    vfs.clear();
    openTabs = [];

    preset.tabs.forEach(tab => {
        const cleanName = tab.name.replace(/^\/+/, "");
        vfs.set(cleanName, {
            path: cleanName,
            name: cleanName,
            type: detectFileType(cleanName),
            content: tab.code,
            isBinary: false,
            model: null
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

async function compileAndRun() {
    log("Starting multi-shader compilation pipeline...", "info");
    statusMsg.textContent = "COMPILING...";
    statusMsg.style.color = "var(--yellow-bright)";

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
                isBinary: true,
                model: null
            });

            log(`[OK] ${res.outFileName} built successfully (${importedBytes.byteLength} B)`, "ok");
        }

        renderVfsTree();
        updateWorkspaceStats();

        // Map compiled shaders to URLs for wash_load
        const shaderBlobs = {};
        for (const [name, bytes] of Object.entries(compiledShaders)) {
            const blob = new Blob([bytes], { type: "application/wasm" });
            shaderBlobs[name] = URL.createObjectURL(blob);
        }

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

        log("[OK] Pipeline running at 60 FPS!", "ok");
        statusMsg.textContent = "RUNNING";
        statusMsg.style.color = "var(--green-bright)";
        if (consoleBadge) consoleBadge.textContent = "RUNNING";
        toggleFloatingViewport(true);
        startRenderLoop();

    } catch (err) {
        log(`❌ Error: ${err.message}`, "err");
        statusMsg.textContent = "ERROR";
        statusMsg.style.color = "var(--red-bright)";
        if (consoleBadge) consoleBadge.textContent = "ERROR";
        toggleConsole(true);
    }
}

window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        compileAndRun();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        openCommandPalette();
    }
    if (e.key === "F1") {
        e.preventDefault();
        openCommandPalette();
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
                if (floatingFps) floatingFps.textContent = fps.toFixed(0) + " FPS";
                framesCount = 0;
                lastFpsTime = now;
            }
        } catch (err) {
            log(`Runtime error: ${err.message}`, "err");
            statusMsg.textContent = "RUNTIME ERROR";
            statusMsg.style.color = "var(--red-bright)";
            toggleConsole(true);
            return;
        }

        animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
}

playPauseBtn?.addEventListener("click", () => {
    isPlaying = !isPlaying;
    playPauseBtn.textContent = isPlaying ? "⏸" : "▶";
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

        activeFilePath = null;
        vfs.forEach(f => { if (f.model) f.model.dispose(); });
        vfs.clear();
        openTabs = [];

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
        log(`[OK] Successfully imported ${vfs.size} file(s) from ${file.name}!`, "ok");
        compileAndRun();

    } catch (err) {
        log(`[ERROR] Failed to read ZIP: ${err.message}`, "err");
    }
}

zipFileInput?.addEventListener("change", async (e) => {
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
            log(`[OK] Imported ${file.name} to workspace.`, "ok");
        }
    }
});

function toggleSidebar() {
    fileExplorer.classList.toggle("collapsed");
    setTimeout(() => monacoEditor?.layout(), 180);
}

function createNewCShader() {
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
}

async function exportWorkspaceZip() {
    if (typeof JSZip === "undefined") {
        alert("JSZip library is still loading.");
        return;
    }

    log("Bundling workspace into ZIP archive...", "info");
    const zip = new JSZip();

    for (const [path, file] of vfs.entries()) {
        zip.file(path, file.content);
    }

    zip.file("wash.js", washJsSource || "// wash.js");

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
    log("[OK] wash_workspace.zip successfully downloaded!", "ok");
}

async function runBinaryenOptimizationOnActiveFile(level) {
    const wasmBytes = await getActiveWasmBytes();
    if (!wasmBytes) return;

    try {
        log(`[BINARYEN] Running wasm-opt (-${level})...`, "info");
        const res = await optimizeWasm(wasmBytes, { level });
        
        const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
        const wasmName = activeFile ? activeFile.name.replace(/\.c$/, ".wasm") : "shader.wasm";

        compiledShaders[wasmName] = res.optimizedBytes;
        vfsSetFile(wasmName, res.optimizedBytes, true);

        log(`[OK] Binaryen: ${wasmName} optimized! ${res.ratio}`, "ok");
        alert(`[OK] wasm-opt (-${level}) successful!\nOriginal size: ${res.originalSize} B\nOptimized size: ${res.optimizedSize} B (${res.ratio})`);
    } catch (err) {
        log(`[ERROR] Binaryen: ${err.message}`, "err");
    }
}

// =============================================================================
// Command Palette & Tool Actions Engine (Ctrl+Shift+P / F1)
// =============================================================================
const COMMAND_REGISTRY = [
    // --- PORFFOR ACTIONS ---
    {
        id: "porffor_transpile_c",
        category: "Porffor",
        catClass: "cat-porffor",
        title: "Transpile Current JS to C Code",
        shortcut: "",
        action: async () => {
            const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
            if (!activeFile) { alert("No file currently open."); return; }
            try {
                log(`[PORFFOR] Transpiling ${activeFile.name} to C...`, "info");
                const code = typeof activeFile.content === "string" ? activeFile.content : "";
                const res = await compileJsToC(code);
                const outName = activeFile.name.replace(/\.[^/.]+$/, "") + "_porffor.c";
                vfsSetFile(outName, res.cCode);
                openFileInEditor(outName);
                log(`[OK] Porffor: Generated and opened ${outName}`, "ok");
            } catch (err) {
                log(`[ERROR] Porffor: ${err.message}`, "err");
            }
        }
    },
    {
        id: "porffor_compile_wasm",
        category: "Porffor",
        catClass: "cat-porffor",
        title: "Compile Current JS directly to WASM Binary",
        shortcut: "",
        action: async () => {
            const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
            if (!activeFile) { alert("No file currently open."); return; }
            try {
                log(`[PORFFOR] Compiling ${activeFile.name} to WASM binary...`, "info");
                const code = typeof activeFile.content === "string" ? activeFile.content : "";
                const res = await compileJsToC(code);
                // Compile C to WASM using compiler worker
                const outWasmName = activeFile.name.replace(/\.[^/.]+$/, "") + ".wasm";
                const xccRes = await compileShader(activeFile.name, res.cCode);
                const importedBytes = makeWasmImportMemory(xccRes.wasmBytes);
                vfsSetFile(outWasmName, new Uint8Array(importedBytes), true);
                compiledShaders[outWasmName] = new Uint8Array(importedBytes);
                log(`[OK] Porffor+XCC: Generated ${outWasmName} (${importedBytes.byteLength} B)`, "ok");
            } catch (err) {
                log(`[ERROR] Porffor WASM: ${err.message}`, "err");
            }
        }
    },

    // --- BINARYEN (wasm-opt) ACTIONS ---
    {
        id: "binaryen_opt_o3",
        category: "Binaryen",
        catClass: "cat-binaryen",
        title: "wasm-opt: Optimize Current Shader (-O3 Maximum Speed)",
        shortcut: "",
        action: async () => { await runBinaryenOptimizationOnActiveFile("O3"); }
    },
    {
        id: "binaryen_opt_o2",
        category: "Binaryen",
        catClass: "cat-binaryen",
        title: "wasm-opt: Optimize Current Shader (-O2 Standard Optimization)",
        shortcut: "",
        action: async () => { await runBinaryenOptimizationOnActiveFile("O2"); }
    },
    {
        id: "binaryen_opt_o1",
        category: "Binaryen",
        catClass: "cat-binaryen",
        title: "wasm-opt: Optimize Current Shader (-O1 Quick Optimization)",
        shortcut: "",
        action: async () => { await runBinaryenOptimizationOnActiveFile("O1"); }
    },
    {
        id: "binaryen_opt_oz",
        category: "Binaryen",
        catClass: "cat-binaryen",
        title: "wasm-opt: Optimize Current Shader (-Oz Aggressive Size Reduction)",
        shortcut: "",
        action: async () => { await runBinaryenOptimizationOnActiveFile("Oz"); }
    },
    {
        id: "binaryen_opt_os",
        category: "Binaryen",
        catClass: "cat-binaryen",
        title: "wasm-opt: Optimize Current Shader (-Os Size Reduction)",
        shortcut: "",
        action: async () => { await runBinaryenOptimizationOnActiveFile("Os"); }
    },

    // --- WABT ACTIONS ---
    {
        id: "wabt_wasm2wat",
        category: "WABT",
        catClass: "cat-wabt",
        title: "wasm2wat: Disassemble Current Shader to WebAssembly Text (.wat)",
        shortcut: "",
        action: async () => {
            const wasmBytes = await getActiveWasmBytes();
            if (!wasmBytes) return;
            try {
                log("[WABT] Disassembling WASM to WAT...", "info");
                const wat = await wasmToWat(wasmBytes, { foldExprs: false });
                const baseName = activeFilePath ? activeFilePath.replace(/\.[^/.]+$/, "") : "shader";
                const outName = `${baseName}.wat`;
                vfsSetFile(outName, wat);
                openFileInEditor(outName);
                log(`[OK] WABT: Created and opened ${outName}`, "ok");
            } catch (err) {
                log(`[ERROR] wasm2wat: ${err.message}`, "err");
            }
        }
    },
    {
        id: "wabt_wasm2wat_folded",
        category: "WABT",
        catClass: "cat-wabt",
        title: "wasm2wat: Disassemble to WAT (Folded S-Expressions)",
        shortcut: "",
        action: async () => {
            const wasmBytes = await getActiveWasmBytes();
            if (!wasmBytes) return;
            try {
                log("[WABT] Disassembling WASM to folded S-Expressions...", "info");
                const wat = await wasmToWat(wasmBytes, { foldExprs: true });
                const baseName = activeFilePath ? activeFilePath.replace(/\.[^/.]+$/, "") : "shader";
                const outName = `${baseName}_folded.wat`;
                vfsSetFile(outName, wat);
                openFileInEditor(outName);
                log(`[OK] WABT: Created and opened ${outName}`, "ok");
            } catch (err) {
                log(`[ERROR] wasm2wat: ${err.message}`, "err");
            }
        }
    },
    {
        id: "wabt_decompile",
        category: "WABT",
        catClass: "cat-wabt",
        title: "wasm-decompile: Decompile Current Shader to C-like Pseudo Code",
        shortcut: "",
        action: async () => {
            const wasmBytes = await getActiveWasmBytes();
            if (!wasmBytes) return;
            try {
                log("[WABT] Decompiling WASM to pseudo-C...", "info");
                const decomp = await wasmDecompile(wasmBytes);
                const baseName = activeFilePath ? activeFilePath.replace(/\.[^/.]+$/, "") : "shader";
                const outName = `${baseName}.decomp.c`;
                vfsSetFile(outName, decomp);
                openFileInEditor(outName);
                log(`[OK] WABT: Created and opened ${outName}`, "ok");
            } catch (err) {
                log(`[ERROR] wasm-decompile: ${err.message}`, "err");
            }
        }
    },
    {
        id: "wabt_wat2wasm",
        category: "WABT",
        catClass: "cat-wabt",
        title: "wat2wasm: Compile Current WAT to WASM Binary",
        shortcut: "",
        action: async () => {
            const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
            if (!activeFile || activeFile.type !== "wat") {
                alert("Please open a .wat file to compile to WASM.");
                return;
            }
            try {
                log(`[WABT] Compiling ${activeFile.name} (wat2wasm)...`, "info");
                const wasmBytes = await watToWasm(activeFile.content);
                const outName = activeFile.name.replace(/\.wat$/, ".wasm");
                vfsSetFile(outName, wasmBytes, true);
                compiledShaders[outName] = wasmBytes;
                log(`[OK] wat2wasm: Compiled ${outName} (${wasmBytes.byteLength} bytes)`, "ok");
            } catch (err) {
                log(`[ERROR] wat2wasm: ${err.message}`, "err");
            }
        }
    },

    // --- RUNNER & INSPECTOR ACTIONS ---
    {
        id: "runner_inspect",
        category: "Inspector",
        catClass: "cat-binaryen",
        title: "Inspector: Inspect WASM Structure (Imports, Exports, Memory)",
        shortcut: "",
        action: async () => {
            const wasmBytes = await getActiveWasmBytes();
            if (!wasmBytes) return;
            try {
                log(`[INSPECT] Inspecting WASM binary (${wasmBytes.byteLength} bytes)...`, "info");
                const module = await WebAssembly.compile(wasmBytes);
                const imports = WebAssembly.Module.imports(module);
                const exports = WebAssembly.Module.exports(module);

                log(`=== WASM Structure Summary ===`, "ok");
                log(`• Binary Size: ${wasmBytes.byteLength} bytes (${(wasmBytes.byteLength / 1024).toFixed(2)} KB)`, "info");
                log(`• Exported Items (${exports.length}):`, "info");
                exports.forEach(e => log(`  - [${e.kind}] ${e.name}`, "info"));
                log(`• Imported Items (${imports.length}):`, "info");
                imports.forEach(i => log(`  - [${i.kind}] ${i.module}.${i.name}`, "info"));
                log(`==============================`, "ok");
            } catch (err) {
                log(`[ERROR] Inspection: ${err.message}`, "err");
            }
        }
    },
    {
        id: "runner_validate",
        category: "Inspector",
        catClass: "cat-binaryen",
        title: "Inspector: Validate WebAssembly Binary (Bytecode Check)",
        shortcut: "",
        action: async () => {
            const wasmBytes = await getActiveWasmBytes();
            if (!wasmBytes) return;
            const valid = WebAssembly.validate(wasmBytes);
            if (valid) {
                log(`[OK] WebAssembly.validate: Binary bytecode is VALID! (${wasmBytes.byteLength} B)`, "ok");
            } else {
                log(`[ERROR] WebAssembly.validate: Invalid WASM bytecode.`, "err");
            }
        }
    },
    {
        id: "runner_invoke",
        category: "Inspector",
        catClass: "cat-binaryen",
        title: "Runner: Instantiate & Invoke Exported Function...",
        shortcut: "",
        action: async () => {
            const wasmBytes = await getActiveWasmBytes();
            if (!wasmBytes) return;
            try {
                log(`[INSPECT] Instantiating WASM module for invocation...`, "info");
                const module = await WebAssembly.compile(wasmBytes);
                const fnExports = WebAssembly.Module.exports(module).filter(e => e.kind === "function");
                
                if (fnExports.length === 0) {
                    alert("No exported functions found in this WASM binary.");
                    return;
                }

                const fnNames = fnExports.map(e => e.name).join(", ");
                const chosenFn = prompt(`Choose exported function to invoke (${fnNames}):`, fnExports[0].name);
                if (!chosenFn || !chosenFn.trim()) return;

                const instance = await WebAssembly.instantiate(module, {
                    env: {
                        memory: new WebAssembly.Memory({ initial: 16 }),
                        print: (val) => log(`[env.print] ${val}`, "info"),
                        abort: () => log(`[env.abort]`, "err")
                    },
                    wasi_snapshot_preview1: {
                        proc_exit: (code) => log(`[WASI proc_exit] ${code}`, "info"),
                        fd_write: () => 0,
                        fd_close: () => 0,
                        fd_seek: () => 0,
                        fd_read: () => 0
                    }
                });

                if (typeof instance.exports[chosenFn.trim()] !== "function") {
                    alert(`Function "${chosenFn}" not found in exports.`);
                    return;
                }

                log(`>> Invoking '${chosenFn}()'...`, "info");
                const ret = instance.exports[chosenFn.trim()]();
                log(`<< '${chosenFn}()' returned: ${ret}`, "ok");
            } catch (err) {
                log(`[ERROR] Execution: ${err.message}`, "err");
            }
        }
    },

    // --- LAUNDRY WORKSPACE ACTIONS ---
    {
        id: "laundry_run",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Compile & Run Project Pipeline",
        shortcut: "Ctrl+Enter",
        action: () => compileAndRun()
    },
    {
        id: "laundry_compile_single",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Compile Current C Shader Only",
        shortcut: "",
        action: async () => {
            const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
            if (!activeFile || activeFile.type !== "c") {
                alert("Open a .c shader file to compile.");
                return;
            }
            try {
                log(`Compiling ${activeFile.name}...`, "info");
                const res = await compileShader(activeFile.name, activeFile.content);
                const importedBytes = makeWasmImportMemory(res.wasmBytes);
                vfsSetFile(res.outFileName, new Uint8Array(importedBytes), true);
                compiledShaders[res.outFileName] = new Uint8Array(importedBytes);
                log(`[OK] ${res.outFileName} built successfully (${importedBytes.byteLength} B)`, "ok");
            } catch (err) {
                log(`[ERROR] Compilation: ${err.message}`, "err");
            }
        }
    },
    {
        id: "view_toggle_viewport",
        category: "View",
        catClass: "cat-binaryen",
        title: "Toggle Floating Viewport Window",
        shortcut: "",
        action: () => toggleFloatingViewport()
    },
    {
        id: "view_toggle_console",
        category: "View",
        catClass: "cat-wabt",
        title: "Toggle Bottom Console Drawer",
        shortcut: "",
        action: () => toggleConsole()
    },
    {
        id: "view_resize_viewport",
        category: "View",
        catClass: "cat-workspace",
        title: "Expand / Reset Floating Viewport Size",
        shortcut: "",
        action: () => floatingViewport?.classList.toggle("expanded")
    },
    {
        id: "laundry_presets",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Browse Example Project Presets...",
        shortcut: "",
        action: () => { presetsModal.style.display = "flex"; }
    },
    {
        id: "laundry_export_zip",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Export Workspace as Standalone ZIP",
        shortcut: "",
        action: () => exportWorkspaceZip()
    },
    {
        id: "laundry_import_zip",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Import Project ZIP Archive...",
        shortcut: "",
        action: () => zipFileInput.click()
    },
    {
        id: "laundry_toggle_pause",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Play / Pause Viewport Animation",
        shortcut: "",
        action: () => playPauseBtn.click()
    },
    {
        id: "laundry_clear_logs",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Clear Console Output",
        shortcut: "",
        action: () => clearLogs()
    },
    {
        id: "laundry_copy_logs",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Copy Console Logs to Clipboard",
        shortcut: "",
        action: () => copyLogsBtn.click()
    },
    {
        id: "laundry_docs",
        category: "Laundry",
        catClass: "cat-workspace",
        title: "Open Wash API Documentation",
        shortcut: "",
        action: () => { docsModal.style.display = "flex"; }
    },

    // --- WORKSPACE & FILE MANAGEMENT ---
    {
        id: "workspace_new_c",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Create New C Shader (.c)",
        shortcut: "",
        action: () => createNewCShader()
    },
    {
        id: "workspace_new_js",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Create New JavaScript File (.js)",
        shortcut: "",
        action: () => {
            const name = prompt("Enter JS filename:", "script.js");
            if (name && name.trim()) {
                vfsSetFile(name.trim(), `// JavaScript File\nconsole.log("Hello from Wash!");\n`);
                openFileInEditor(name.trim());
            }
        }
    },
    {
        id: "workspace_new_wat",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Create New WebAssembly Text File (.wat)",
        shortcut: "",
        action: () => {
            const defaultWat = `(module\n  (func (export "add") (param i32 i32) (result i32)\n    local.get 0\n    local.get 1\n    i32.add)\n)`;
            const name = `module_${Date.now().toString(36).substring(4)}.wat`;
            vfsSetFile(name, defaultWat);
            openFileInEditor(name);
        }
    },
    {
        id: "workspace_new_folder",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Create New Folder",
        shortcut: "",
        action: () => {
            const folder = prompt("Enter folder name:", "shaders");
            if (!folder || !folder.trim()) return;
            const clean = folder.trim().replace(/\/+$/, "").replace(/^\/+/, "");
            const placeholder = `${clean}/readme.txt`;
            vfsSetFile(placeholder, `Folder: ${clean}`);
        }
    },
    {
        id: "workspace_rename_file",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Rename Current File...",
        shortcut: "",
        action: () => {
            if (!activeFilePath) return;
            const newPath = prompt("Enter new path / filename:", activeFilePath);
            if (newPath && newPath.trim() && newPath.trim() !== activeFilePath) {
                vfsRenameFile(activeFilePath, newPath.trim());
            }
        }
    },
    {
        id: "workspace_delete_file",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Delete Current File",
        shortcut: "",
        action: () => {
            if (!activeFilePath) return;
            if (confirm(`Delete file "${activeFilePath}"?`)) {
                vfsDeleteFile(activeFilePath);
            }
        }
    },
    {
        id: "workspace_toggle_sidebar",
        category: "Workspace",
        catClass: "cat-workspace",
        title: "Toggle File Explorer Sidebar",
        shortcut: "",
        action: () => toggleSidebar()
    }
];

// Helper to get wasm bytes from active file or compiled shader
async function getActiveWasmBytes() {
    const activeFile = activeFilePath ? vfs.get(activeFilePath) : null;
    if (!activeFile) {
        alert("No active file in workspace.");
        return null;
    }

    if (activeFile.type === "wasm") {
        return activeFile.content;
    }

    const wasmName = activeFile.name.replace(/\.c$/, ".wasm");
    if (compiledShaders[wasmName]) {
        return compiledShaders[wasmName];
    }

    // Try compiling if it's a C shader
    if (activeFile.type === "c") {
        try {
            log(`Compiling ${activeFile.name} to obtain WASM binary...`, "info");
            const res = await compileShader(activeFile.name, activeFile.content);
            const importedBytes = new Uint8Array(makeWasmImportMemory(res.wasmBytes));
            compiledShaders[res.outFileName] = importedBytes;
            vfsSetFile(res.outFileName, importedBytes, true);
            return importedBytes;
        } catch (err) {
            log(`❌ Failed to compile ${activeFile.name}: ${err.message}`, "err");
            return null;
        }
    }

    alert(`Cannot obtain WASM binary from file "${activeFile.name}". Open a .c or .wasm file.`);
    return null;
}



// Command Palette UI Logic
let selectedCommandIndex = 0;
let filteredCommands = [];

function openCommandPalette() {
    commandPaletteModal.style.display = "flex";
    commandPaletteInput.value = "";
    filterCommands("");
    setTimeout(() => commandPaletteInput.focus(), 50);
}

function closeCommandPalette() {
    commandPaletteModal.style.display = "none";
}

function filterCommands(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
        filteredCommands = [...COMMAND_REGISTRY];
    } else {
        filteredCommands = COMMAND_REGISTRY.filter(cmd => 
            cmd.title.toLowerCase().includes(q) ||
            cmd.category.toLowerCase().includes(q) ||
            cmd.shortcut.toLowerCase().includes(q)
        );
    }
    selectedCommandIndex = 0;
    renderCommandList();
}

function renderCommandList() {
    commandPaletteList.innerHTML = "";

    if (filteredCommands.length === 0) {
        commandPaletteList.innerHTML = `<div style="color:var(--gray); padding:14px; text-align:center; font-size:12px;">No matching commands found.</div>`;
        return;
    }

    filteredCommands.forEach((cmd, idx) => {
        const item = document.createElement("div");
        item.className = `command-item ${idx === selectedCommandIndex ? "selected" : ""}`;
        item.innerHTML = `
            <div class="command-item-main">
                <span class="command-category ${cmd.catClass}">${cmd.category}</span>
                <span class="command-title">${cmd.title}</span>
            </div>
            ${cmd.shortcut ? `<span class="command-shortcut">${cmd.shortcut}</span>` : ""}
        `;

        item.addEventListener("click", () => {
            closeCommandPalette();
            cmd.action();
        });

        item.addEventListener("mouseenter", () => {
            selectedCommandIndex = idx;
            updateCommandSelection();
        });

        commandPaletteList.appendChild(item);
    });

    scrollSelectedIntoView();
}

function updateCommandSelection() {
    const items = commandPaletteList.querySelectorAll(".command-item");
    items.forEach((item, i) => {
        item.classList.toggle("selected", i === selectedCommandIndex);
    });
}

function scrollSelectedIntoView() {
    const selected = commandPaletteList.querySelector(".command-item.selected");
    if (selected) {
        selected.scrollIntoView({ block: "nearest" });
    }
}

commandPaletteInput?.addEventListener("input", (e) => {
    filterCommands(e.target.value);
});

commandPaletteInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredCommands.length > 0) {
            selectedCommandIndex = (selectedCommandIndex + 1) % filteredCommands.length;
            updateCommandSelection();
            scrollSelectedIntoView();
        }
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredCommands.length > 0) {
            selectedCommandIndex = (selectedCommandIndex - 1 + filteredCommands.length) % filteredCommands.length;
            updateCommandSelection();
            scrollSelectedIntoView();
        }
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands.length > 0 && filteredCommands[selectedCommandIndex]) {
            const cmd = filteredCommands[selectedCommandIndex];
            closeCommandPalette();
            cmd.action();
        }
    } else if (e.key === "Escape") {
        closeCommandPalette();
    }
});

// =============================================================================
// Modals & Navigation
// =============================================================================
closeDocsBtn?.addEventListener("click", () => docsModal.style.display = "none");
closePresetsBtn?.addEventListener("click", () => {
    presetsModal.style.display = "none";
});

document.querySelectorAll(".preset-card").forEach(card => {
    card.addEventListener("click", () => {
        const key = card.getAttribute("data-preset");
        if (key) {
            presetsModal.style.display = "none";
            loadPreset(key);
        }
    });
});

[docsModal, presetsModal, commandPaletteModal].forEach(modal => {
    modal?.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
    });
});

window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (docsModal.style.display !== "none") docsModal.style.display = "none";
        if (presetsModal.style.display !== "none") presetsModal.style.display = "none";
        if (commandPaletteModal.style.display !== "none") commandPaletteModal.style.display = "none";
    }
});

// =============================================================================
// Initial Setup
// =============================================================================
initMonaco().then(() => {
    loadPreset("pipeline");
});
