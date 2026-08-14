.PHONY: all examples clean

all: examples

examples:
	$(MAKE) -C examples/01_gradient
	$(MAKE) -C examples/02_imports
	$(MAKE) -C examples/03_benchmark
	$(MAKE) -C examples/04_interactive
	$(MAKE) -C examples/05_physics
	$(MAKE) -C examples/06_pathtracer
	$(MAKE) -C examples/07_native_runner
	$(MAKE) -C examples/08_parallel_pathtracer
	$(MAKE) -C examples/09_shared_memory_pipeline

clean:
	rm -f examples/*/*.wasm
	$(MAKE) -C examples/07_native_runner clean
