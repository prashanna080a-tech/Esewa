import assert from "node:assert/strict";
import { analyzeFrame } from "../src/quality/analyzer.js";
import { DEFAULT_CONFIG } from "../src/quality/config.js";

function makeFrame(width, height, pixelFn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = pixelFn(x, y);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a ?? 255;
    }
  }
  return { width, height, data, timestamp: Date.now() };
}

function blurFrame(frame, radius = 2) {
  const { width, height, data } = frame;
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          const offset = (sy * width + sx) * 4;
          sumR += data[offset];
          sumG += data[offset + 1];
          sumB += data[offset + 2];
          count += 1;
        }
      }
      const outOffset = (y * width + x) * 4;
      out[outOffset] = Math.round(sumR / count);
      out[outOffset + 1] = Math.round(sumG / count);
      out[outOffset + 2] = Math.round(sumB / count);
      out[outOffset + 3] = 255;
    }
  }

  return { width, height, data: out, timestamp: frame.timestamp };
}

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const baseConfig = {
  ...DEFAULT_CONFIG,
  stability: { requiredPasses: 1, maxAgeMs: 2000 },
};

run("fails resolution below minimum", () => {
  const frame = makeFrame(200, 160, () => [180, 180, 180, 255]);
  const report = analyzeFrame(frame, { config: baseConfig });
  assert.equal(report.checks.find((c) => c.id === "resolution").status, "fail");
  assert.equal(report.status, "fail");
});

run("passes blur on sharp pattern and fails on blurred", () => {
  const frame = makeFrame(640, 420, (x, y) => {
    const tile = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 255;
    return [tile, tile, tile, 255];
  });
  const sharpReport = analyzeFrame(frame, { config: baseConfig });
  assert.notEqual(sharpReport.checks.find((c) => c.id === "blur").status, "fail");

  const blurredReport = analyzeFrame(blurFrame(frame, 4), { config: baseConfig });
  assert.equal(blurredReport.checks.find((c) => c.id === "blur").status, "fail");
});

run("fails glare when bright low-sat hotspot dominates", () => {
  const frame = makeFrame(640, 420, (x, y) => {
    const base = 150;
    const inHotspot = x > 200 && x < 460 && y > 120 && y < 300;
    const value = inHotspot ? 255 : base;
    return [value, value, value, 255];
  });
  const report = analyzeFrame(frame, { config: baseConfig });
  assert.equal(report.checks.find((c) => c.id === "glare").status, "fail");
});

run("fails exposure on very dark frame", () => {
  const frame = makeFrame(640, 420, () => [10, 10, 10, 255]);
  const report = analyzeFrame(frame, { config: baseConfig });
  assert.equal(report.checks.find((c) => c.id === "exposure").status, "fail");
});

run("fails contrast on nearly flat frame", () => {
  const frame = makeFrame(640, 420, (x) => {
    const value = 128 + (x % 2);
    return [value, value, value, 255];
  });
  const report = analyzeFrame(frame, { config: baseConfig });
  assert.equal(report.checks.find((c) => c.id === "contrast").status, "fail");
});

run("warns framing when content is cropped near edge", () => {
  const frame = makeFrame(640, 420, (x, y) => {
    const border = x < 5 || y < 5 || x > 635 || y > 415;
    const value = border ? 255 : 80;
    return [value, value, value, 255];
  });
  const report = analyzeFrame(frame, { config: baseConfig });
  const framing = report.checks.find((c) => c.id === "framing").status;
  assert.ok(framing === "warn" || framing === "fail");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

