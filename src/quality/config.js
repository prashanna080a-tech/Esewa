export const DEFAULT_CONFIG = {
  analysis: {
    maxWidth: 960,
    maxHeight: 720,
    fps: 8,
  },
  resolution: {
    minWidth: 480,
    minHeight: 300,
  },
  blur: {
    failVariance: 0.012,
    passVariance: 0.06,
  },
  glare: {
    brightLuma: 0.97,
    lowSaturation: 0.22,
    warnRatio: 0.025,
    failRatio: 0.05,
    downsample: 4,
    warnClusterRatio: 0.012,
    failClusterRatio: 0.02,
    backgroundIgnoreRatio: 0.45,
  },
  exposure: {
    warnLowMean: 0.3,
    warnHighMean: 0.75,
    failLowMean: 0.24,
    failHighMean: 0.82,
  },
  contrast: {
    warnRange: 0.23,
    failRange: 0.16,
  },
  framing: {
    edgeThresholdRatio: 0.22,
    passMargin: 0.065,
    warnMargin: 0.035,
    minFill: 0.42,
    maxFill: 0.96,
    minAspect: 1.2,
    maxAspect: 2.2,
  },
  skew: {
    passDegrees: 4,
    failDegrees: 10,
  },
  stability: {
    requiredPasses: 3,
    maxAgeMs: 1200,
  },
  crop: {
    paddingRatio: 0.02,
  },
  weights: {
    blur: 1.3,
    glare: 1.2,
    framing: 1.35,
    resolution: 0.9,
    exposure: 1,
    contrast: 0.9,
    skew: 0.75,
  },
};
