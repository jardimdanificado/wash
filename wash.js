export async function wash(url, size, imports = {}) {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url), imports);
    const memory = instance.exports.memory;
    
    // Leitura automática do __heap_base se exportado pelo compilador, senão fallback
    const heapBase = instance.exports.__heap_base ? instance.exports.__heap_base.value : 65536;
    
    const pages = Math.ceil((heapBase + size) / 65536);
    const current = memory.buffer.byteLength / 65536;
    if (pages > current) memory.grow(pages - current);

    return {
        run: () => instance.exports._start(heapBase),
        memory,
        instance,
        u8: new Uint8Array(memory.buffer, heapBase, size),
        view: new DataView(memory.buffer, heapBase, size)
    };
}
