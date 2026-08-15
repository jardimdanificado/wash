import { WASI, File, Directory, OpenFile, ConsoleStdout, PreopenDirectory } from "https://unpkg.com/@bjorn3/browser_wasi_shim@0.3.0/dist/index.js";

const DEFAULT_SYSROOT = {
  "sysroot/include/stdint.h": "I2lmbmRlZiBfU1RESU5UX0gKI2RlZmluZSBfU1RESU5UX0gKdHlwZWRlZiBzaWduZWQgY2hhciBpbnQ4X3Q7CnR5cGVkZWYgc2hvcnQgaW50MTZfdDsKdHlwZWRlZiBpbnQgaW50MzJfdDsKdHlwZWRlZiBsb25nIGxvbmcgaW50NjRfdDsKdHlwZWRlZiB1bnNpZ25lZCBjaGFyIHVpbnQ4X3Q7CnR5cGVkZWYgdW5zaWduZWQgc2hvcnQgdWludDE2X3Q7CnR5cGVkZWYgdW5zaWduZWQgaW50IHVpbnQzMl90Owp0eXBlZGVmIHVuc2lnbmVkIGxvbmcgbG9uZyB1aW50NjRfdDsKdHlwZWRlZiBsb25nIGludHB0cl90Owp0eXBlZGVmIHVuc2lnbmVkIGxvbmcgdWludHB0cl90OwojZGVmaW5lIElOVDhfTUFYIDEyNwojZGVmaW5lIElOVDhfTUlOICgtMTI4KQojZGVmaW5lIFVJTlQ4X01BWCAyNTUKI2RlZmluZSBJTlQxNl9NQVggMzI3NjcKI2RlZmluZSBJTlQxNl9NSU4gKC0zMjc2OCkKI2RlZmluZSBVSU5UMTZfTUFYIDY1NTM1CiNkZWZpbmUgSU5UMzJfTUFYIDIxNDc0ODM2NDcKI2RlZmluZSBJTlQzMl9NSU4gKC0yMTQ3NDgzNjQ3LTEpCiNkZWZpbmUgVUlOVDMyX01BWCA0Mjk0OTY3Mjk1VQojZGVmaW5lIElOVDY0X01BWCA5MjIzMzcyMDM2ODU0Nzc1ODA3TEwKI2RlZmluZSBJTlQ2NF9NSU4gKC05MjIzMzcyMDM2ODU0Nzc1ODA3TEwtMSkKI2RlZmluZSBVSU5UNjRfTUFYIDE4NDQ2NzQ0MDczNzA5NTUxNjE1VUxMCiNlbmRpZgo=",
  "sysroot/include/stdbool.h": "I2lmbmRlZiBfU1REQk9PTF9ICiNkZWZpbmUgX1NUREJPT0xfSAojZGVmaW5lIGJvb2wgX0Jvb2wKI2RlZmluZSB0cnVlIDEKI2RlZmluZSBmYWxzZSAwCiNkZWZpbmUgX19ib29sX3RydWVfZmFsc2VfYXJlX2RlZmluZWQgMQojZW5kaWYK",
  "sysroot/include/stddef.h": "I2lmbmRlZiBfU1REREVfSAojZGVmaW5lIF9TVERERUZfSAp0eXBlZGVmIHVuc2lnbmVkIGxvbmcgc2l6ZV90Owp0eXBlZGVmIGxvbmcgcHRyZGlmZl90OwojaWZuZGVmIE5VTEwKI2RlZmluZSBOVUxMICgodm9pZCopMCkKI2VuZGlmCiNkZWZpbmUgb2Zmc2V0b2YodHlwZSwgbWVyYmVyKSAoKHNpemVfdCkmKCgodHlwZSopMCktPm1lbWJlcikpCiNlbmRpZgo=",
  "sysroot/include/float.h": "I2lmbmRlZiBfRkxPQVRfSAojZGVmaW5lIF9GTE9BVF9ICiNkZWZpbmUgRkxUX01JTiAxLjE3NTQ5NDM1ZS0zOEYKI2RlZmluZSBGTFRfTUFYIDMuNDAyODIzNDdlKzM4RgojZGVmaW5lIEZMVF9FUFNJTE9OIDEuMTkyMDkyOTBlLTA3RgojZW5kaWYK",
  "sysroot/include/math.h": "I2lmbmRlZiBfTUFUSF9ICiNkZWZpbmUgX01BVEhfSAojZGVmaW5lIE1fUEkgMy4xNDE1OTI2NTM1ODk3OTMyMzg0NgojZGVmaW5lIE1fUElfMiAxLjU3MDc5NjMyNjc5NDg5NjYxOTIzCnN0YXRpYyBpbmxpbmUgZmxvYXQgc3FydF9mYXN0KGZsb2F0IHgpIHsgZmxvYXQgZ3Vlc3MgPSB4ICogMC41ZjsgZm9yIChpbnQgaSA9IDA7IGkgPCA2OyArK2kpIGd1ZXNzID0gMC41ZiAqIChndWVzcyArIHggLyBndWVzcyk7IHJldHVybiBndWVzczsgfQpzdGF0aWMgaW5saW5lIGZsb2F0IHNpbl9mYXN0KGZsb2F0IHgpIHsgZmxvYXQgays9KGZsb2F0KShpbnQpKHgqMC4xNTkxNTQ5Zik7IHgtPWsqNi4yODMxODUzZjsgaWYoWDwtMy4xNDE1OTI2NWYpeCs9Ni4yODMxODUzZjsgaWYoWD4zLjE0MTU5MjY1Zil4LT02LjI4MzE4NTNmOyBmbG9hdCBhID0geDxwPy14Onh7IHJldHVybigxNi4wZipeKigzLjE0MTU5MjY1Zi1hKSkvKDQ5LjM0ODAyMmYtNC4wZiphKigzLjE0MTU5MjY1Zi1hKSk7IH0Kc3RhdGljIGlubGluZSBmbG9hdCBjb3NfZmFzdChmbG9hdCB4KSB7IHJldHVybiBzaW5fZmFzdCh4ICsgMS41NzA3OTYzZik7IH0KI2RlZmluZSBzaW5mKHgpIHNpbl9mYXN0KHgpCiNkZWZpbmUgY29zZih4KSBjb3NfZmFzdCh4KQojZGVmaW5lIHNxcnRmKHgpIHNxcnRfZmFzdCh4KQojZGVmaW5lIF9fYnVpbHRpbl9zaW5mKHgpIHNpbl9mYXN0KHgpCiNkZWZpbmUgX19idWlsdGluX2Nvc2ZoeCkgY29zX2Zhc3QoeCkKI2RlZmluZSBfX2J1aWx0aW5fc3FydGYoeCkgc3FydF9mYXN0KHgpCiNlbmRpZgo="
};

