const fs = require('fs');
const path = require('path');
const Wash = require('./wash.js');
const GIFEncoder = require('gif-encoder-2');

async function processWasm(wasmFile, outputGif) {
  const wasmBytes = fs.readFileSync(wasmFile);
  const context = Wash.createContext();

  const importObject = {
    env: {
      memory: new WebAssembly.Memory({ initial: 256 }),
      wextension: (namePtr, dataPtr) => {
        return context.handleWextension(namePtr, dataPtr, memory.buffer);
      },
      abort: () => console.error("WASM Aborted")
    },
    wasi_snapshot_preview1: {
      fd_write: () => 0,
      fd_seek: () => 0,
      fd_close: () => 0,
      proc_exit: (code) => console.log("Exit code:", code),
    }
  };

  let wasmModule;
  try {
    wasmModule = await WebAssembly.instantiate(wasmBytes, importObject);
  } catch (err) {
    try {
        wasmModule = await WebAssembly.instantiate(wasmBytes, { env: importObject.env });
    } catch(err2) {
        console.error(`Failed to load ${wasmFile}: ${err2.message}`);
        return;
    }
  }

  const exports = wasmModule.instance.exports;
  const memory = exports.memory || importObject.env.memory;

  if (!exports.shader_main) {
    console.error(`Error: ${wasmFile} missing shader_main export.`);
    return;
  }

  let encoder = null;
  const frames = 60; // 1 second of animation roughly at 60fps
  const width = 640;
  const height = 480;

  // Initialize V2
  const vramPtr = exports.get_framebuffer ? exports.get_framebuffer() : exports.shader_main(width, height, 0);

  if (vramPtr === 0) {
      console.log(`Failed to get framebuffer for ${wasmFile}`);
      return;
  }

  // Pre-create the view for zero-copy
  const rgbaView = new Uint8Array(memory.buffer, vramPtr, width * height * 4);

  for (let i = 0; i < frames; i++) {
    // Tell the shader to update the VRAM
    const newPtr = exports.shader_main(width, height, 0);

    if (newPtr === 0) {
      break; // Quit immediately if requested
    }

    if (!encoder) {
        encoder = new GIFEncoder(width, height);
        encoder.start();
        encoder.setRepeat(0);   
        encoder.setDelay(16);  
        encoder.setQuality(10); 
    }

    // Since it's V2, rgbaView is already perfectly formatted RGBA32
    // We just pass it directly to the encoder. ZERO COPY!
    encoder.addFrame(rgbaView);
  }

  if (encoder) {
    encoder.finish();
    const buffer = encoder.out.getData();
    fs.writeFileSync(outputGif, buffer);
    console.log(`Generated ${outputGif} (V2)`);
  } else {
    console.log(`No frames generated for ${wasmFile}`);
  }
}

async function main() {
    const examplesDir = path.join(__dirname, 'examples');
    if (!fs.existsSync(examplesDir)) {
        console.error("Examples directory not found.");
        process.exit(1);
    }
    
    const dirs = fs.readdirSync(examplesDir);

    for (const dir of dirs) {
        const fullPath = path.join(examplesDir, dir);
        if (fs.statSync(fullPath).isDirectory()) {
            const wasmFile = path.join(fullPath, `${dir}.wasm`);
            const gifFile = path.join(fullPath, `${dir}.gif`);
            if (fs.existsSync(wasmFile)) {
                console.log(`Processing ${wasmFile}...`);
                await processWasm(wasmFile, gifFile);
            }
        } else if (dir.endsWith('.wasm')) {
            const wasmFile = path.join(examplesDir, dir);
            const gifFile = path.join(examplesDir, dir.replace('.wasm', '.gif'));
            console.log(`Processing ${wasmFile}...`);
            await processWasm(wasmFile, gifFile);
        }
    }
    console.log("Done generating all GIFs.");
}

main().catch(console.error);
