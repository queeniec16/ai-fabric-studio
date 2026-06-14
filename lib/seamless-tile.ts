import type { CropRect } from "@/lib/fabric-segmentation";

export type TileMode = "manual" | "ai";
export type TileRepeat = 2 | 4 | 8;

export type SeamlessTextureAsset = {
  mode: TileMode;
  imageData: ImageData;
  url: string;
  sourceRect: CropRect;
  offsetX: number;
  offsetY: number;
  blendStrength: number;
  seamQuality: number;
  fixed: boolean;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value: number) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function imageDataToUrl(imageData: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function copyImageData(source: ImageData) {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

function cropImageData(source: ImageData, rect: CropRect) {
  const sourceX = clamp(Math.round(rect.x * source.width), 0, source.width - 1);
  const sourceY = clamp(Math.round(rect.y * source.height), 0, source.height - 1);
  const width = clamp(Math.round(rect.width * source.width), 8, source.width - sourceX);
  const height = clamp(Math.round(rect.height * source.height), 8, source.height - sourceY);
  const output = new ImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((sourceY + y) * source.width + sourceX + x) * 4;
      const outputOffset = (y * width + x) * 4;
      output.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), outputOffset);
    }
  }

  return output;
}

export function circularOffset(source: ImageData, offsetX: number, offsetY: number) {
  const output = new ImageData(source.width, source.height);
  const shiftX = Math.round((offsetX / 100) * source.width);
  const shiftY = Math.round((offsetY / 100) * source.height);

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceX = (x - shiftX + source.width) % source.width;
      const sourceY = (y - shiftY + source.height) % source.height;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const outputOffset = (y * source.width + x) * 4;
      output.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), outputOffset);
    }
  }

  return output;
}

function edgeAverage(source: ImageData, side: "left" | "right" | "top" | "bottom", depth: number) {
  const values = [0, 0, 0];
  let samples = 0;

  if (side === "left" || side === "right") {
    const start = side === "left" ? 0 : source.width - depth;
    for (let y = 0; y < source.height; y += 2) {
      for (let x = start; x < start + depth; x += 1) {
        const offset = (y * source.width + x) * 4;
        if (source.data[offset + 3] === 0) continue;
        values[0] += source.data[offset];
        values[1] += source.data[offset + 1];
        values[2] += source.data[offset + 2];
        samples += 1;
      }
    }
  } else {
    const start = side === "top" ? 0 : source.height - depth;
    for (let y = start; y < start + depth; y += 1) {
      for (let x = 0; x < source.width; x += 2) {
        const offset = (y * source.width + x) * 4;
        if (source.data[offset + 3] === 0) continue;
        values[0] += source.data[offset];
        values[1] += source.data[offset + 1];
        values[2] += source.data[offset + 2];
        samples += 1;
      }
    }
  }

  return values.map((value) => value / Math.max(1, samples));
}

function matchBorderColor(source: ImageData, strength: number) {
  const output = copyImageData(source);
  const amount = clamp(strength / 100, 0, 1);
  if (amount === 0) return output;
  const depthX = Math.max(2, Math.round(source.width * (0.08 + amount * 0.12)));
  const depthY = Math.max(2, Math.round(source.height * (0.08 + amount * 0.12)));
  const left = edgeAverage(source, "left", depthX);
  const right = edgeAverage(source, "right", depthX);
  const top = edgeAverage(source, "top", depthY);
  const bottom = edgeAverage(source, "bottom", depthY);
  const horizontalDelta = left.map((value, channel) => (right[channel] - value) * 0.5);
  const verticalDelta = top.map((value, channel) => (bottom[channel] - value) * 0.5);

  for (let y = 0; y < source.height; y += 1) {
    const topWeight = y < depthY ? smoothstep(1 - y / depthY) * amount : 0;
    const bottomDistance = source.height - 1 - y;
    const bottomWeight =
      bottomDistance < depthY ? smoothstep(1 - bottomDistance / depthY) * amount : 0;

    for (let x = 0; x < source.width; x += 1) {
      const leftWeight = x < depthX ? smoothstep(1 - x / depthX) * amount : 0;
      const rightDistance = source.width - 1 - x;
      const rightWeight =
        rightDistance < depthX ? smoothstep(1 - rightDistance / depthX) * amount : 0;
      const offset = (y * source.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const adjustment =
          horizontalDelta[channel] * (leftWeight - rightWeight) +
          verticalDelta[channel] * (topWeight - bottomWeight);
        output.data[offset + channel] = clamp(source.data[offset + channel] + adjustment, 0, 255);
      }
    }
  }

  return output;
}

