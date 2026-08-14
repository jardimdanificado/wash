let wasmInstance = null;
let heapBase = 65536;
let memory = null;

self.onmessage = async (e) => {
    const data = e.data;

    if (data.type === "init") {
        const { module, totalSize } = data;
        
        try {
            const res = await WebAssembly.instantiate(module);
            wasmInstance = (res instanceof WebAssembly.Instance) ? res : (res.instance || res);
            memory = wasmInstance.exports.memory;

            if (wasmInstance.exports.__heap_base) {
                heapBase = wasmInstance.exports.__heap_base.value;
            }

            // Ensure memory has enough pages
            const requiredPages = Math.ceil((heapBase + totalSize) / 65536);
            const currentPages = memory.buffer.byteLength / 65536;
            if (requiredPages > currentPages) {
                memory.grow(requiredPages - currentPages);
            }

            self.postMessage({ type: "ready" });
        } catch (err) {
            console.error("Worker WASM initialization error:", err);
        }
        return;
    }

    if (data.type === "render_slice") {
        if (!memory || !wasmInstance) {
            return;
        }

        const {
            width, height, frameCount,
            camX, camY, camZ,
            pitch, yaw,
            startY, endY,
            threadId, totalThreads,
            pixelOffset, sliceByteLength
        } = data;

        // Populate slice uniforms in this worker's linear memory
        const view = new DataView(memory.buffer, heapBase);
        view.setUint32(0, width, true);
        view.setUint32(4, height, true);
        view.setUint32(8, frameCount, true);
        view.setFloat32(12, camX, true);
        view.setFloat32(16, camY, true);
        view.setFloat32(20, camZ, true);
        view.setFloat32(24, pitch, true);
        view.setFloat32(28, yaw, true);
        view.setUint32(32, startY, true);
        view.setUint32(36, endY, true);
        view.setUint32(40, threadId, true);
        view.setUint32(44, totalThreads, true);

        // Execute C raytracer kernel for this scanline range
        wasmInstance.exports._start(heapBase);

        // Extract this slice's RGBA pixel data
        const slicePixelStart = heapBase + pixelOffset + (startY * width * 4);
        const slicePixels = new Uint8Array(memory.buffer, slicePixelStart, sliceByteLength);

        // Copy slice to transferable buffer to send back instantly
        const transferBuffer = slicePixels.slice().buffer;

        // Post message with zero-copy transferable ArrayBuffer
        self.postMessage({
            type: "done",
            threadId,
            startY,
            endY,
            sliceData: transferBuffer
        }, [transferBuffer]);
    }
};
