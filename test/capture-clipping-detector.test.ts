import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/capture-clipping/july28-prefix-regressions.json";
import {
  CAPTURE_PREFIX_MARKERS,
  decodePng,
  inspectCaptureFrame,
  inspectCaptureManifest,
  type CaptureFrameContract,
  type CaptureMarkerProbe,
  type CapturePrefixKind,
  type RgbImage,
} from "../src/capture/clipping-detector.ts";

const WIDTH = 24;
const HEIGHT = 14;
const TITLE = { kind: "title-prefix" as const, x: 2, y: 2 };
const SECONDARY = { kind: "secondary-prefix" as const, x: 2, y: 8 };

describe("capture clipping detector (#57)", () => {
  for (const frame of fixture.affected) {
    it(`fails closed for July-28 affected frame ${frame.png}`, () => {
      const image = markedImage(new Set(frame.lost as CapturePrefixKind[]));
      const result = inspectCaptureFrame(image, contract(frame.png));
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        "title-prefix: 9/9 sentinel pixels missing",
        "secondary-prefix: 9/9 sentinel pixels missing",
      ]);
    });
  }

  for (const frame of fixture.trueNegatives) {
    it(`accepts intact true-negative frame ${frame.png}`, () => {
      const result = inspectCaptureFrame(markedImage(new Set()), contract(frame.png));
      expect(result).toEqual({ png: frame.png, ok: true, errors: [] });
    });
  }

  it("fails closed when a required prefix marker contract is omitted", () => {
    const incomplete = contract("missing-secondary.png");
    incomplete.probes.pop();
    expect(inspectCaptureFrame(markedImage(new Set()), incomplete).errors).toContain(
      "secondary-prefix: marker contract missing",
    );
  });

  it("fails closed when marker geometry points outside the screenshot", () => {
    const invalid = contract("out-of-bounds.png");
    invalid.probes[0].x = WIDTH;
    expect(inspectCaptureFrame(markedImage(new Set()), invalid).errors).toContain(
      "title-prefix: marker lies outside captured pixels",
    );
  });

  it("rejects a manifest that weakens the fixed marker contract", () => {
    const weakened = contract("weakened.png");
    weakened.probes[0].size = 2;
    weakened.probes[1].rgb = [17, 17, 17];
    expect(inspectCaptureFrame(markedImage(new Set()), weakened).errors).toEqual([
      "title-prefix: marker size must be 3",
      "secondary-prefix: marker color does not match the capture contract",
    ]);
  });

  it("rejects duplicate markers instead of accepting an ambiguous contract", () => {
    const duplicated = contract("duplicated.png");
    duplicated.probes.push({ ...duplicated.probes[0] });
    expect(inspectCaptureFrame(markedImage(new Set()), duplicated).errors).toContain(
      "title-prefix: expected exactly one marker contract, found 2",
    );
  });

  it("rejects an unknown third runtime probe kind", () => {
    const unknown = contract("unknown-kind.png");
    unknown.probes.push({
      ...unknown.probes[1],
      kind: "unexpected-prefix",
    } as unknown as CaptureMarkerProbe);
    expect(inspectCaptureFrame(markedImage(new Set()), unknown).errors).toEqual([
      "expected exactly 2 marker contracts, found 3",
      "unknown marker kind 'unexpected-prefix'",
    ]);
  });

  it("decodes Chromium-style 8-bit RGB PNG pixels before checking markers", () => {
    const expected = markedImage(new Set());
    const decoded = decodePng(encodeRgbPng(expected));
    expect(decoded).toEqual(expected);
    expect(inspectCaptureFrame(decoded, contract("encoded.png")).ok).toBe(true);
  });

  it("rejects transparent RGBA sentinels even when their hidden RGB matches", () => {
    const expected = markedImage(new Set());
    const decoded = decodePng(encodeRgbaPng(expected, new Set([TITLE.kind])));
    expect(decoded.alpha).toBeDefined();
    expect(inspectCaptureFrame(decoded, contract("transparent-title.png")).errors).toEqual([
      "title-prefix: 9/9 sentinel pixels missing",
    ]);
  });

  it("rejects malformed PNG bytes instead of assuming unclipped", () => {
    expect(() => decodePng(Uint8Array.of(1, 2, 3))).toThrow(
      "invalid PNG signature",
    );
  });

  it("checks final PNG files through the manifest seam", () => {
    const root = mkdtempSync(join(tmpdir(), "memex-capture-clipping-"));
    writeFileSync(join(root, "intact.png"), encodeRgbPng(markedImage(new Set())));
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ frames: [contract("intact.png")] }),
    );
    expect(inspectCaptureManifest(join(root, "manifest.json"))).toEqual({
      ok: true,
      frames: [{ png: "intact.png", ok: true, errors: [] }],
    });
  });

  it("fails closed when a manifest names an unreadable PNG", () => {
    const root = mkdtempSync(join(tmpdir(), "memex-capture-clipping-"));
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ frames: [contract("missing.png")] }),
    );
    const report = inspectCaptureManifest(join(root, "manifest.json"));
    expect(report.ok).toBe(false);
    expect(report.frames[0].errors[0]).toMatch(/^PNG unreadable:/);
  });
});

