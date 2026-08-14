import { wash_memory, wash_load, wash_run } from "../../wash.js";

let shader = null;
let sharedMem = null;

self.onmessage = async (e) => {
    const data = e.data;

    if (data.type === "init") {
        try {
            // Allocate memory & load the WASM shader using the new Wash API
            sharedMem = wash_memory(data.totalSize);
            shader = await wash_load(data.module, sharedMem);
            self.postMessage({ type: "ready" });
        } catch (err) {
            console.error("Worker Wash initialization error:", err);
        }
        return;
    }

    if (data.type === "render_slice") {
        if (!shader || !sharedMem) return;

        const {
            width, height, frameCount,
            camX, camY, camZ,
            pitch, yaw,
            startY, endY,
            threadId, totalThreads,
            pixelOffset, sliceByteLength
        } = data;

        // Populate slice uniforms in the worker's memory view
        const view = sharedMem.view;
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

        // Execute shader using wash_run
        wash_run(shader, sharedMem);

        // Extract this slice's RGBA pixel data
        const sliceOffset = pixelOffset + (startY * width * 4);
        const slicePixels = sharedMem.rawU8(sliceOffset, sliceByteLength);

        // Transfer buffer back to main thread
        const transferBuffer = slicePixels.slice().buffer;
        self.postMessage({
            type: "done",
            threadId,
            startY,
            endY,
            sliceData: transferBuffer
        }, [transferBuffer]);
    }
};