let sysrootCache = null;
let ccWasmBytes = null;

async function initCompiler(baseDir = "") {
    if (!sysrootCache) {
        try {
            const url = baseDir ? `${baseDir}/sysroot.json` : new URL("sysroot.json", import.meta.url).href;
            const sysrootRes = await fetch(url);
            if (sysrootRes.ok) {
                sysrootCache = await sysrootRes.json();
            } else {
                sysrootCache = DEFAULT_SYSROOT;
            }
        } catch (_) {
            sysrootCache = DEFAULT_SYSROOT;
        }
    }

    if (!ccWasmBytes) {
        const url = baseDir ? `${baseDir}/cc.wasm` : new URL("cc.wasm", import.meta.url).href;
        const wasmRes = await fetch(url);
        if (!wasmRes.ok) {
            throw new Error(`cc.wasm not found (${wasmRes.status}) at ${url}`);
        }
        ccWasmBytes = await wasmRes.arrayBuffer();
    }
}

function buildTree(pathsAndContents) {
    let root = new Map();
    for (const [path, base64Str] of Object.entries(pathsAndContents)) {
        const binString = atob(base64Str);
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
        
        const parts = path.split('/').filter(p => p);
        let current = root;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current.has(parts[i])) {
                current.set(parts[i], new Map());
            }
            current = current.get(parts[i]);
        }
        current.set(parts[parts.length - 1], new File(bytes));
    }
    
    function toDirOrFile(map) {
        let entries = [];
        for (const [k, v] of map.entries()) {
            if (v instanceof Map) {
                entries.push([k, toDirOrFile(v)]);
            } else {
                entries.push([k, v]);
            }
        }
        return new PreopenDirectory(".", entries).dir;
    }
    return toDirOrFile(root).contents;
}

