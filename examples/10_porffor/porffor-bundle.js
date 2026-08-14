// Porffor browser bundle adapter.
// The actual current Porffor compiler is bundled by esm.sh from the current
// CanadaHonk/porffor GitHub tree. No Node.js, C compiler, or WASM runtime is used.

globalThis.process ??= {
    argv: ["porffor-browser", "--target=c", "--quiet"],
    version: undefined,
    env: {}
};

globalThis.file = "repl.js";

let compilerPromise;

export async function compileToC(source) {
    compilerPromise ??= import(
        "https://esm.sh/gh/CanadaHonk/porffor/compiler/index.js?standalone&target=es2022"
    );

    const { default: compile } = await compilerPromise;

    // The compiler's public entry point returns the generated IR object for
    // target=c; its C renderer is performed inside compiler/index.js.
    //
    // The current compiler prints C when no output file is supplied. In a
    // browser we capture that console output instead.
    const oldLog = console.log;
    let captured = "";

    console.log = (...args) => {
        captured += args.map(String).join(" ") + "\n";
    };

    try {
        await compile(source, false, false);
    } finally {
        console.log = oldLog;
    }

    return captured;
}
