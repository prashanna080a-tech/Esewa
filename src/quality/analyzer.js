import {
  clamp,
  dominantGradientAngleRadians,
  largestConnectedComponentRatio,
  luminanceFromRGBA,
  percentile,
  saturationFromRGBA,
  sobelMagnitude,
  variance,
} from "./utils.js";
import { DEFAULT_CONFIG } from "./config.js";

function checkStatus(metric, thresholds) {
  if (thresholds.failLower != null && metric < thresholds.failLower) return "fail";
  if (thresholds.failUpper != null && metric > thresholds.failUpper) return "fail";
  if (thresholds.warnLower != null && metric < thresholds.warnLower) return "warn";
  if (thresholds.warnUpper != null && metric > thresholds.warnUpper) return "warn";
  return "pass";
}

function statusScore(status) {
  if (status === "pass") return 1;
  if (status === "warn") return 0.6;
  return 0.2;
}

function summarizeOverallStatus(checks) {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function pickGuidance(checks) {
  const priority = [
    "resolution",
    "framing",
    "blur",
    "glare",
    "exposure",
    "contrast",
    "skew",
  ];
  for (const id of priority) {
    const failed = checks.find((check) => check.id === id && check.status === "fail");
    if (failed) return failed.message;
  }
  for (const id of priority) {
    const warning = checks.find((check) => check.id === id && check.status === "warn");
    if (warning) return warning.message;
  }
  return "Capture looks good. Hold steady and capture when ready.";
}

function computeLumaAndStats(frame) {
  const { width, height, data } = frame;
  const luma = new Float32Array(width * height);
  let sum = 0;

  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
    const value = luminanceFromRGBA(data, p);
    luma[i] = value;
    sum += value;
  }

  const meanLuma = sum / luma.length;
  const sorted = Array.from(luma);
  sorted.sort((a, b) => a - b);
  const p05 = percentile(sorted, 0.05);
  const p95 = percentile(sorted, 0.95);

  return { luma, meanLuma, p05, p95, sortedLuma: sorted };
}

function detectDocumentBounds(luma, width, height, framingConfig) {
  const { magnitudes, maxMagnitude } = sobelMagnitude(luma, width, height);
  if (!maxMagnitude) {
    return { x: 0, y: 0, width, height, edgeCoverage: 0, fill: 1, aspect: width / height, fallback: true };
  }

  const threshold = maxMagnitude * framingConfig.edgeThresholdRatio;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (magnitudes[index] < threshold) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (count < width * height * 0.005 || maxX < minX || maxY < minY) {
    return {
      x: 0,
      y: 0,
      width,
      height,
      edgeCoverage: count / (width * height),
      fill: 1,
      aspect: width / height,
      fallback: true,
    };
  }

  const boxWidth = Math.max(1, maxX - minX + 1);
  const boxHeight = Math.max(1, maxY - minY + 1);
  const fill = (boxWidth * boxHeight) / (width * height);
  return {
    x: minX,
    y: minY,
    width: boxWidth,
    height: boxHeight,
    edgeCoverage: count / (width * height),
    fill,
    aspect: boxWidth / boxHeight,
    fallback: false,
  };
}

function computeLaplacianVariance(luma, width, height) {
  const responses = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const center = luma[index];
      const value =
        -4 * center +
        luma[index - 1] +
        luma[index + 1] +
        luma[index - width] +
        luma[index + width];
      responses.push(value);
    }
  }
  return variance(responses);
}

function computeGlareMetrics(frame, glareConfig) {
  const { width, height, data } = frame;
  const step = glareConfig.downsample;
  const reducedWidth = Math.max(1, Math.floor(width / step));
  const reducedHeight = Math.max(1, Math.floor(height / step));
  const mask = new Uint8Array(reducedWidth * reducedHeight);
  let brightCount = 0;

  for (let ry = 0; ry < reducedHeight; ry += 1) {
    for (let rx = 0; rx < reducedWidth; rx += 1) {
      const x = rx * step;
      const y = ry * step;
      const offset = (y * width + x) * 4;
      const luma = luminanceFromRGBA(data, offset);
      if (luma < glareConfig.brightLuma) continue;
      const sat = saturationFromRGBA(data, offset);
      if (sat > glareConfig.lowSaturation) continue;
      const idx = ry * reducedWidth + rx;
      mask[idx] = 1;
      brightCount += 1;
    }
  }

  const ratio = brightCount / mask.length;
  const clusterRatio = brightCount ? largestConnectedComponentRatio(mask, reducedWidth, reducedHeight) : 0;
  return { ratio, clusterRatio };
}

