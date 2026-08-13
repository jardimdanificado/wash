# WASH ray tracing benchmark

A small WASH example that renders a scene of spheres using CPU ray tracing.
The same scene is rendered in C compiled to WebAssembly and in JavaScript.

## Build

```sh
make
```

## Run

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/`.

The benchmark uses 800x600 = 480,000 primary rays. Each pixel performs sphere
intersection tests and, for hits, additional shadow-ray intersection tests.
The JS and WASM implementations perform equivalent work.
