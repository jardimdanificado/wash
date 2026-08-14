CC ?= gcc
CFLAGS ?= -O3 -Wall -Wextra $(shell sdl2-config --cflags 2>/dev/null || echo "")
LIBS ?= $(shell sdl2-config --libs 2>/dev/null || echo "-lSDL2") -lm

WASM3_DIR ?= vendor/wasm3

# Core Wasm3 sources needed for standalone execution
WASM3_SRC = \
	$(WASM3_DIR)/source/m3_core.c \
	$(WASM3_DIR)/source/m3_env.c \
	$(WASM3_DIR)/source/m3_bind.c \
	$(WASM3_DIR)/source/m3_compile.c \
	$(WASM3_DIR)/source/m3_exec.c \
	$(WASM3_DIR)/source/m3_function.c \
	$(WASM3_DIR)/source/m3_info.c \
	$(WASM3_DIR)/source/m3_module.c \
	$(WASM3_DIR)/source/m3_parse.c \
	$(WASM3_DIR)/source/m3_code.c \
	$(WASM3_DIR)/source/m3_validate.c \
	$(WASM3_DIR)/source/m3_api_libc.c

HAS_SYSTEM_WASM3 := $(shell ld -lwasm3 -o /dev/null 2>/dev/null && echo 1 || echo 0)

.PHONY: all clean fetch_wasm3

all: wash_sdl

ifeq ($(HAS_SYSTEM_WASM3), 1)
wash_sdl: main.c
	@echo "==> Using system libwasm3..."
	$(CC) $(CFLAGS) -DUSE_WASM3 main.c -o wash_sdl $(LIBS) -lwasm3
else
wash_sdl: main.c $(WASM3_DIR)/source/wasm3.h
	@echo "==> Compiling with bundled Wasm3 engine..."
	$(CC) $(CFLAGS) -DUSE_WASM3 -I$(WASM3_DIR)/source main.c $(WASM3_SRC) -o wash_sdl $(LIBS)
endif

$(WASM3_DIR)/source/wasm3.h:
	@echo "==> Acquiring Wasm3 from GitHub..."
	@mkdir -p vendor
	git clone --depth 1 https://github.com/wasm3/wasm3.git $(WASM3_DIR)

fetch_wasm3: $(WASM3_DIR)/source/wasm3.h

clean:
	rm -f wash_sdl output.ppm
	rm -rf vendor
