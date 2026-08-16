/**
 * Zero-dependency Pure Node.js Image Encoder & Decoder (PNG, BMP, PPM)
 * Uses only standard built-in modules (node:fs, node:zlib, node:buffer).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// =============================================================================
// CRC32 Utility for PNG Chunks
// =============================================================================
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
}

function crc32(buf, offset = 0, length = buf.length) {
    let crc = 0xffffffff;
    for (let i = offset; i < offset + length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// =============================================================================
// PNG Encoder (RGBA -> PNG Buffer)
// =============================================================================
export function encodePNG(pixels, width, height) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // 1. IHDR Chunk (13 bytes)
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // 8 bits per channel
    ihdrData[9] = 6; // Color type 6 (RGBA)
    ihdrData[10] = 0; // Compression method 0 (deflate)
    ihdrData[11] = 0; // Filter method 0
    ihdrData[12] = 0; // Interlace method 0 (no interlace)

    const ihdrChunk = createChunk("IHDR", ihdrData);

    // 2. IDAT Chunk (Raw scanlines with Filter 0 + Deflate)
    const stride = width * 4;
    const rawScanlines = Buffer.alloc(height * (stride + 1));

    for (let y = 0; y < height; y++) {
        const destOffset = y * (stride + 1);
        rawScanlines[destOffset] = 0; // Filter type 0 (None)
        const srcOffset = y * stride;
        for (let x = 0; x < stride; x++) {
            rawScanlines[destOffset + 1 + x] = pixels[srcOffset + x];
        }
    }

    const compressed = zlib.deflateSync(rawScanlines, { level: 9 });
    const idatChunk = createChunk("IDAT", compressed);

    // 3. IEND Chunk
    const iendChunk = createChunk("IEND", Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
    const chunk = Buffer.alloc(8 + data.length + 4);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, "ascii");
    data.copy(chunk, 8);
    const crc = crc32(chunk, 4, 4 + data.length);
    chunk.writeUInt32BE(crc, 8 + data.length);
    return chunk;
}

// =============================================================================
// PNG Decoder (PNG Buffer -> { width, height, data: Uint8Array RGBA })
// =============================================================================
export function decodePNG(buffer) {
    if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50) {
        throw new Error("Invalid PNG signature");
    }

    let offset = 8;
    let width = 0, height = 0, bitDepth = 8, colorType = 6;
    const idatChunks = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);

        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === "IDAT") {
            idatChunks.push(data);
        } else if (type === "IEND") {
            break;
        }

        offset += 12 + length;
    }

    const compressed = Buffer.concat(idatChunks);
    const inflated = zlib.inflateSync(compressed);

    const channels = (colorType === 6) ? 4 : (colorType === 2 ? 3 : 1);
    const bpp = channels * (bitDepth / 8);
    const stride = width * bpp;
    const pixels = new Uint8Array(width * height * 4);

    let srcPos = 0;
    const prevRow = new Uint8Array(stride);
    const currentRow = new Uint8Array(stride);

    for (let y = 0; y < height; y++) {
        const filter = inflated[srcPos++];
        for (let x = 0; x < stride; x++) {
            const raw = inflated[srcPos++];
            const a = (x >= bpp) ? currentRow[x - bpp] : 0;
            const b = prevRow[x];
            const c = (x >= bpp) ? prevRow[x - bpp] : 0;

            let val = raw;
            if (filter === 1) val = (raw + a) & 0xff; // Sub
            else if (filter === 2) val = (raw + b) & 0xff; // Up
            else if (filter === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff; // Average
            else if (filter === 4) { // Paeth
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
                val = (raw + pr) & 0xff;
            }
            currentRow[x] = val;
        }

        // Copy currentRow to RGBA output
        const rowDst = y * width * 4;
        if (channels === 4) {
            pixels.set(currentRow, rowDst);
        } else if (channels === 3) {
            for (let x = 0; x < width; x++) {
                const dstIdx = rowDst + x * 4;
                const srcIdx = x * 3;
                pixels[dstIdx + 0] = currentRow[srcIdx + 0];
                pixels[dstIdx + 1] = currentRow[srcIdx + 1];
                pixels[dstIdx + 2] = currentRow[srcIdx + 2];
                pixels[dstIdx + 3] = 255;
            }
        } else {
            for (let x = 0; x < width; x++) {
                const dstIdx = rowDst + x * 4;
                const g = currentRow[x];
                pixels[dstIdx + 0] = g;
                pixels[dstIdx + 1] = g;
                pixels[dstIdx + 2] = g;
                pixels[dstIdx + 3] = 255;
            }
        }

        prevRow.set(currentRow);
    }

    return { width, height, data: pixels };
}

// =============================================================================
// BMP Encoder & Decoder (Windows Bitmap 24-bit / 32-bit)
// =============================================================================
export function encodeBMP(pixels, width, height) {
    const rowPadding = (4 - ((width * 3) % 4)) % 4;
    const rowSize = width * 3 + rowPadding;
    const imageSize = rowSize * height;
    const fileSize = 54 + imageSize;

    const buf = Buffer.alloc(fileSize);

    // Header
    buf.write("BM", 0, "ascii");
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(54, 10); // Offset to image data

    // DIB Header (BITMAPINFOHEADER)
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22); // Bottom-up
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28); // 24-bit RGB
    buf.writeUInt32LE(0, 30); // Uncompressed
    buf.writeUInt32LE(imageSize, 34);

    // Pixels (Bottom-Up BGR)
    let pos = 54;
    for (let y = height - 1; y >= 0; y--) {
        const rowStart = y * width * 4;
        for (let x = 0; x < width; x++) {
            const idx = rowStart + x * 4;
            buf[pos++] = pixels[idx + 2]; // B
            buf[pos++] = pixels[idx + 1]; // G
            buf[pos++] = pixels[idx + 0]; // R
        }
        for (let p = 0; p < rowPadding; p++) buf[pos++] = 0;
    }

    return buf;
}

export function decodeBMP(buffer) {
    if (buffer.toString("ascii", 0, 2) !== "BM") throw new Error("Invalid BMP signature");
    const dataOffset = buffer.readUInt32LE(10);
    const width = buffer.readInt32LE(18);
    let height = buffer.readInt32LE(22);
    const bpp = buffer.readUInt16LE(28);

    const isTopDown = height < 0;
    height = Math.abs(height);

    const pixels = new Uint8Array(width * height * 4);
    const rowPadding = (4 - ((width * Math.floor(bpp / 8)) % 4)) % 4;

    let srcPos = dataOffset;
    for (let r = 0; r < height; r++) {
        const y = isTopDown ? r : (height - 1 - r);
        const rowDst = y * width * 4;

        for (let x = 0; x < width; x++) {
            const dstIdx = rowDst + x * 4;
            if (bpp === 32) {
                pixels[dstIdx + 2] = buffer[srcPos++]; // B
                pixels[dstIdx + 1] = buffer[srcPos++]; // G
                pixels[dstIdx + 0] = buffer[srcPos++]; // R
                pixels[dstIdx + 3] = buffer[srcPos++]; // A
            } else if (bpp === 24) {
                pixels[dstIdx + 2] = buffer[srcPos++]; // B
                pixels[dstIdx + 1] = buffer[srcPos++]; // G
                pixels[dstIdx + 0] = buffer[srcPos++]; // R
                pixels[dstIdx + 3] = 255;
            }
        }
        srcPos += rowPadding;
    }

    return { width, height, data: pixels };
}

// =============================================================================
// Animated GIF89a Encoder (Zero-dependency LZW & Color Cube Quantizer)
// =============================================================================
const GIF_PALETTE = [];
// 6x6x6 Color Cube (216 colors)
for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
            GIF_PALETTE.push([Math.round(r * 255 / 5), Math.round(g * 255 / 5), Math.round(b * 255 / 5)]);
        }
    }
}
// 32 Grayscale levels
for (let i = 0; i < 32; i++) {
    const v = Math.round(i * 255 / 31);
    GIF_PALETTE.push([v, v, v]);
}
// 8 Primary accents to reach 256
while (GIF_PALETTE.length < 256) GIF_PALETTE.push([0, 0, 0]);

function gifColorIndex(r, g, b) {
    // Check for grayscale first
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    if (maxDiff < 8) {
        const grayVal = Math.round((r + g + b) / 3);
        const grayIdx = Math.min(31, Math.round(grayVal * 31 / 255));
        return 216 + grayIdx;
    }
    const cr = Math.min(5, Math.round(r * 5 / 255));
    const cg = Math.min(5, Math.round(g * 5 / 255));
    const cb = Math.min(5, Math.round(b * 5 / 255));
    return cr * 36 + cg * 6 + cb;
}

function lzwCompress(indices, minCodeSize = 8) {
    const clearCode = 1 << minCodeSize; // 256
    const eoiCode = clearCode + 1;       // 257

    let curCodeSize = minCodeSize + 1;   // 9 bits
    let nextCode = clearCode + 2;        // 258

    const dict = new Map();
    const outputBits = [];

    function writeBits(code, length) {
        for (let b = 0; b < length; b++) {
            outputBits.push((code >>> b) & 1);
        }
    }

    writeBits(clearCode, curCodeSize);

    if (indices.length === 0) {
        writeBits(eoiCode, curCodeSize);
    } else {
        let prefix = indices[0];

        for (let i = 1; i < indices.length; i++) {
            const k = indices[i];
            const key = (prefix << 8) | k;

            if (dict.has(key)) {
                prefix = dict.get(key);
            } else {
                writeBits(prefix, curCodeSize);

                if (nextCode < 4096) {
                    dict.set(key, nextCode++);
                    if (nextCode > (1 << curCodeSize) && curCodeSize < 12) {
                        curCodeSize++;
                    }
                } else {
                    writeBits(clearCode, curCodeSize);
                    dict.clear();
                    curCodeSize = minCodeSize + 1;
                    nextCode = clearCode + 2;
                }

                prefix = k;
            }
        }

        writeBits(prefix, curCodeSize);
        writeBits(eoiCode, curCodeSize);
    }

    // Convert bit stream to byte array
    const rawBytes = [];
    let curByte = 0;
    let bitCount = 0;

    for (let i = 0; i < outputBits.length; i++) {
        curByte |= (outputBits[i] << bitCount);
        bitCount++;
        if (bitCount === 8) {
            rawBytes.push(curByte);
            curByte = 0;
            bitCount = 0;
        }
    }
    if (bitCount > 0) rawBytes.push(curByte);

    // Package into GIF sub-blocks (<= 255 bytes each)
    const blocks = [minCodeSize];
    let offset = 0;
    while (offset < rawBytes.length) {
        const chunkSize = Math.min(255, rawBytes.length - offset);
        blocks.push(chunkSize);
        for (let i = 0; i < chunkSize; i++) {
            blocks.push(rawBytes[offset + i]);
        }
        offset += chunkSize;
    }
    blocks.push(0); // Sub-block terminator
    return Buffer.from(blocks);
}

export function encodeGIF(frames, width, height, delayMs = 33, loopCount = 0) {
    const parts = [];

    // 1. GIF89a Header
    parts.push(Buffer.from("GIF89a", "ascii"));

    // 2. Logical Screen Descriptor (7 bytes)
    const lsd = Buffer.alloc(7);
    lsd.writeUInt16LE(width, 0);
    lsd.writeUInt16LE(height, 2);
    lsd[4] = 0xf7; // GCT Flag: 1, Color Res: 7, Sort: 0, GCT Size: 7 (256 colors)
    lsd[5] = 0x00; // Background color index
    lsd[6] = 0x00; // Pixel aspect ratio
    parts.push(lsd);

    // 3. Global Color Table (768 bytes)
    const gct = Buffer.alloc(768);
    for (let i = 0; i < 256; i++) {
        const [r, g, b] = GIF_PALETTE[i];
        gct[i * 3 + 0] = r;
        gct[i * 3 + 1] = g;
        gct[i * 3 + 2] = b;
    }
    parts.push(gct);

    // 4. Netscape 2.0 Loop Extension (Infinite Loop)
    const netscape = Buffer.from([
        0x21, 0xff, 0x0b,
        0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // NETSCAPE2.0
        0x03, 0x01,
        loopCount & 0xff, (loopCount >> 8) & 0xff,
        0x00
    ]);
    parts.push(netscape);

    // 5. Encode Each Frame
    const delayCentisecs = Math.max(1, Math.round(delayMs / 10));

    for (let f = 0; f < frames.length; f++) {
        const frameRGBA = frames[f];

        // Graphics Control Extension (8 bytes)
        const gce = Buffer.from([
            0x21, 0xf9, 0x04,
            0x00, // Packed: no transparency, do not dispose
            delayCentisecs & 0xff, (delayCentisecs >> 8) & 0xff,
            0x00, // Transparent color index
            0x00  // Block terminator
        ]);
        parts.push(gce);

        // Image Descriptor (10 bytes)
        const id = Buffer.alloc(10);
        id[0] = 0x2c; // Image separator
        id.writeUInt16LE(0, 1); // Left
        id.writeUInt16LE(0, 3); // Top
        id.writeUInt16LE(width, 5);
        id.writeUInt16LE(height, 7);
        id[9] = 0x00; // No local color table
        parts.push(id);

        // Quantize frame pixels to palette indices
        const indices = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const off = i * 4;
            indices[i] = gifColorIndex(frameRGBA[off + 0], frameRGBA[off + 1], frameRGBA[off + 2]);
        }

        // LZW Compression
        const compressedData = lzwCompress(indices, 8);
        parts.push(compressedData);
    }

    // 6. GIF Trailer
    parts.push(Buffer.from([0x3b]));

    return Buffer.concat(parts);
}

// =============================================================================
// APNG (Animated PNG) Encoder (Zero-dependency 32-bit RGBA TrueColor + Alpha)
// =============================================================================
export function encodeAPNG(frames, width, height, fps = 30, loopCount = 0) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks = [signature];

    // 1. IHDR Chunk (13 bytes)
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // 8 bits per channel
    ihdrData[9] = 6;  // Color type 6 (RGBA)
    ihdrData[10] = 0; // Compression method 0 (deflate)
    ihdrData[11] = 0; // Filter method 0
    ihdrData[12] = 0; // Interlace method 0 (no interlace)
    chunks.push(createChunk("IHDR", ihdrData));

    // 2. acTL Chunk (Animation Control - 8 bytes)
    const actlData = Buffer.alloc(8);
    actlData.writeUInt32BE(frames.length, 0); // num_frames
    actlData.writeUInt32BE(loopCount, 4);     // num_plays (0 = infinite loop)
    chunks.push(createChunk("acTL", actlData));

    const stride = width * 4;
    let sequenceNumber = 0;

    function compressScanlines(pixels) {
        const rawScanlines = Buffer.alloc(height * (stride + 1));
        for (let y = 0; y < height; y++) {
            const destOffset = y * (stride + 1);
            rawScanlines[destOffset] = 0; // Filter type 0 (None)
            const srcOffset = y * stride;
            for (let x = 0; x < stride; x++) {
                rawScanlines[destOffset + 1 + x] = pixels[srcOffset + x];
            }
        }
        return zlib.deflateSync(rawScanlines, { level: 9 });
    }

    for (let i = 0; i < frames.length; i++) {
        const framePixels = frames[i];

        // 3. fcTL Chunk (Frame Control - 26 bytes)
        const fctlData = Buffer.alloc(26);
        fctlData.writeUInt32BE(sequenceNumber++, 0); // sequence_number
        fctlData.writeUInt32BE(width, 4);            // width
        fctlData.writeUInt32BE(height, 8);           // height
        fctlData.writeUInt32BE(0, 12);               // x_offset
        fctlData.writeUInt32BE(0, 16);               // y_offset
        fctlData.writeUInt16BE(1, 20);                // delay_num (1)
        fctlData.writeUInt16BE(fps, 22);              // delay_den (e.g. 60 or 30 -> 1/60s or 1/30s)
        fctlData[24] = 0;                             // dispose_op (0: none, 1: background)
        fctlData[25] = 0;                             // blend_op (0: source overwrite)
        chunks.push(createChunk("fcTL", fctlData));

        const compressed = compressScanlines(framePixels);

        if (i === 0) {
            // Frame 0 uses standard IDAT chunk
            chunks.push(createChunk("IDAT", compressed));
        } else {
            // Subsequent frames use fdAT chunk: 4-byte sequence_number + compressed data
            const fdatData = Buffer.alloc(4 + compressed.length);
            fdatData.writeUInt32BE(sequenceNumber++, 0);
            compressed.copy(fdatData, 4);
            chunks.push(createChunk("fdAT", fdatData));
        }
    }

    // 4. IEND Chunk
    chunks.push(createChunk("IEND", Buffer.alloc(0)));

    return Buffer.concat(chunks);
}

// =============================================================================
// Unified Image Loader & Exporter
// =============================================================================
export function loadImageFile(filePath) {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".png" || (buf[0] === 0x89 && buf[1] === 0x50)) {
        return decodePNG(buf);
    } else if (ext === ".bmp" || (buf[0] === 0x42 && buf[1] === 0x4d)) {
        return decodeBMP(buf);
    }
    throw new Error(`Unsupported image format for: ${filePath}. Supported: PNG, BMP.`);
}

export function saveImageFile(filePath, pixelsOrFrames, width, height, options = {}) {
    const ext = path.extname(filePath).toLowerCase();
    let buf;

    if (ext === ".apng" || (options.isApng && Array.isArray(pixelsOrFrames))) {
        const frames = Array.isArray(pixelsOrFrames) ? pixelsOrFrames : [pixelsOrFrames];
        const fps = options.fps || 30;
        buf = encodeAPNG(frames, width, height, fps, 0);
    } else if (ext === ".gif" || (Array.isArray(pixelsOrFrames) && !options.isPng)) {
        const frames = Array.isArray(pixelsOrFrames) ? pixelsOrFrames : [pixelsOrFrames];
        const fps = options.fps || 30;
        const delayMs = Math.round(1000 / fps);
        buf = encodeGIF(frames, width, height, delayMs, 0);
    } else if (ext === ".bmp") {
        buf = encodeBMP(pixelsOrFrames, width, height);
    } else {
        // Default to PNG
        buf = encodePNG(pixelsOrFrames, width, height);
    }
    fs.writeFileSync(filePath, buf);
    return filePath;
}
