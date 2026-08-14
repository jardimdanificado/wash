all: simulate.wasm render.wasm

simulate.wasm: simulate.c
	clang --target=wasm32 -O3 -fno-math-errno -nostdlib -Wl,--import-memory -Wl,--export=__heap_base -Wl,--export=_start simulate.c -o simulate.wasm

render.wasm: render.c
	clang --target=wasm32 -O3 -fno-math-errno -nostdlib -Wl,--import-memory -Wl,--export=__heap_base -Wl,--export=_start render.c -o render.wasm

clean:
	rm -f simulate.wasm render.wasm