function patchCenteredSeam(source: ImageData, axis: "x" | "y", strength: number) {
  const output = copyImageData(source);
  const amount = clamp(strength / 100, 0, 1);
  if (amount === 0) return output;
  const length = axis === "x" ? source.width : source.height;
  const crossLength = axis === "x" ? source.height : source.width;
  const center = Math.floor(length / 2);
  const halfBand = Math.max(2, Math.round(length * (0.015 + amount * 0.065)));
  const leftAnchor = clamp(center - halfBand - 1, 0, length - 1);
  const rightAnchor = clamp(center + halfBand + 1, 0, length - 1);

  for (let cross = 0; cross < crossLength; cross += 1) {
    for (let primary = center - halfBand; primary <= center + halfBand; primary += 1) {
      if (primary < 0 || primary >= length) continue;
      const progress = (primary - (center - halfBand)) / Math.max(1, halfBand * 2);
      const blend = smoothstep(progress);
      const outputPixel = axis === "x" ? cross * source.width + primary : primary * source.width + cross;
      const leftPixel = axis === "x" ? cross * source.width + leftAnchor : leftAnchor * source.width + cross;
      const rightPixel = axis === "x" ? cross * source.width + rightAnchor : rightAnchor * source.width + cross;
      const outputOffset = outputPixel * 4;
      const leftOffset = leftPixel * 4;
      const rightOffset = rightPixel * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const crossfade =
          source.data[leftOffset + channel] * (1 - blend) +
          source.data[rightOffset + channel] * blend;
        const originalWeight = Math.abs(progress - 0.5) * 2 * (1 - amount * 0.45);
        output.data[outputOffset + channel] = clamp(
          crossfade * (1 - originalWeight) +
            source.data[outputOffset + channel] * originalWeight,
          0,
          255,
        );
      }
      output.data[outputOffset + 3] = Math.max(
        source.data[leftOffset + 3],
        source.data[rightOffset + 3],
      );
    }
  }

  return output;
}

function enforcePeriodicBoundary(source: ImageData, strength: number) {
  const output = copyImageData(source);
  const amount = clamp(strength / 100, 0, 1);
  const depthX = Math.max(1, Math.round(source.width * (0.015 + amount * 0.035)));
  const depthY = Math.max(1, Math.round(source.height * (0.015 + amount * 0.035)));

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < depthX; x += 1) {
      const oppositeX = source.width - 1 - x;
      const weight = smoothstep(1 - x / depthX) * amount;
      const leftOffset = (y * source.width + x) * 4;
      const rightOffset = (y * source.width + oppositeX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const average = (source.data[leftOffset + channel] + source.data[rightOffset + channel]) / 2;
        output.data[leftOffset + channel] =
          source.data[leftOffset + channel] * (1 - weight) + average * weight;
        output.data[rightOffset + channel] =
          source.data[rightOffset + channel] * (1 - weight) + average * weight;
      }
    }
  }

  const horizontalPass = new Uint8ClampedArray(output.data);
  for (let y = 0; y < depthY; y += 1) {
    const oppositeY = source.height - 1 - y;
    const weight = smoothstep(1 - y / depthY) * amount;
    for (let x = 0; x < source.width; x += 1) {
      const topOffset = (y * source.width + x) * 4;
      const bottomOffset = (oppositeY * source.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const average = (horizontalPass[topOffset + channel] + horizontalPass[bottomOffset + channel]) / 2;
        output.data[topOffset + channel] =
          horizontalPass[topOffset + channel] * (1 - weight) + average * weight;
        output.data[bottomOffset + channel] =
          horizontalPass[bottomOffset + channel] * (1 - weight) + average * weight;
      }
    }
  }

  return output;
}

export function assessSeamQuality(source: ImageData) {
  let difference = 0;
  let samples = 0;

  for (let y = 0; y < source.height; y += 2) {
    const left = y * source.width * 4;
    const right = (y * source.width + source.width - 1) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(source.data[left + channel] - source.data[right + channel]);
      samples += 1;
    }
  }

  for (let x = 0; x < source.width; x += 2) {
    const top = x * 4;
    const bottom = ((source.height - 1) * source.width + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(source.data[top + channel] - source.data[bottom + channel]);
      samples += 1;
    }
  }

  const normalizedDifference = difference / Math.max(1, samples) / 255;
  return Math.round(clamp(100 - normalizedDifference * 420, 0, 100));
}

