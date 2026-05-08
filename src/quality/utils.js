export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function luminanceFromRGBA(data, offset) {
  const red = data[offset] / 255;
  const green = data[offset + 1] / 255;
  const blue = data[offset + 2] / 255;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function saturationFromRGBA(data, offset) {
  const red = data[offset] / 255;
  const green = data[offset + 1] / 255;
  const blue = data[offset + 2] / 255;
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  if (maxChannel === 0) return 0;
  return (maxChannel - minChannel) / maxChannel;
}

export function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function variance(values, valueMean) {
  if (!values.length) return 0;
  const localMean = valueMean ?? mean(values);
  let sum = 0;
  for (const value of values) {
    const delta = value - localMean;
    sum += delta * delta;
  }
  return sum / values.length;
}

export function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) return 0;
  const rank = clamp(percentileValue, 0, 1) * (sortedValues.length - 1);
  const lowIndex = Math.floor(rank);
  const highIndex = Math.ceil(rank);
  if (lowIndex === highIndex) return sortedValues[lowIndex];
  const lowValue = sortedValues[lowIndex];
  const highValue = sortedValues[highIndex];
  const t = rank - lowIndex;
  return lowValue + (highValue - lowValue) * t;
}

export function sobelMagnitude(luma, width, height) {
  const magnitudes = new Float32Array(width * height);
  let maxMagnitude = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const a00 = luma[index - width - 1];
      const a01 = luma[index - width];
      const a02 = luma[index - width + 1];
      const a10 = luma[index - 1];
      const a12 = luma[index + 1];
      const a20 = luma[index + width - 1];
      const a21 = luma[index + width];
      const a22 = luma[index + width + 1];

      const gx = -a00 + a02 - 2 * a10 + 2 * a12 - a20 + a22;
      const gy = a00 + 2 * a01 + a02 - a20 - 2 * a21 - a22;
      const magnitude = Math.hypot(gx, gy);
      magnitudes[index] = magnitude;
      if (magnitude > maxMagnitude) maxMagnitude = magnitude;
    }
  }

  return { magnitudes, maxMagnitude };
}

export function dominantGradientAngleRadians(luma, width, height, sampleStride = 2) {
  const bins = new Float32Array(90);
  let total = 0;

  for (let y = 1; y < height - 1; y += sampleStride) {
    for (let x = 1; x < width - 1; x += sampleStride) {
      const index = y * width + x;
      const a00 = luma[index - width - 1];
      const a01 = luma[index - width];
      const a02 = luma[index - width + 1];
      const a10 = luma[index - 1];
      const a12 = luma[index + 1];
      const a20 = luma[index + width - 1];
      const a21 = luma[index + width];
      const a22 = luma[index + width + 1];

      const gx = -a00 + a02 - 2 * a10 + 2 * a12 - a20 + a22;
      const gy = a00 + 2 * a01 + a02 - a20 - 2 * a21 - a22;
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 0.08) continue;

      let angleDegrees = (Math.atan2(gy, gx) * 180) / Math.PI;
      angleDegrees = Math.abs(angleDegrees);
      while (angleDegrees >= 90) angleDegrees -= 90;
      const bin = Math.min(89, Math.floor(angleDegrees));
      bins[bin] += magnitude;
      total += magnitude;
    }
  }

  if (total === 0) return null;

  let bestBin = 0;
  let bestValue = bins[0];
  for (let i = 1; i < bins.length; i += 1) {
    if (bins[i] > bestValue) {
      bestValue = bins[i];
      bestBin = i;
    }
  }

  return (bestBin * Math.PI) / 180;
}

export function largestConnectedComponentRatio(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest = 0;

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;

    let front = 0;
    let back = 0;
    queue[back++] = i;
    visited[i] = 1;
    let size = 0;

    while (front < back) {
      const current = queue[front++];
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);

      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nextIndex = ny * width + nx;
        if (!mask[nextIndex] || visited[nextIndex]) continue;
        visited[nextIndex] = 1;
        queue[back++] = nextIndex;
      }
    }

    if (size > largest) largest = size;
  }

  return largest / mask.length;
}

