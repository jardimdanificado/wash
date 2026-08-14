build:
	clang --target=wasm32 -O3 -fno-math-errno -nostdlib -Wl,--import-memory -Wl,--export=__heap_base -Wl,--export=_start main.c -o main.wasm
