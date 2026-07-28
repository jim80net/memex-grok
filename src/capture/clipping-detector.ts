import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

export type CapturePrefixKind = "title-prefix" | "secondary-prefix";

export interface CaptureMarkerProbe {
  kind: CapturePrefixKind;
  x: number;
  y: number;
  size: number;
  rgb: readonly [number, number, number];
}

export interface CaptureFrameContract {
  png: string;
  probes: CaptureMarkerProbe[];
}

export interface CaptureClippingManifest {
  frames: CaptureFrameContract[];
}

export interface CaptureFrameFinding {
  png: string;
  ok: boolean;
  errors: string[];
}

export interface CaptureClippingReport {
  ok: boolean;
  frames: CaptureFrameFinding[];
}

export interface RgbImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Sentinel colors are intentionally loud and stable under Chromium screenshots.
 * Renderers place the solid squares immediately before capture-chrome prefixes;
 * the detector validates the final PNG bytes, not DOM geometry.
 */
export const CAPTURE_PREFIX_MARKERS = {
  title: [255, 0, 255] as const,
  secondary: [0, 255, 255] as const,
};
export const CAPTURE_PREFIX_MARKER_SIZE = 3;

export function inspectCaptureFrame(
  image: RgbImage,
  contract: CaptureFrameContract,
): CaptureFrameFinding {
  const errors: string[] = [];
  const expectedKinds = new Set<CapturePrefixKind>([
    "title-prefix",
    "secondary-prefix",
  ]);
  const kindCounts = new Map<CapturePrefixKind, number>();
  for (const probe of contract.probes) {
    kindCounts.set(probe.kind, (kindCounts.get(probe.kind) ?? 0) + 1);
  }

  for (const kind of expectedKinds) {
    const count = kindCounts.get(kind) ?? 0;
    if (count === 0) {
      errors.push(`${kind}: marker contract missing`);
    } else if (count !== 1) {
      errors.push(`${kind}: expected exactly one marker contract, found ${count}`);
    }
  }

  for (const probe of contract.probes) {
    if (!Number.isInteger(probe.x) || !Number.isInteger(probe.y)) {
      errors.push(`${probe.kind}: marker coordinates must be integers`);
      continue;
    }
    if (probe.size !== CAPTURE_PREFIX_MARKER_SIZE) {
      errors.push(
        `${probe.kind}: marker size must be ${CAPTURE_PREFIX_MARKER_SIZE}`,
      );
      continue;
    }
    const expectedRgb =
      probe.kind === "title-prefix"
        ? CAPTURE_PREFIX_MARKERS.title
        : CAPTURE_PREFIX_MARKERS.secondary;
    if (!sameRgb(probe.rgb, expectedRgb)) {
      errors.push(`${probe.kind}: marker color does not match the capture contract`);
      continue;
    }
    if (
      probe.x < 0 ||
      probe.y < 0 ||
      probe.x + probe.size > image.width ||
      probe.y + probe.size > image.height
    ) {
      errors.push(`${probe.kind}: marker lies outside captured pixels`);
      continue;
    }
    const mismatches = countMarkerMismatches(image, probe);
    if (mismatches > 0) {
      errors.push(
        `${probe.kind}: ${mismatches}/${probe.size * probe.size} sentinel pixels missing`,
      );
    }
  }

  return { png: contract.png, ok: errors.length === 0, errors };
}

export function inspectCaptureManifest(
  manifestPath: string,
): CaptureClippingReport {
  let manifest: CaptureClippingManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CaptureClippingManifest;
  } catch (error) {
    return failedReport(
      manifestPath,
      `manifest unreadable: ${formatError(error)}`,
    );
  }
  if (!manifest || !Array.isArray(manifest.frames) || manifest.frames.length === 0) {
    return failedReport(manifestPath, "manifest must contain at least one frame");
  }

  const root = dirname(resolve(manifestPath));
  const frames = manifest.frames.map((contract) => {
    if (!contract || typeof contract.png !== "string" || !Array.isArray(contract.probes)) {
      return {
        png: contract?.png ?? "<unknown>",
        ok: false,
        errors: ["invalid frame contract"],
      };
    }
    try {
      const image = decodePng(readFileSync(resolve(root, contract.png)));
      return inspectCaptureFrame(image, contract);
    } catch (error) {
      return {
        png: contract.png,
        ok: false,
        errors: [`PNG unreadable: ${formatError(error)}`],
      };
    }
  });
  return { ok: frames.every((frame) => frame.ok), frames };
}

