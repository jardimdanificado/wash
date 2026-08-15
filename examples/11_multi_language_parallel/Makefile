.PHONY: all clean c zig as wat v rust

all: c zig as wat v rust

c:
	clang --target=wasm32 -O3 -nostdlib -Wl,--no-entry -Wl,--export=_start -Wl,--export=__heap_base shader_c.c -o shader_c.wasm

zig:
	zig build-exe -target wasm32-freestanding -O ReleaseFast -fno-entry --export=_start shader_zig.zig -femit-bin=shader_zig.wasm

as:
	asc shader_as.ts -o shader_as.wasm --runtime stub --optimize -O3

wat:
	wat2wasm shader_wat.wat -o shader_wat.wasm

v:
	v -b wasm shader_v.v -o shader_v.wasm

rust:
	clang --target=wasm32 -O3 -nostdlib -Wl,--no-entry -Wl,--export=_start -Wl,--export=__heap_base shader_rust.c -o shader_rust.wasm 2>/dev/null || true

clean:
	rm -f *.wasm
