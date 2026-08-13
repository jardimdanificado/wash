build:
	clang --target=wasm32 -Oz -fno-math-errno -nostdlib -Wl,--export=__heap_base main.c -o main.wasm
