const fs = require('fs');
const Wash = require('./wash.js');

async function main() {
  const wasmFile = process.argv[2];
  if (!wasmFile) {
    console.error("Usage: node example_node.js <path-to-shader.wasm>");
    process.exit(1);
  }

  const wasmBytes = fs.readFileSync(wasmFile);
  const context = Wash.createContext();

  const importObject = {
    env: {
      memory: new WebAssembly.Memory({ initial: 16 }),
      wextension: (namePtr, dataPtr) => {
        return context.handleWextension(namePtr, dataPtr, memory.buffer);
      }
    }
  };

  const wasmModule = await WebAssembly.instantiate(wasmBytes, importObject);
  const exports = wasmModule.instance.exports;
  const memory = exports.memory || importObject.env.memory;

  if (!exports.wupdate) {
    console.error("Error: WASM module missing wupdate export.");
    process.exit(1);
  }

  console.log("Running WASM Shader 1 frame...");
  
  // Call the shader update
  const statePtr = exports.wupdate();
  if (statePtr === 0) {
    console.log("Shader quit immediately.");
    return;
  }

  // Parse state and vram
  context.statePtr = statePtr;
  const state = Wash.parseState(memory.buffer, statePtr);
  const width = state.width || 320;
  const height = state.height || 240;
  const vramOffset = state.vramOffset;
  
  console.log(`Frame details: ${width}x${height} (Offset: ${vramOffset})`);

  if (vramOffset > 0) {
    const vramLength = Wash.getVramLength(state, width, height);
    const vramPtr = statePtr + vramOffset;
    const vramRaw = new Uint8Array(memory.buffer, vramPtr, vramLength);

    // Prepare buffer for RGBA32 output
    const rgbaBuffer = Buffer.alloc(width * height * 4);
    const out32 = new Uint32Array(rgbaBuffer.buffer, rgbaBuffer.byteOffset, width * height);
    
    Wash.convertPixelsToRgba32(state, vramRaw, width, height, out32);

    console.log("Successfully converted to RGBA32! Buffer size: " + rgbaBuffer.length + " bytes");
    // You can now save rgbaBuffer or process it further...
  }
}

main().catch(console.error);