export function decodePng(data: Uint8Array): RgbImage {
  if (
    data.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((byte, index) => data[index] === byte)
  ) {
    throw new Error("invalid PNG signature");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idat: Uint8Array[] = [];

  while (offset + 12 <= data.length) {
    const length = readUint32(data, offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + length;
    if (bodyEnd + 4 > data.length) throw new Error("truncated PNG chunk");
    const body = data.subarray(bodyStart, bodyEnd);
    if (type === "IHDR") {
      if (body.length !== 13) throw new Error("invalid IHDR length");
      width = readUint32(body, 0);
      height = readUint32(body, 4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset = bodyEnd + 4;
  }

  if (width < 1 || height < 1) throw new Error("missing or invalid IHDR");
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(
      `unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`,
    );
  }
  if (idat.length === 0) throw new Error("PNG has no IDAT data");

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const compressed = Buffer.concat(idat.map((chunk) => Buffer.from(chunk)));
  const raw = inflateSync(compressed);
  const expectedLength = height * (rowBytes + 1);
  if (raw.length !== expectedLength) {
    throw new Error(`unexpected pixel data length ${raw.length}, expected ${expectedLength}`);
  }

  const unfiltered = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (rowBytes + 1);
    const filter = raw[sourceOffset];
    const targetOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const source = raw[sourceOffset + 1 + x];
      const left = x >= bytesPerPixel ? unfiltered[targetOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? unfiltered[targetOffset - rowBytes + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? unfiltered[targetOffset - rowBytes + x - bytesPerPixel]
          : 0;
      unfiltered[targetOffset + x] = unfilterByte(
        filter,
        source,
        left,
        up,
        upperLeft,
      );
    }
  }

  const pixels = new Uint8Array(width * height * 3);
  for (let source = 0, target = 0; source < unfiltered.length; source += bytesPerPixel) {
    pixels[target++] = unfiltered[source];
    pixels[target++] = unfiltered[source + 1];
    pixels[target++] = unfiltered[source + 2];
  }
  return { width, height, pixels };
}

function countMarkerMismatches(
  image: RgbImage,
  probe: CaptureMarkerProbe,
): number {
  let mismatches = 0;
  for (let y = probe.y; y < probe.y + probe.size; y += 1) {
    for (let x = probe.x; x < probe.x + probe.size; x += 1) {
      const offset = (y * image.width + x) * 3;
      if (
        image.pixels[offset] !== probe.rgb[0] ||
        image.pixels[offset + 1] !== probe.rgb[1] ||
        image.pixels[offset + 2] !== probe.rgb[2]
      ) {
        mismatches += 1;
      }
    }
  }
  return mismatches;
}

function sameRgb(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
): boolean {
  return actual.every((component, index) => component === expected[index]);
}

function unfilterByte(
  filter: number,
  source: number,
  left: number,
  up: number,
  upperLeft: number,
): number {
  switch (filter) {
    case 0:
      return source;
    case 1:
      return (source + left) & 0xff;
    case 2:
      return (source + up) & 0xff;
    case 3:
      return (source + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (source + paeth(left, up, upperLeft)) & 0xff;
    default:
      throw new Error(`unsupported PNG filter ${filter}`);
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    data[offset] * 0x1000000 +
    data[offset + 1] * 0x10000 +
    data[offset + 2] * 0x100 +
    data[offset + 3]
  );
}

function failedReport(png: string, error: string): CaptureClippingReport {
  return { ok: false, frames: [{ png, ok: false, errors: [error] }] };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
