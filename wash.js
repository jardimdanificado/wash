/**
 * Wash (Wasm Shaders) Core V2 - `wash.js`
 *
 * Baremetal-compatible JavaScript implementation of the Wagnostic V2 ABI.
 * Headless runner for WASM shaders into framebuffers (Zero-Copy).
 * Target engines: Node.js, Web Browsers, and mqwjs (MicroQuickJS).
 * Written in ES3/ES5 syntax for maximum portability.
 */

(function(global, factory) {
  if (typeof exports !== 'undefined') {
    // CommonJS / Node.js
    factory(exports);
  } else {
    // Browser or Baremetal (mqwjs)
    global.Wash = global.Wash || {};
    factory(global.Wash);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(exports) {

  function readWasmString(buffer, ptr) {
    if (!ptr || !buffer) return "";
    var bytes = new Uint8Array(buffer, ptr);
    var len = 0;
    while (len < 1024 && bytes[len] !== 0) {
      len++;
    }
    var str = "";
    for (var i = 0; i < len; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }

  function writeWasmString(buffer, ptr, str) {
    if (!ptr || !buffer) return;
    var bytes = new Uint8Array(buffer, ptr, str.length + 1);
    for (var i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    bytes[str.length] = 0;
  }

  function createContext() {
    return {
      title: "Wash Host V2",
      lastTitlePtr: 0,
      
      // In V2, input is ideally handled via event functions directly on the WASM exports,
      // but if the user wants standard string-based extensions, they are handled here.
      handleWextension: function(namePtr, dataPtr, memoryBuffer) {
        var name = readWasmString(memoryBuffer, namePtr);
        if (name === "title.set") {
          if (dataPtr) {
            this.title = readWasmString(memoryBuffer, dataPtr);
            this.lastTitlePtr = dataPtr;
            return dataPtr;
          }
          return 0;
        }
        if (name === "title.get") {
          if (dataPtr) {
            writeWasmString(memoryBuffer, dataPtr, this.title);
            return dataPtr;
          }
          return this.lastTitlePtr;
        }
        return 0;
      }
    };
  }

  exports.readWasmString = readWasmString;
  exports.writeWasmString = writeWasmString;
  exports.createContext = createContext;

});
