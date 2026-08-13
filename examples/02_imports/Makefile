build:
	clang --target=wasm32 -Oz -nostdlib -Wl,--export=__heap_base -Wl,--allow-undefined imports.c -o imports.wasm
