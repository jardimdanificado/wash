export function _start(
  pixels: usize,
  width: u32,
  height: u32,
  time: f32,
  startX: u32,
  startY: u32,
  endX: u32,
  endY: u32
): void {
  const cRe: f32 = <f32>Math.cos(time * 0.45) * 0.7885;
  const cIm: f32 = <f32>Math.sin(time * 0.45) * 0.7885;
  const maxIter: u32 = 40;

  const invW: f32 = 1.0 / <f32>width;
  const invH: f32 = 1.0 / <f32>height;

  for (let y: u32 = startY; y < endY; ++y) {
    const ny: f32 = (<f32>y * invH * 2.4) - 1.2;
    for (let x: u32 = startX; x < endX; ++x) {
      const nx: f32 = (<f32>x * invW * 2.4) - 1.2;

      let zRe: f32 = nx;
      let zIm: f32 = ny;
      let iter: u32 = 0;

      while (iter < maxIter && (zRe * zRe + zIm * zIm) < 4.0) {
        const nextRe: f32 = zRe * zRe - zIm * zIm + cRe;
        const nextIm: f32 = 2.0 * zRe * zIm + cIm;
        zRe = nextRe;
        zIm = nextIm;
        iter++;
      }

      const idx: usize = pixels + ((y * width + x) << 2);
      if (iter == maxIter) {
        store<u8>(idx + 0, 8);
        store<u8>(idx + 1, 14);
        store<u8>(idx + 2, 28);
        store<u8>(idx + 3, 255);
      } else {
        const t: f32 = <f32>iter / <f32>maxIter;
        const r: u8 = <u8>(Math.sin(t * 6.28 + 0.0) * 110.0 + 135.0);
        const g: u8 = <u8>(Math.sin(t * 6.28 + 2.0) * 120.0 + 130.0);
        const b: u8 = <u8>(Math.sin(t * 6.28 + 4.0) * 100.0 + 155.0);
        store<u8>(idx + 0, r);
        store<u8>(idx + 1, g);
        store<u8>(idx + 2, b);
        store<u8>(idx + 3, 255);
      }
    }
  }
}
