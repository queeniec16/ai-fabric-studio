import type { CropRect } from "@/lib/fabric-segmentation";

export type TileMode = "manual" | "ai";
export type TileRepeat = 2 | 4 | 8;
export type PatchMode = "clone" | "mirror";

export type SeamlessOptions = {
  blendWidth: number;
  blendStrength: number;
  edgeColorMatch: number;
  texturePreservation: number;
  patchMode: PatchMode;
};

export type SeamlessTextureAsset = {
  mode: TileMode;
  imageData: ImageData;
  url: string;
  sourceRect: CropRect;
  offsetX: number;
  offsetY: number;
  options: SeamlessOptions;
  beforeImageData: ImageData;
  beforeUrl: string;
  seamQuality: number;
  fixed: boolean;
};

export type AITileCandidateMetrics = {
  horizontalEdge: number;
  verticalEdge: number;
  brightness: number;
  color: number;
  texture: number;
  pattern: number;
};

export type AITileCandidate = {
  id: string;
  sourceRect: CropRect;
  imageData: ImageData;
  url: string;
  previewUrl: string;
  score: number;
  metrics: AITileCandidateMetrics;
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

function matchBorderColor(source: ImageData, options: SeamlessOptions) {
  const output = copyImageData(source);
  const amount = clamp(options.edgeColorMatch / 100, 0, 1);
  if (amount === 0) return output;
  const widthRatio = clamp(options.blendWidth / 100, 0.03, 0.4);
  const depthX = Math.max(2, Math.round(source.width * widthRatio));
  const depthY = Math.max(2, Math.round(source.height * widthRatio));
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

function patchCenteredSeam(source: ImageData, axis: "x" | "y", options: SeamlessOptions) {
  const output = copyImageData(source);
  const amount = clamp(options.blendStrength / 100, 0, 1);
  if (amount === 0) return output;
  const length = axis === "x" ? source.width : source.height;
  const crossLength = axis === "x" ? source.height : source.width;
  const center = Math.floor(length / 2);
  const halfBand = Math.max(2, Math.round(length * clamp(options.blendWidth / 200, 0.02, 0.22)));
  const leftAnchor = clamp(center - halfBand - 1, 0, length - 1);
  const rightAnchor = clamp(center + halfBand + 1, 0, length - 1);
  const preservation = clamp(options.texturePreservation / 100, 0, 1);

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
      const donorPrimary =
        options.patchMode === "mirror"
          ? progress < 0.5
            ? clamp(leftAnchor - (primary - (center - halfBand)), 0, length - 1)
            : clamp(rightAnchor + (center + halfBand - primary), 0, length - 1)
          : progress < 0.5
            ? clamp(leftAnchor - Math.round(halfBand * 0.45), 0, length - 1)
            : clamp(rightAnchor + Math.round(halfBand * 0.45), 0, length - 1);
      const donorPixel =
        axis === "x"
          ? cross * source.width + donorPrimary
          : donorPrimary * source.width + cross;
      const donorOffset = donorPixel * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const crossfade =
          source.data[leftOffset + channel] * (1 - blend) +
          source.data[rightOffset + channel] * blend;
        const anchor = progress < 0.5 ? source.data[leftOffset + channel] : source.data[rightOffset + channel];
        const donorDetail = source.data[donorOffset + channel] - anchor;
        const patched = crossfade + donorDetail * preservation * 0.58;
        const feather = smoothstep(1 - Math.abs(progress - 0.5) * 2) * amount;
        output.data[outputOffset + channel] = clamp(
          source.data[outputOffset + channel] * (1 - feather) + patched * feather,
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

function enforcePeriodicBoundary(source: ImageData, options: SeamlessOptions) {
  const output = copyImageData(source);
  const amount = clamp(options.blendStrength / 100, 0, 1);
  const widthRatio = clamp(options.blendWidth / 100, 0.03, 0.4);
  const depthX = Math.max(1, Math.round(source.width * widthRatio * 0.45));
  const depthY = Math.max(1, Math.round(source.height * widthRatio * 0.45));

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

function edgeContinuityMetrics(source: ImageData): AITileCandidateMetrics {
  const edgeDepth = Math.max(2, Math.round(Math.min(source.width, source.height) * 0.04));
  let horizontalColor = 0;
  let verticalColor = 0;
  let horizontalBrightness = 0;
  let verticalBrightness = 0;
  let horizontalTexture = 0;
  let verticalTexture = 0;
  let horizontalPattern = 0;
  let verticalPattern = 0;
  let horizontalSamples = 0;
  let verticalSamples = 0;

  const samplePixel = (x: number, y: number) => {
    const offset = (y * source.width + x) * 4;
    const red = source.data[offset];
    const green = source.data[offset + 1];
    const blue = source.data[offset + 2];
    return {
      red,
      green,
      blue,
      luminance: red * 0.299 + green * 0.587 + blue * 0.114,
      alpha: source.data[offset + 3],
    };
  };

  for (let y = 1; y < source.height - 1; y += 2) {
    for (let depth = 0; depth < edgeDepth; depth += 1) {
      const left = samplePixel(depth, y);
      const right = samplePixel(source.width - edgeDepth + depth, y);
      if (left.alpha === 0 || right.alpha === 0) continue;
      const leftPrevious = samplePixel(depth, y - 1);
      const rightPrevious = samplePixel(source.width - edgeDepth + depth, y - 1);
      horizontalColor +=
        (Math.abs(left.red - right.red) +
          Math.abs(left.green - right.green) +
          Math.abs(left.blue - right.blue)) /
        3;
      horizontalBrightness += Math.abs(left.luminance - right.luminance);
      horizontalTexture += Math.abs(
        Math.abs(left.luminance - leftPrevious.luminance) -
          Math.abs(right.luminance - rightPrevious.luminance),
      );
      horizontalPattern += Math.abs(
        (left.red - left.blue) - (right.red - right.blue),
      );
      horizontalSamples += 1;
    }
  }

  for (let x = 1; x < source.width - 1; x += 2) {
    for (let depth = 0; depth < edgeDepth; depth += 1) {
      const top = samplePixel(x, depth);
      const bottom = samplePixel(x, source.height - edgeDepth + depth);
      if (top.alpha === 0 || bottom.alpha === 0) continue;
      const topPrevious = samplePixel(x - 1, depth);
      const bottomPrevious = samplePixel(x - 1, source.height - edgeDepth + depth);
      verticalColor +=
        (Math.abs(top.red - bottom.red) +
          Math.abs(top.green - bottom.green) +
          Math.abs(top.blue - bottom.blue)) /
        3;
      verticalBrightness += Math.abs(top.luminance - bottom.luminance);
      verticalTexture += Math.abs(
        Math.abs(top.luminance - topPrevious.luminance) -
          Math.abs(bottom.luminance - bottomPrevious.luminance),
      );
      verticalPattern += Math.abs(
        (top.green - top.blue) - (bottom.green - bottom.blue),
      );
      verticalSamples += 1;
    }
  }

  const continuity = (difference: number, samples: number, sensitivity: number) =>
    Math.round(clamp(100 - (difference / Math.max(1, samples) / 255) * sensitivity, 0, 100));

  const horizontalEdge = continuity(horizontalColor, horizontalSamples, 360);
  const verticalEdge = continuity(verticalColor, verticalSamples, 360);
  const brightness = Math.round(
    (continuity(horizontalBrightness, horizontalSamples, 420) +
      continuity(verticalBrightness, verticalSamples, 420)) /
      2,
  );
  const color = Math.round((horizontalEdge + verticalEdge) / 2);
  const texture = Math.round(
    (continuity(horizontalTexture, horizontalSamples, 520) +
      continuity(verticalTexture, verticalSamples, 520)) /
      2,
  );
  const pattern = Math.round(
    (continuity(horizontalPattern, horizontalSamples, 360) +
      continuity(verticalPattern, verticalSamples, 360)) /
      2,
  );

  return { horizontalEdge, verticalEdge, brightness, color, texture, pattern };
}

function scoreCandidate(metrics: AITileCandidateMetrics) {
  return Math.round(
    metrics.horizontalEdge * 0.19 +
      metrics.verticalEdge * 0.19 +
      metrics.brightness * 0.16 +
      metrics.color * 0.16 +
      metrics.texture * 0.16 +
      metrics.pattern * 0.14,
  );
}

function candidateDistance(first: CropRect, second: CropRect) {
  return (
    Math.abs(first.x - second.x) +
    Math.abs(first.y - second.y) +
    Math.abs(first.width - second.width) +
    Math.abs(first.height - second.height)
  );
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

export function generateAITileCandidates(
  source: ImageData,
  sampleCount = 36,
  resultCount = 6,
) {
  const detected = detectRepeatArea(source);
  const minimumWidth = clamp(detected.width * 0.62, 0.18, 0.7);
  const maximumWidth = clamp(detected.width * 1.42, minimumWidth, 0.86);
  const minimumHeight = clamp(detected.height * 0.62, 0.18, 0.7);
  const maximumHeight = clamp(detected.height * 1.42, minimumHeight, 0.86);
  const rectangles: CropRect[] = [detected];

  for (let index = 1; index < sampleCount; index += 1) {
    const width = minimumWidth + Math.random() * (maximumWidth - minimumWidth);
    const height = minimumHeight + Math.random() * (maximumHeight - minimumHeight);
    rectangles.push({
      x: Math.random() * Math.max(0, 1 - width),
      y: Math.random() * Math.max(0, 1 - height),
      width,
      height,
    });
  }

  const ranked = rectangles
    .map((sourceRect) => {
      const imageData = cropImageData(source, sourceRect);
      const metrics = edgeContinuityMetrics(imageData);
      return { sourceRect, imageData, metrics, score: scoreCandidate(metrics) };
    })
    .sort((first, second) => second.score - first.score);

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    if (selected.every((item) => candidateDistance(item.sourceRect, candidate.sourceRect) > 0.11)) {
      selected.push(candidate);
    }
    if (selected.length === resultCount) break;
  }
  if (selected.length < resultCount) {
    for (const candidate of ranked) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length === resultCount) break;
    }
  }

  return selected.map<AITileCandidate>((candidate, index) => ({
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    sourceRect: candidate.sourceRect,
    imageData: candidate.imageData,
    url: imageDataToUrl(candidate.imageData),
    previewUrl: createTiledPreview(candidate.imageData, 2, 360),
    score: candidate.score,
    metrics: candidate.metrics,
  }));
}

export function generateTileDraft(
  source: ImageData,
  mode: TileMode,
  sourceRect: CropRect,
  offsetX: number,
  offsetY: number,
  options: SeamlessOptions,
): SeamlessTextureAsset {
  const repeatArea = cropImageData(source, sourceRect);
  const offset = circularOffset(repeatArea, offsetX, offsetY);
  const matched = matchBorderColor(offset, options);

  return {
    mode,
    imageData: matched,
    url: imageDataToUrl(matched),
    sourceRect,
    offsetX,
    offsetY,
    options,
    beforeImageData: offset,
    beforeUrl: imageDataToUrl(offset),
    seamQuality: assessSeamQuality(matched),
    fixed: false,
  };
}

export function fixTileSeams(asset: SeamlessTextureAsset, options: SeamlessOptions) {
  const colorMatched = matchBorderColor(asset.beforeImageData, options);
  const offset = circularOffset(colorMatched, 50, 50);
  const verticalPatch = patchCenteredSeam(offset, "x", options);
  const horizontalPatch = patchCenteredSeam(verticalPatch, "y", options);
  const seamless = enforcePeriodicBoundary(horizontalPatch, options);
  const boundaryQuality = assessSeamQuality(seamless);
  const patchConfidence = assessPatchConfidence(offset, seamless);

  return {
    ...asset,
    imageData: seamless,
    url: imageDataToUrl(seamless),
    options,
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