self.onmessage = async (e) => {
    const { id, type, filename, code, baseDir } = e.data;
    if (type !== 'compile') return;

    const logs = [];
    const log = (msg) => logs.push(msg);

    try {
        await initCompiler(baseDir);

        const rootContents = buildTree(sysrootCache || DEFAULT_SYSROOT);
        rootContents.set("tmp", new Directory(new Map()));

        // Add C source file to virtual WASI filesystem
        const srcFileName = filename && filename.endsWith(".c") ? filename : ((filename || "shader") + ".c");
        const outFileName = srcFileName.replace(/\.c$/, ".wasm");
        const entryPoint = e.data.entryPoint;
        let finalCode = code;

        if (!entryPoint && !/\b_start\b/.test(code) && !/\bmain\b/.test(code)) {
            // Auto-append dummy _start to satisfy the linker when only custom export_name functions are used
            finalCode = code + "\n__attribute__((export_name(\"_start\"))) void _start(void) {}\n";
        }

        rootContents.set(srcFileName, new File(new TextEncoder().encode(finalCode)));

        let rootDirectory = new PreopenDirectory("/", Array.from(rootContents.entries()));

        let args = [
            "cc",
            "-o", "/" + outFileName,
            "-nostdlib",
            "-nodefaultlibs",
            "-I/sysroot/include"
        ];

        if (entryPoint) {
            args.push(`-e${entryPoint}`);
        } else if (/\b_start\b/.test(finalCode)) {
            args.push("-e_start");
        } else if (/\bmain\b/.test(finalCode)) {
            args.push("-emain");
        } else {
            args.push("-e_start");
        }

        args.push("/" + srcFileName);

        let env = ["PWD=/"];
        let fds = [
            new OpenFile(new File([])), // stdin
            ConsoleStdout.lineBuffered(msg => log('[STDOUT] ' + msg)),
            ConsoleStdout.lineBuffered(msg => log('[STDERR] ' + msg)),
            rootDirectory
        ];

        let wasi = new WASI(args, env, fds);
        let inst = await WebAssembly.instantiate(ccWasmBytes, {
            "wasi_snapshot_preview1": wasi.wasiImport
        });

        let exitCode = wasi.start(inst.instance);

        if (exitCode !== 0) {
            self.postMessage({
                id,
                filename,
                status: "error",
                logs: logs.join("\n"),
                error: `Compilation failed with exit code ${exitCode}`
            });
            return;
        }

        let outFile = rootDirectory.dir.contents.get(outFileName);
        if (!outFile || !outFile.data) {
            self.postMessage({
                id,
                filename,
                status: "error",
                logs: logs.join("\n"),
                error: `Output ${outFileName} was not generated`
            });
            return;
        }

        const wasmBytes = outFile.data.slice().buffer;
        self.postMessage({
            id,
            filename,
            outFileName,
            status: "ok",
            logs: logs.join("\n"),
            wasmBytes
        }, [wasmBytes]);

    } catch (err) {
        self.postMessage({
            id,
            filename,
            status: "error",
            logs: logs.join("\n"),
            error: err.message || String(err)
        });
    }
};