function contract(png: string): CaptureFrameContract {
  return {
    png,
    probes: [
      {
        ...TITLE,
        size: fixture.markerSize,
        rgb: CAPTURE_PREFIX_MARKERS.title,
      },
      {
        ...SECONDARY,
        size: fixture.markerSize,
        rgb: CAPTURE_PREFIX_MARKERS.secondary,
      },
    ],
  };
}

function markedImage(lost: Set<CapturePrefixKind>): RgbImage {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 3).fill(17);
  if (!lost.has(TITLE.kind)) {
    paint(pixels, TITLE.x, TITLE.y, fixture.markerSize, CAPTURE_PREFIX_MARKERS.title);
  }
  if (!lost.has(SECONDARY.kind)) {
    paint(
      pixels,
      SECONDARY.x,
      SECONDARY.y,
      fixture.markerSize,
      CAPTURE_PREFIX_MARKERS.secondary,
    );
  }
  return { width: WIDTH, height: HEIGHT, pixels };
}

function paint(
  pixels: Uint8Array,
  startX: number,
  startY: number,
  size: number,
  rgb: readonly [number, number, number],
): void {
  for (let y = startY; y < startY + size; y += 1) {
    for (let x = startX; x < startX + size; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      pixels.set(rgb, offset);
    }
  }
}

function encodeRgbPng(image: RgbImage): Uint8Array {
  const rows = Buffer.alloc(image.height * (image.width * 3 + 1));
  for (let y = 0; y < image.height; y += 1) {
    const row = y * (image.width * 3 + 1);
    rows[row] = 0;
    rows.set(
      image.pixels.subarray(y * image.width * 3, (y + 1) * image.width * 3),
      row + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeRgbaPng(
  image: RgbImage,
  transparent: Set<CapturePrefixKind>,
): Uint8Array {
  const rows = Buffer.alloc(image.height * (image.width * 4 + 1));
  for (let y = 0; y < image.height; y += 1) {
    const row = y * (image.width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 3;
      const target = row + 1 + x * 4;
      rows[target] = image.pixels[source];
      rows[target + 1] = image.pixels[source + 1];
      rows[target + 2] = image.pixels[source + 2];
      rows[target + 3] =
        (transparent.has(TITLE.kind) && insideMarker(x, y, TITLE)) ||
        (transparent.has(SECONDARY.kind) && insideMarker(x, y, SECONDARY))
          ? 0
          : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideMarker(
  x: number,
  y: number,
  marker: { x: number; y: number },
): boolean {
  return (
    x >= marker.x &&
    x < marker.x + fixture.markerSize &&
    y >= marker.y &&
    y < marker.y + fixture.markerSize
  );
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 4, "ascii");
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, body.length + 8)), body.length + 8);
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
