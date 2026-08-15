// Binaryen Driver (wasm-opt / optimization passes)

let binaryenInstance = null;

export async function initBinaryen() {
    if (!binaryenInstance) {
        if (window.Binaryen) {
            binaryenInstance = window.Binaryen;
        } else {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "./vendor/binaryen.js";
                script.onload = () => {
                    binaryenInstance = window.Binaryen;
                    resolve();
                };
                script.onerror = () => reject(new Error("Failed to load Binaryen from ./vendor/binaryen.js"));
                document.head.appendChild(script);
            });
        }
    }
    return binaryenInstance;
}

/**
 * Optimizes WASM binary using Binaryen wasm-opt passes
 * @param {Uint8Array|ArrayBuffer} wasmBytes 
 * @param {object} options { level: 'O3'|'O2'|'O1'|'Os'|'Oz'|'custom', passes: string[] }
 * @returns {Promise<{ optimizedBytes: Uint8Array, originalSize: number, optimizedSize: number, ratio: string, textWat: string }>}
 */
export async function optimizeWasm(wasmBytes, options = {}) {
    const Binaryen = await initBinaryen();
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    const originalSize = bytes.byteLength;

    const module = Binaryen.readBinary(bytes);

    try {
        const level = options.level || 'O3';
        
        switch (level) {
            case 'O1':
                module.optimize();
                break;
            case 'O2':
                Binaryen.setOptimizeLevel(2);
                Binaryen.setShrinkLevel(0);
                module.optimize();
                break;
            case 'O3':
                Binaryen.setOptimizeLevel(3);
                Binaryen.setShrinkLevel(0);
                module.optimize();
                break;
            case 'Os':
                Binaryen.setOptimizeLevel(2);
                Binaryen.setShrinkLevel(1);
                module.optimize();
                break;
            case 'Oz':
                Binaryen.setOptimizeLevel(3);
                Binaryen.setShrinkLevel(2);
                module.optimize();
                break;
            case 'custom':
                if (Array.isArray(options.passes)) {
                    module.runPasses(options.passes);
                }
                break;
            default:
                module.optimize();
        }

        const optimizedBytes = module.emitBinary();
        const textWat = module.emitText();
        const optimizedSize = optimizedBytes.byteLength;
        const diff = originalSize - optimizedSize;
        const ratio = originalSize > 0 
            ? `${((1 - (optimizedSize / originalSize)) * 100).toFixed(1)}% reduction (${diff >= 0 ? '-' : '+'}${Math.abs(diff)} bytes)` 
            : "0%";

        return {
            optimizedBytes: new Uint8Array(optimizedBytes),
            originalSize,
            optimizedSize,
            ratio,
            textWat
        };
    } finally {
        module.dispose();
    }
}