function assessPatchConfidence(before: ImageData, after: ImageData) {
  let changedDifference = 0;
  let changedSamples = 0;

  for (let offset = 0; offset < before.data.length; offset += 4) {
    const difference =
      (Math.abs(before.data[offset] - after.data[offset]) +
        Math.abs(before.data[offset + 1] - after.data[offset + 1]) +
        Math.abs(before.data[offset + 2] - after.data[offset + 2])) /
      3;
    if (difference < 3) continue;
    changedDifference += difference;
    changedSamples += 1;
  }

  if (changedSamples === 0) return 100;
  const averageChangedDifference = changedDifference / changedSamples / 255;
  return Math.round(clamp(100 - averageChangedDifference * 145, 0, 100));
}

function luminanceSample(source: ImageData, maxSize = 128) {
  const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
  const width = Math.max(16, Math.round(source.width * scale));
  const height = Math.max(16, Math.round(source.height * scale));
  const values = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y / height) * source.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x / width) * source.width));
      const offset = (sourceY * source.width + sourceX) * 4;
      values[y * width + x] =
        source.data[offset] * 0.299 +
        source.data[offset + 1] * 0.587 +
        source.data[offset + 2] * 0.114;
    }
  }

  return { values, width, height };
}

function findPeriod(values: Float32Array, width: number, height: number, axis: "x" | "y") {
  const length = axis === "x" ? width : height;
  const crossLength = axis === "x" ? height : width;
  const minimum = Math.max(4, Math.round(length * 0.12));
  const maximum = Math.max(minimum, Math.round(length * 0.72));
  let bestPeriod = Math.max(minimum, Math.round(length * 0.5));
  let bestScore = Number.POSITIVE_INFINITY;

  for (let period = minimum; period <= maximum; period += 1) {
    let difference = 0;
    let samples = 0;
    const available = length - period;
    for (let primary = 0; primary < available; primary += 2) {
      for (let cross = 0; cross < crossLength; cross += 2) {
        const first = axis === "x" ? cross * width + primary : primary * width + cross;
        const second =
          axis === "x"
            ? cross * width + primary + period
            : (primary + period) * width + cross;
        difference += Math.abs(values[first] - values[second]);
        samples += 1;
      }
    }
    const score = difference / Math.max(1, samples) * (1 + period / length * 0.08);
    if (score < bestScore) {
      bestScore = score;
      bestPeriod = period;
    }
  }

  return bestPeriod;
}

export function detectRepeatArea(source: ImageData): CropRect {
  const sample = luminanceSample(source);
  const periodX = findPeriod(sample.values, sample.width, sample.height, "x");
  const periodY = findPeriod(sample.values, sample.width, sample.height, "y");
  const width = clamp(periodX / sample.width, 0.18, 0.82);
  const height = clamp(periodY / sample.height, 0.18, 0.82);

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
}

export function generateTileDraft(
  source: ImageData,
  mode: TileMode,
  sourceRect: CropRect,
  offsetX: number,
  offsetY: number,
  blendStrength: number,
): SeamlessTextureAsset {
  const repeatArea = cropImageData(source, sourceRect);
  const offset = circularOffset(repeatArea, offsetX, offsetY);
  const matched = matchBorderColor(offset, blendStrength);

  return {
    mode,
    imageData: matched,
    url: imageDataToUrl(matched),
    sourceRect,
    offsetX,
    offsetY,
    blendStrength,
    seamQuality: assessSeamQuality(matched),
    fixed: false,
  };
}

export function fixTileSeams(asset: SeamlessTextureAsset, blendStrength: number) {
  const offset = circularOffset(asset.imageData, 50, 50);
  const verticalPatch = patchCenteredSeam(offset, "x", blendStrength);
  const horizontalPatch = patchCenteredSeam(verticalPatch, "y", blendStrength);
  const seamless = enforcePeriodicBoundary(horizontalPatch, blendStrength);
  const boundaryQuality = assessSeamQuality(seamless);
  const patchConfidence = assessPatchConfidence(offset, seamless);

  return {
    ...asset,
    imageData: seamless,
    url: imageDataToUrl(seamless),
    blendStrength,
    seamQuality: Math.min(boundaryQuality, patchConfidence),
    fixed: true,
  };
}

export function createOffsetPreview(source: ImageData) {
  return imageDataToUrl(circularOffset(source, 50, 50));
}

export function createTiledPreview(source: ImageData, repeat: TileRepeat, size = 720) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = source.width;
  sourceCanvas.height = source.height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("Canvas is not available in this browser.");
  sourceContext.putImageData(source, 0, 0);
  const cellSize = size / repeat;

  for (let y = 0; y < repeat; y += 1) {
    for (let x = 0; x < repeat; x += 1) {
      context.drawImage(sourceCanvas, x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  return canvas.toDataURL("image/png");
}
