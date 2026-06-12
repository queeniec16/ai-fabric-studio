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
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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
      output.data[outputOffset] = source.data[sourceOffset];
      output.data[outputOffset + 1] = source.data[sourceOffset + 1];
      output.data[outputOffset + 2] = source.data[sourceOffset + 2];
      output.data[outputOffset + 3] = source.data[sourceOffset + 3];
    }
  }

  return output;
}

function circularOffset(source: ImageData, offsetX: number, offsetY: number) {
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

function blendPeriodicEdges(source: ImageData) {
  const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const blendX = Math.max(2, Math.round(source.width * 0.16));
  const blendY = Math.max(2, Math.round(source.height * 0.16));

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < blendX; x += 1) {
      const oppositeX = source.width - 1 - x;
      const strength = 1 - x / blendX;
      const leftOffset = (y * source.width + x) * 4;
      const rightOffset = (y * source.width + oppositeX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const average = (source.data[leftOffset + channel] + source.data[rightOffset + channel]) / 2;
        output.data[leftOffset + channel] =
          source.data[leftOffset + channel] * (1 - strength) + average * strength;
        output.data[rightOffset + channel] =
          source.data[rightOffset + channel] * (1 - strength) + average * strength;
      }
    }
  }

  const horizontalPass = new Uint8ClampedArray(output.data);
  for (let y = 0; y < blendY; y += 1) {
    const oppositeY = source.height - 1 - y;
    const strength = 1 - y / blendY;
    for (let x = 0; x < source.width; x += 1) {
      const topOffset = (y * source.width + x) * 4;
      const bottomOffset = (oppositeY * source.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const average = (horizontalPass[topOffset + channel] + horizontalPass[bottomOffset + channel]) / 2;
        output.data[topOffset + channel] =
          horizontalPass[topOffset + channel] * (1 - strength) + average * strength;
        output.data[bottomOffset + channel] =
          horizontalPass[bottomOffset + channel] * (1 - strength) + average * strength;
      }
    }
  }

  return output;
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
    const overlapPenalty = 1 + period / length * 0.08;
    const score = difference / Math.max(1, samples) * overlapPenalty;
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

export function generateSeamlessTexture(
  source: ImageData,
  mode: TileMode,
  sourceRect: CropRect,
  offsetX: number,
  offsetY: number,
): SeamlessTextureAsset {
  const repeatArea = cropImageData(source, sourceRect);
  const offset = circularOffset(repeatArea, offsetX, offsetY);
  const seamless = blendPeriodicEdges(offset);

  return {
    mode,
    imageData: seamless,
    url: imageDataToUrl(seamless),
    sourceRect,
    offsetX,
    offsetY,
  };
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
