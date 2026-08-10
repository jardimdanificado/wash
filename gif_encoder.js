/**
 * Lightweight JS GIF & PPM encoder
 * Compatible with baremetal JS (mqwjs3 / qwjs3)
 */

var WagnosticEncoder = (function() {
    
    function writePPM(width, height, frames, filename) {
        if (frames.length === 0) return;
        var rgba32 = frames[0]; // Write first frame
        
        var header = "P6\n" + width + " " + height + "\n255\n";
        var headerLen = header.length;
        var out = new Uint8Array(headerLen + width * height * 3);
        
        for (var i = 0; i < headerLen; i++) {
            out[i] = header.charCodeAt(i);
        }
        
        var idx = headerLen;
        for (var i = 0; i < width * height; i++) {
            var c = rgba32[i];
            out[idx++] = (c >> 24) & 0xFF; // R
            out[idx++] = (c >> 16) & 0xFF; // G
            out[idx++] = (c >> 8)  & 0xFF; // B
        }
        
        if (typeof writeBinaryFile === 'function') {
            writeBinaryFile(filename, out.buffer);
        } else if (typeof std !== 'undefined' && std.open) {
            var f = std.open(filename, "w");
            if (f) {
                f.write(out.buffer, 0, out.length);
                f.close();
            }
        }
    }

    function writeGIF(width, height, frames, delayCs, filename) {
        if (frames.length === 0) return;
        
        var palette = [];
        var colorToIndex = {};
        palette.push([0, 0, 0]);
        colorToIndex["0,0,0"] = 0;
        
        for (var f = 0; f < frames.length; f++) {
            var rgba32 = frames[f];
            for (var i = 0; i < rgba32.length; i++) {
                var c = rgba32[i];
                var r = (c >> 24) & 0xFF;
                var g = (c >> 16) & 0xFF;
                var b = (c >> 8) & 0xFF;
                var key = r + "," + g + "," + b;
                
                if (colorToIndex[key] === undefined) {
                    if (palette.length < 256) {
                        colorToIndex[key] = palette.length;
                        palette.push([r, g, b]);
                    }
                }
            }
        }
        
        while (palette.length < 256) {
            palette.push([0, 0, 0]);
        }
        
        var out = [];
        function writeByte(b) { out.push(b & 0xFF); }
        function writeShort(s) { writeByte(s); writeByte(s >> 8); }
        function writeString(s) {
            for (var i = 0; i < s.length; i++) writeByte(s.charCodeAt(i));
        }
        
        writeString("GIF89a");
        writeShort(width);
        writeShort(height);
        writeByte(0xF7);
        writeByte(0);
        writeByte(0);
        
        for (var i = 0; i < 256; i++) {
            writeByte(palette[i][0]);
            writeByte(palette[i][1]);
            writeByte(palette[i][2]);
        }
        
        writeByte(0x21); writeByte(0xFF); writeByte(0x0B);
        writeString("NETSCAPE2.0");
        writeByte(0x03); writeByte(0x01); writeShort(0);
        writeByte(0x00);
        
        for (var f = 0; f < frames.length; f++) {
            var rgba32 = frames[f];
            
            writeByte(0x21); writeByte(0xF9); writeByte(0x04);
            writeByte(0x00);
            writeShort(delayCs);
            writeByte(0x00);
            writeByte(0x00);
            
            writeByte(0x2C);
            writeShort(0); writeShort(0);
            writeShort(width); writeShort(height);
            writeByte(0x00);
            
            writeByte(0x08);
            
            var clearCode = 256;
            var eoiCode = 257;
            
            var dict = {};
            var dictSize = 258;
            var curCodeSize = 9;
            var curShift = 0;
            var curBuf = 0;
            var blockBuf = [];
            
            function emitBits(code, numBits) {
                curBuf |= (code << curShift);
                curShift += numBits;
                while (curShift >= 8) {
                    blockBuf.push(curBuf & 0xFF);
                    curBuf >>= 8;
                    curShift -= 8;
                    if (blockBuf.length === 255) {
                        writeByte(255);
                        for (var i=0; i<255; i++) writeByte(blockBuf[i]);
                        blockBuf = [];
                    }
                }
            }
            
            function flushBits() {
                if (curShift > 0) {
                    blockBuf.push(curBuf & 0xFF);
                }
                if (blockBuf.length > 0) {
                    writeByte(blockBuf.length);
                    for (var i=0; i<blockBuf.length; i++) writeByte(blockBuf[i]);
                }
                writeByte(0);
            }
            
            emitBits(clearCode, curCodeSize);
            
            var p = "";
            for (var i = 0; i < width * height; i++) {
                var c = rgba32[i];
                var r = (c >> 24) & 0xFF;
                var g = (c >> 16) & 0xFF;
                var b = (c >> 8) & 0xFF;
                var key = r + "," + g + "," + b;
                var idx = colorToIndex[key] || 0;
                
                var cStr = String.fromCharCode(idx);
                var pc = p + cStr;
                if (dict[pc] !== undefined) {
                    p = pc;
                } else {
                    emitBits(p.length === 1 ? p.charCodeAt(0) : dict[p], curCodeSize);
                    dict[pc] = dictSize++;
                    if (dictSize === (1 << curCodeSize)) {
                        curCodeSize++;
                        if (curCodeSize > 12) {
                            emitBits(clearCode, curCodeSize - 1);
                            dict = {};
                            dictSize = 258;
                            curCodeSize = 9;
                        }
                    }
                    p = cStr;
                }
            }
            if (p !== "") {
                emitBits(p.length === 1 ? p.charCodeAt(0) : dict[p], curCodeSize);
            }
            emitBits(eoiCode, curCodeSize);
            flushBits();
        }
        
        writeByte(0x3B);
        
        if (typeof writeBinaryFile === 'function') {
            var buf = new Uint8Array(out);
            writeBinaryFile(filename, buf.buffer);
        } else if (typeof std !== 'undefined' && std.open) {
            var f = std.open(filename, "wb");
            if (f) {
                var buf = new Uint8Array(out);
                f.write(buf.buffer, 0, buf.length);
                f.close();
            }
        }
    }

    return {
        writePPM: writePPM,
        writeGIF: writeGIF
    };
})();
