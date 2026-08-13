build:
	clang --target=wasm32 -O3 -fno-math-errno -nostdlib -Wl,--export=__heap_base main.c -o main.wasm
