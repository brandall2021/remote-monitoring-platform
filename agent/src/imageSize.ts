export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.readUInt32BE(12) !== 0x49484452) return null;

  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;

    let markerOffset = offset;
    while (markerOffset < buffer.length && buffer[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= buffer.length) return null;

    const marker = buffer[markerOffset];
    markerOffset += 1;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;

    if (markerOffset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(markerOffset);
    if (segmentLength < 2) return null;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (markerOffset + 7 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(markerOffset + 3),
        width: buffer.readUInt16BE(markerOffset + 5),
      };
    }

    offset = markerOffset + segmentLength;
  }

  return null;
}

export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  return readPngDimensions(buffer) || readJpegDimensions(buffer);
}
