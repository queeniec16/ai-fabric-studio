export type RGB = {
  r: number;
  g: number;
  b: number;
};

export type FabricLayer = {
  id: number;
  name: string;
  description: string;
  sourceColor: string;
  targetColor: string;
  coverage: number;
  pixelCount: number;
  mask: Uint8Array;
  centroid: RGB;
};

export type SegmentationResult = {
  width: number;
  height: number;
  original: ImageData;
  layers: FabricLayer[];
};

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SelectionPoint = {
  x: number;
  y: number;
};

const MAX_PROCESSING_EDGE = 1100;
const SAMPLE_LIMIT = 9000;
const ITERATIONS = 14;

function colorDistance(a: RGB, b: RGB) {
  const rMean = (a.r + b.r) / 2;
  const r = a.r - b.r;
  const g = a.g - b.g;
  const blue = a.b - b.b;

  return Math.sqrt(
    (2 + rMean / 256) * r * r +
      4 * g * g +
      (2 + (255 - rMean) / 256) * blue * blue,
  );
}

function toHex(color: RGB) {
  return `#${[color.r, color.g, color.b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(hex: string): RGB {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function chooseInitialCentroids(samples: RGB[], count: number) {
  const centroids: RGB[] = [];
  const luminance = (color: RGB) => color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  const sorted = [...samples].sort((a, b) => luminance(a) - luminance(b));

  centroids.push(sorted[Math.floor(sorted.length / 2)]);

  while (centroids.length < count) {
    let furthest = samples[0];
    let furthestDistance = -1;

    for (const sample of samples) {
      const nearest = Math.min(...centroids.map((centroid) => colorDistance(sample, centroid)));
      if (nearest > furthestDistance) {
        furthestDistance = nearest;
        furthest = sample;
      }
    }

    centroids.push({ ...furthest });
  }

  return centroids;
}

function runKMeans(samples: RGB[], count: number) {
  let centroids = chooseInitialCentroids(samples, count);

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const sums = Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0, count: 0 }));

    for (const sample of samples) {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      centroids.forEach((centroid, index) => {
        const distance = colorDistance(sample, centroid);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      sums[nearestIndex].r += sample.r;
      sums[nearestIndex].g += sample.g;
      sums[nearestIndex].b += sample.b;
      sums[nearestIndex].count += 1;
    }

    const next = sums.map((sum, index) =>
      sum.count
        ? {
            r: sum.r / sum.count,
            g: sum.g / sum.count,
            b: sum.b / sum.count,
          }
        : centroids[index],
    );

    const movement = next.reduce(
      (total, centroid, index) => total + colorDistance(centroid, centroids[index]),
      0,
    );
    centroids = next;

    if (movement < 1) break;
  }

  return centroids;
}

function getLayerMeta(index: number, coverage: number, orientationScore: number) {
  if (index === 0) {
    return {
      name: "Ground Fabric",
      description: "Primary base / ground structure",
    };
  }

  if (orientationScore > 0.36) {
    return {
      name: "Stripe / Jacquard",
      description: "Directional woven or stripe region",
    };
  }

  if (index === 1 || coverage > 18) {
    return {
      name: "Pattern Motif",
      description: "Dominant pattern or motif color",
    };
  }

  return {
    name: index === 2 ? "Secondary Motif" : "Accent Detail",
    description: index === 2 ? "Secondary pattern structure" : "Fine textile color detail",
  };
}

function measureOrientation(mask: Uint8Array, width: number, height: number) {
  const rowCounts = new Float32Array(Math.min(height, 80));
  const colCounts = new Float32Array(Math.min(width, 80));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      rowCounts[Math.floor((y / height) * rowCounts.length)] += 1;
      colCounts[Math.floor((x / width) * colCounts.length)] += 1;
    }
  }

  const coefficient = (values: Float32Array) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length || 1;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance / values.length) / mean;
  };

  return Math.max(coefficient(rowCounts), coefficient(colCounts));
}

export async function loadFabricImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PROCESSING_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is not available in this browser.");

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return {
    previewUrl: canvas.toDataURL("image/png"),
    imageData: context.getImageData(0, 0, width, height),
  };
}

export function cropFabricImage(imageData: ImageData, crop: CropRect) {
  const sourceX = Math.max(0, Math.min(imageData.width - 1, Math.round(crop.x * imageData.width)));
  const sourceY = Math.max(0, Math.min(imageData.height - 1, Math.round(crop.y * imageData.height)));
  const width = Math.max(
    1,
    Math.min(imageData.width - sourceX, Math.round(crop.width * imageData.width)),
  );
  const height = Math.max(
    1,
    Math.min(imageData.height - sourceY, Math.round(crop.height * imageData.height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is not available in this browser.");

  context.putImageData(imageData, 0, 0);
  return context.getImageData(sourceX, sourceY, width, height);
}

export function selectPolygonFabric(imageData: ImageData, points: SelectionPoint[]) {
  if (points.length < 3) {
    throw new Error("Add at least three points around the fabric boundary.");
  }

  const minimumX = Math.min(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumX = Math.max(...points.map((point) => point.x));
  const maximumY = Math.max(...points.map((point) => point.y));
  const sourceX = Math.max(0, Math.floor(minimumX * imageData.width));
  const sourceY = Math.max(0, Math.floor(minimumY * imageData.height));
  const sourceRight = Math.min(imageData.width, Math.ceil(maximumX * imageData.width));
  const sourceBottom = Math.min(imageData.height, Math.ceil(maximumY * imageData.height));
  const width = Math.max(1, sourceRight - sourceX);
  const height = Math.max(1, sourceBottom - sourceY);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("Canvas is not available in this browser.");
  sourceContext.putImageData(imageData, 0, 0);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) throw new Error("Canvas is not available in this browser.");

  outputContext.save();
  outputContext.beginPath();
  points.forEach((point, index) => {
    const x = point.x * imageData.width - sourceX;
    const y = point.y * imageData.height - sourceY;
    if (index === 0) outputContext.moveTo(x, y);
    else outputContext.lineTo(x, y);
  });
  outputContext.closePath();
  outputContext.clip();
  outputContext.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  outputContext.restore();

  return outputContext.getImageData(0, 0, width, height);
}

export function detectFabricLayers(imageData: ImageData, requestedCount: number): SegmentationResult {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const clusterCount = Math.max(2, Math.min(4, requestedCount));
  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_LIMIT));
  const samples: RGB[] = [];
  let visiblePixelCount = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    if (data[offset + 3] < 128) continue;
    visiblePixelCount += 1;
    if (pixel % stride === 0) {
      samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    }
  }

  if (samples.length < clusterCount) {
    throw new Error("This image does not contain enough visible color information.");
  }

  const centroids = runKMeans(samples, clusterCount);
  const masks = Array.from({ length: clusterCount }, () => new Uint8Array(pixelCount));
  const counts = new Array(clusterCount).fill(0);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    if (data[offset + 3] < 128) continue;
    const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    centroids.forEach((centroid, index) => {
      const distance = colorDistance(color, centroid);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    masks[nearestIndex][pixel] = 255;
    counts[nearestIndex] += 1;
  }

  const sortedIndexes = counts
    .map((count, index) => ({ count, index }))
    .sort((a, b) => b.count - a.count)
    .map(({ index }) => index);

  const layers = sortedIndexes.map((sourceIndex, displayIndex) => {
    const coverage = (counts[sourceIndex] / visiblePixelCount) * 100;
    const centroid = centroids[sourceIndex];
    const meta = getLayerMeta(
      displayIndex,
      coverage,
      measureOrientation(masks[sourceIndex], width, height),
    );

    return {
      id: displayIndex,
      ...meta,
      sourceColor: toHex(centroid),
      targetColor: toHex(centroid),
      coverage,
      pixelCount: counts[sourceIndex],
      mask: masks[sourceIndex],
      centroid,
    };
  });

  return {
    width,
    height,
    original: imageData,
    layers,
  };
}

export function recolorFabric(segmentation: SegmentationResult, targetColors: string[]) {
  const { width, height, original, layers } = segmentation;
  const result = new ImageData(new Uint8ClampedArray(original.data), width, height);

  layers.forEach((layer, layerIndex) => {
    const target = hexToRgb(targetColors[layerIndex] ?? layer.targetColor);
    const source = layer.centroid;
    const sourceLuminance = source.r * 0.299 + source.g * 0.587 + source.b * 0.114 || 1;
    const targetLuminance = target.r * 0.299 + target.g * 0.587 + target.b * 0.114 || 1;

    for (let pixel = 0; pixel < layer.mask.length; pixel += 1) {
      if (!layer.mask[pixel]) continue;
      const offset = pixel * 4;
      const originalLuminance =
        original.data[offset] * 0.299 +
        original.data[offset + 1] * 0.587 +
        original.data[offset + 2] * 0.114;
      const textureRatio = Math.max(0.3, Math.min(1.8, originalLuminance / sourceLuminance));
      const luminanceProtection = Math.pow(sourceLuminance / targetLuminance, 0.08);
      const multiplier = textureRatio * luminanceProtection;

      result.data[offset] = Math.min(255, target.r * multiplier);
      result.data[offset + 1] = Math.min(255, target.g * multiplier);
      result.data[offset + 2] = Math.min(255, target.b * multiplier);
    }
  });

  return result;
}

export function imageDataToUrl(imageData: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

export function maskToUrl(
  mask: Uint8Array,
  width: number,
  height: number,
  color: string,
) {
  const rgb = hexToRgb(color);
  const preview = new ImageData(width, height);

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = mask[pixel];
    preview.data[offset] = rgb.r;
    preview.data[offset + 1] = rgb.g;
    preview.data[offset + 2] = rgb.b;
    preview.data[offset + 3] = alpha ? 230 : 18;
  }

  return imageDataToUrl(preview);
}
