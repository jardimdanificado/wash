// Tool Presets for Wash Studio Toolkit

export const TOOL_PRESETS = {
    pipeline: [
        {
            id: 'fib_js',
            name: 'Fibonacci (JS Pipeline)',
            desc: 'Computes N-th Fibonacci number in JS for C/WASM compilation',
            code: `function fib(n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}

let result = fib(10);
console.log("Fib(10) =", result);
`
        },
        {
            id: 'math_js',
            name: 'Mandelbrot Math (JS)',
            desc: 'Iterative Mandelbrot calculation in JS',
            code: `function mandelbrot(cr, ci, max_iter) {
    let zr = 0.0;
    let zi = 0.0;
    let iter = 0;
    while (iter < max_iter && (zr * zr + zi * zi) <= 4.0) {
        let n_zr = zr * zr - zi * zi + cr;
        let n_zi = 2.0 * zr * zi + ci;
        zr = n_zr;
        zi = n_zi;
        iter = iter + 1;
    }
    return iter;
}

let val = mandelbrot(-0.5, 0.5, 100);
console.log("Mandelbrot iter count:", val);
`
        }
    ],
    wabt: [
        {
            id: 'add_wat',
            name: 'Direct WAT Module',
            code: `(module
  (func $add (export "add") (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add)
  (func $square (export "square") (param $n i32) (result i32)
    local.get $n
    local.get $n
    i32.mul)
)`
        },
        {
            id: 'memory_wat',
            name: 'Memory Store & Load (WAT)',
            code: `(module
  (memory (export "memory") 1)
  (func (export "store_and_load") (param $val i32) (result i32)
    i32.const 0
    local.get $val
    i32.store
    i32.const 0
    i32.load)
)`
        }
    ]
};
