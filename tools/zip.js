/**
 * Laundry - Standalone Project ZIP Exporter & Importer
 */

let jszipInstance = null;

export async function initJSZip(vendorPath) {
    if (!jszipInstance) {
        if (typeof window !== "undefined" && window.JSZip) {
            jszipInstance = window.JSZip;
        } else if (typeof globalThis !== "undefined" && globalThis.JSZip) {
            jszipInstance = globalThis.JSZip;
        } else {
            const scriptUrl = vendorPath || new URL("./vendor/jszip.min.js", import.meta.url).href;
            if (typeof document !== "undefined") {
                await new Promise((resolve, reject) => {
                    const script = document.createElement("script");
                    script.src = scriptUrl;
                    script.onload = () => {
                        jszipInstance = window.JSZip || globalThis.JSZip;
                        resolve();
                    };
                    script.onerror = () => reject(new Error(`Failed to load JSZip from ${scriptUrl}`));
                    document.head.appendChild(script);
                });
            } else if (typeof importScripts === "function") {
                importScripts(scriptUrl);
                jszipInstance = globalThis.JSZip;
            }
        }
    }
    return jszipInstance;
}

/**
 * Exports a map of files into a standalone ZIP project.
 * @param {Record<string, string|Uint8Array|ArrayBuffer>} filesMap - Map of relative path to string or binary content
 * @param {object} options - { type?: 'blob'|'uint8array'|'arraybuffer'|'nodebuffer', vendorPath?: string }
 * @returns {Promise<Blob|Uint8Array|ArrayBuffer>}
 */
export async function exportProjectZip(filesMap, options = {}) {
    const JSZip = await initJSZip(options.vendorPath);
    const zip = new JSZip();

    for (const [path, content] of Object.entries(filesMap)) {
        if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
            zip.file(path, content, { binary: true });
        } else {
            zip.file(path, String(content));
        }
    }

    const outputType = options.type || (typeof Blob !== "undefined" ? "blob" : "uint8array");
    return zip.generateAsync({ type: outputType });
}

/**
 * Imports a ZIP project into a key-value map of files.
 * @param {Blob|Uint8Array|ArrayBuffer} zipData 
 * @param {object} options - { vendorPath?: string }
 * @returns {Promise<Record<string, { name: string, content: string|Uint8Array, isBinary: boolean }>>}
 */
export async function importProjectZip(zipData, options = {}) {
    const JSZip = await initJSZip(options.vendorPath);
    const zip = await JSZip.loadAsync(zipData);
    const files = {};

    for (const [relativePath, fileObj] of Object.entries(zip.files)) {
        if (fileObj.dir) continue;
        
        const isBinary = /\.(wasm|png|jpg|jpeg|gif|bin|dat|raw)$/i.test(relativePath);
        if (isBinary) {
            const bytes = await fileObj.async("uint8array");
            files[relativePath] = {
                name: relativePath,
                content: bytes,
                isBinary: true
            };
        } else {
            const text = await fileObj.async("string");
            files[relativePath] = {
                name: relativePath,
                content: text,
                isBinary: false
            };
        }
    }

    return files;
}