function computeSkewDegrees(luma, width, height) {
  const angle = dominantGradientAngleRadians(luma, width, height, 2);
  if (angle == null) return 0;
  const degrees = (angle * 180) / Math.PI;
  return Math.min(45, Math.abs(degrees));
}

function computeScore(checks, weights) {
  let totalWeight = 0;
  let total = 0;
  for (const check of checks) {
    const weight = weights[check.id] ?? 1;
    totalWeight += weight;
    total += weight * check.score;
  }
  if (!totalWeight) return 0;
  return total / totalWeight;
}

export function analyzeFrame(frameInput, options = {}) {
  const config = options.config ?? DEFAULT_CONFIG;
  const template = options.template ?? null;
  const capturedAt = frameInput.timestamp ?? Date.now();
  const checks = [];

  const { width, height, data } = frameInput;
  if (!width || !height || !data || data.length !== width * height * 4) {
    return {
      status: "fail",
      score: 0,
      checks: [
        {
          id: "frame",
          label: "Frame",
          status: "fail",
          score: 0,
          metric: 0,
          threshold: 0,
          message: "Invalid frame input.",
        },
      ],
      guidance: "Upload or capture a valid image frame.",
      documentBounds: null,
      crop: null,
      capturedAt,
    };
  }

  const { luma, meanLuma, p05, p95 } = computeLumaAndStats(frameInput);

  const resolutionStatus =
    width < config.resolution.minWidth || height < config.resolution.minHeight ? "fail" : "pass";
  checks.push({
    id: "resolution",
    label: "Resolution",
    status: resolutionStatus,
    score: resolutionStatus === "pass" ? 1 : 0.2,
    metric: Math.min(width / config.resolution.minWidth, height / config.resolution.minHeight),
    threshold: 1,
    message:
      resolutionStatus === "pass"
        ? "Resolution meets minimum for analysis."
        : "Move closer or use a higher-resolution capture.",
  });

  const exposureStatus = checkStatus(meanLuma, {
    failLower: config.exposure.failLowMean,
    warnLower: config.exposure.warnLowMean,
    warnUpper: config.exposure.warnHighMean,
    failUpper: config.exposure.failHighMean,
  });
  checks.push({
    id: "exposure",
    label: "Exposure",
    status: exposureStatus,
    score: statusScore(exposureStatus),
    metric: meanLuma,
    threshold: { low: config.exposure.warnLowMean, high: config.exposure.warnHighMean },
    message:
      exposureStatus === "fail"
        ? meanLuma < config.exposure.failLowMean
          ? "Image is too dark. Add light or avoid shadows."
          : "Image is too bright. Reduce glare and avoid overexposure."
        : exposureStatus === "warn"
          ? meanLuma < config.exposure.warnLowMean
            ? "Image is slightly dark. Add more light."
            : "Image is slightly bright. Tilt to avoid hotspots."
          : "Exposure is within the target range.",
  });

  const contrastRange = p95 - p05;
  const contrastStatus = checkStatus(contrastRange, {
    failLower: config.contrast.failRange,
    warnLower: config.contrast.warnRange,
  });
  checks.push({
    id: "contrast",
    label: "Contrast",
    status: contrastStatus,
    score: statusScore(contrastStatus),
    metric: contrastRange,
    threshold: config.contrast.warnRange,
    message:
      contrastStatus === "pass"
        ? "Contrast is sufficient to read details."
        : contrastStatus === "warn"
          ? "Contrast is low. Avoid reflections and improve lighting."
          : "Contrast is too low. Move to even lighting and retry.",
  });

  const blurVariance = computeLaplacianVariance(luma, width, height);
  const blurStatus = checkStatus(blurVariance, {
    failLower: config.blur.failVariance,
    warnLower: config.blur.passVariance,
  });
  checks.push({
    id: "blur",
    label: "Blur",
    status: blurStatus,
    score: statusScore(blurStatus),
    metric: blurVariance,
    threshold: config.blur.passVariance,
    message:
      blurStatus === "pass"
        ? "Text edges look sharp."
        : blurStatus === "warn"
          ? "Image is slightly soft. Hold steady and tap to focus."
          : "Image is blurry. Hold the camera steady and retry.",
  });

  const glareMetrics = computeGlareMetrics(frameInput, config.glare);
  const glareLikelyBackground = glareMetrics.ratio > config.glare.backgroundIgnoreRatio;
  const glareStatus = glareLikelyBackground
    ? "warn"
    : checkStatus(glareMetrics.ratio, {
        failUpper: config.glare.failRatio,
        warnUpper: config.glare.warnRatio,
      });
  const glareClusterStatus = glareLikelyBackground
    ? "warn"
    : checkStatus(glareMetrics.clusterRatio, {
        failUpper: config.glare.failClusterRatio,
        warnUpper: config.glare.warnClusterRatio,
      });
  const glareCombinedStatus = glareLikelyBackground
    ? "warn"
    : glareStatus === "fail" || glareClusterStatus === "fail"
      ? "fail"
      : glareStatus === "warn" || glareClusterStatus === "warn"
        ? "warn"
        : "pass";
  checks.push({
    id: "glare",
    label: "Glare",
    status: glareCombinedStatus,
    score: statusScore(glareCombinedStatus),
    metric: { ratio: glareMetrics.ratio, clusterRatio: glareMetrics.clusterRatio },
    threshold: { ratio: config.glare.warnRatio, clusterRatio: config.glare.warnClusterRatio },
    message:
      glareLikelyBackground
        ? "Very bright regions detected. Reduce lighting or angle the document to avoid washout."
        : glareCombinedStatus === "pass"
        ? "No strong glare detected."
        : glareCombinedStatus === "warn"
          ? "Some glare detected. Tilt the document or move away from light sources."
          : "Strong glare detected. Tilt away from lights and retry.",
  });

  const bounds = detectDocumentBounds(luma, width, height, config.framing);
  const marginLeft = bounds.x / width;
  const marginTop = bounds.y / height;
  const marginRight = (width - (bounds.x + bounds.width)) / width;
  const marginBottom = (height - (bounds.y + bounds.height)) / height;
  const minMargin = Math.min(marginLeft, marginTop, marginRight, marginBottom);
  let framingStatus = bounds.fallback
    ? "warn"
    : checkStatus(minMargin, {
        failLower: config.framing.warnMargin,
        warnLower: config.framing.passMargin,
      });

  if (bounds.fill < config.framing.minFill || bounds.fill > config.framing.maxFill) {
    framingStatus = "warn";
  }

  if (bounds.aspect < config.framing.minAspect || bounds.aspect > config.framing.maxAspect) {
    framingStatus = "warn";
  }

  if (template?.expectedAspect?.min != null && template?.expectedAspect?.max != null) {
    if (bounds.aspect < template.expectedAspect.min || bounds.aspect > template.expectedAspect.max) {
      framingStatus = "warn";
    }
  }

  checks.push({
    id: "framing",
    label: "Framing",
    status: framingStatus,
    score: statusScore(framingStatus),
    metric: { fill: bounds.fill, margin: minMargin, aspect: bounds.aspect },
    threshold: { fill: [config.framing.minFill, config.framing.maxFill], margin: config.framing.passMargin },
    message:
      bounds.fallback
        ? "No clear document edges detected. Place the document inside the guide frame."
        : framingStatus === "pass"
        ? "Document is centered with visible borders."
        : framingStatus === "warn"
          ? "Reframe the document: keep all edges visible inside the guide."
          : "Document is cropped. Move it fully inside the frame.",
  });

  const skewDegrees = computeSkewDegrees(luma, width, height);
  const skewStatus = checkStatus(skewDegrees, {
    failUpper: config.skew.failDegrees,
    warnUpper: config.skew.passDegrees,
  });
  checks.push({
    id: "skew",
    label: "Alignment",
    status: skewStatus,
    score: statusScore(skewStatus),
    metric: skewDegrees,
    threshold: config.skew.passDegrees,
    message:
      skewStatus === "pass"
        ? "Document is aligned."
        : skewStatus === "warn"
          ? "Slight tilt detected. Align the document edges with the guide."
          : "Document is tilted. Align with the guide and retry.",
  });

  const score = computeScore(
    checks.map((check) => ({ ...check, score: check.score })),
    config.weights,
  );
  const status = summarizeOverallStatus(checks);
  const guidance = pickGuidance(checks);

  const padding = Math.round(Math.min(width, height) * config.crop.paddingRatio);
  const cropX = clamp(bounds.x - padding, 0, width - 1);
  const cropY = clamp(bounds.y - padding, 0, height - 1);
  const cropWidth = clamp(bounds.width + padding * 2, 1, width - cropX);
  const cropHeight = clamp(bounds.height + padding * 2, 1, height - cropY);

  return {
    status,
    score,
    checks,
    guidance,
    documentBounds: bounds,
    crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
    capturedAt,
  };
}
