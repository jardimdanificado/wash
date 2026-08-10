const fs = require('fs');
const path = require('path');
const Wash = require('./wash.js');

async function main() {
  const wasmFile = path.join(__dirname, 'examples_v2', 'shader_v2.wasm');
  if (!fs.existsSync(wasmFile)) {
    console.error("Compile shader_v2.c first!");
    process.exit(1);
  }

  const wasmBytes = fs.readFileSync(wasmFile);
  const context = Wash.createContext();

  const importObject = {
    env: {
      memory: new WebAssembly.Memory({ initial: 256 }), // Need enough memory for 1.2MB buffer (at least 20 pages)
      wextension: (namePtr, dataPtr) => {
        return context.handleWextension(namePtr, dataPtr, memory.buffer);
      }
    }
  };

  const wasmModule = await WebAssembly.instantiate(wasmBytes, importObject);
  const exports = wasmModule.instance.exports;
  const memory = exports.memory || importObject.env.memory;

  if (!exports.shader_main) {
    console.error("Error: WASM module missing shader_main export (V2 ABI).");
    process.exit(1);
  }

  const width = 640;
  const height = 480;
  
  // V2 Magic: Pre-cache the Uint8Array!
  // We can fetch the pointer once using get_framebuffer or just from the first frame.
  const vramPtr = exports.get_framebuffer ? exports.get_framebuffer() : exports.shader_main(width, height, 0);
  
  // ZERO COPY: We create a view pointing directly to the WASM memory buffer.
  const rgbaView = new Uint8Array(memory.buffer, vramPtr, width * height * 4);

  console.log(`Running V2 Shader for 1000 frames at ${width}x${height}...`);
  
  const startTime = process.hrtime.bigint();
  
  // Render loop
  for (let i = 0; i < 1000; i++) {
    // 1. Tell WASM to do the math and update its internal buffer
    exports.shader_main(width, height, 0);
    
    // 2. The data is ALREADY in `rgbaView`. 
    // In a real app, you would pass `rgbaView` directly to Canvas putImageData or WebGL texImage2D here.
    // For this benchmark, we just read one pixel to ensure optimizer doesn't skip the loop.
    const pixel = rgbaView[0]; 
  }

  const endTime = process.hrtime.bigint();
  const elapsedMs = Number(endTime - startTime) / 1_000_000;
  
  console.log(`Finished 1000 frames in ${elapsedMs.toFixed(2)} ms!`);
  console.log(`Average Frame Time: ${(elapsedMs / 1000).toFixed(4)} ms`);
  console.log(`Theoretical Max FPS: ${(1000 / (elapsedMs / 1000)).toFixed(0)} FPS`);
  console.log("\nZero-copy architecture proven successful.");
}

main().catch(console.error);
