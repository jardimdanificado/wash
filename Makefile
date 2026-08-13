all: build

build:
	clang --target=wasm32 -fno-math-errno -O3 -nostdlib -Wl,--export=__heap_base raytrace.c -o raytrace.wasm

clean:
	rm -f raytrace.wasm

.PHONY: all build clean
