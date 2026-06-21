export type FabricFamily = "Knit" | "Woven" | "Jacquard" | "Technical textile";

export type FabricIntelligence = {
  family: FabricFamily;
  subCategory: string;
  confidence: number;
  structureType: string;
  yarnBehavior: string;
  recommendedSoftness: [number, number];
  reasoning: string[];
};

type FabricFeatures = {
  colorSpread: number;
  contrast: number;
  horizontalEnergy: number;
  verticalEnergy: number;
  diagonalEnergy: number;
  gridEnergy: number;
  ribEnergy: number;
  motifComplexity: number;
  openness: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function luminance(red: number, green: number, blue: number) {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function extractFeatures(imageData: ImageData): FabricFeatures {
  const { width, height, data } = imageData;
  let samples = 0;
  let transparent = 0;
  let sum = 0;
  let sumSquared = 0;
  let redMin = 255;
  let redMax = 0;
  let greenMin = 255;
  let greenMax = 0;
  let blueMin = 255;
  let blueMax = 0;
  let horizontalEnergy = 0;
  let verticalEnergy = 0;
  let diagonalEnergy = 0;
  const columnValues = new Float32Array(width);
  const rowValues = new Float32Array(height);
  const columnCounts = new Uint16Array(width);
  const rowCounts = new Uint16Array(height);

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < 12) {
        transparent += 1;
        continue;
      }
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const value = luminance(red, green, blue);
      samples += 1;
      sum += value;
      sumSquared += value * value;
      redMin = Math.min(redMin, red);
      redMax = Math.max(redMax, red);
      greenMin = Math.min(greenMin, green);
      greenMax = Math.max(greenMax, green);
      blueMin = Math.min(blueMin, blue);
      blueMax = Math.max(blueMax, blue);
      columnValues[x] += value;
      rowValues[y] += value;
      columnCounts[x] += 1;
      rowCounts[y] += 1;

      if (x + 2 < width) {
        const rightOffset = (y * width + x + 2) * 4;
        horizontalEnergy += Math.abs(value - luminance(data[rightOffset], data[rightOffset + 1], data[rightOffset + 2]));
      }
      if (y + 2 < height) {
        const downOffset = ((y + 2) * width + x) * 4;
        verticalEnergy += Math.abs(value - luminance(data[downOffset], data[downOffset + 1], data[downOffset + 2]));
      }
      if (x + 2 < width && y + 2 < height) {
        const diagonalOffset = ((y + 2) * width + x + 2) * 4;
        diagonalEnergy += Math.abs(value - luminance(data[diagonalOffset], data[diagonalOffset + 1], data[diagonalOffset + 2]));
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    columnValues[x] /= Math.max(1, columnCounts[x]);
  }
  for (let y = 0; y < height; y += 1) {
    rowValues[y] /= Math.max(1, rowCounts[y]);
  }

  let columnVariation = 0;
  let rowVariation = 0;
  for (let x = 1; x < width; x += 2) {
    columnVariation += Math.abs(columnValues[x] - columnValues[x - 1]);
  }
  for (let y = 1; y < height; y += 2) {
    rowVariation += Math.abs(rowValues[y] - rowValues[y - 1]);
  }

  const average = sum / Math.max(1, samples);
  const variance = sumSquared / Math.max(1, samples) - average * average;
  const contrast = clamp(Math.sqrt(Math.max(0, variance)) / 72, 0, 1);
  const colorSpread = clamp(
    ((redMax - redMin) + (greenMax - greenMin) + (blueMax - blueMin)) / 600,
    0,
    1,
  );
  const edgeNormalizer = Math.max(1, samples) * 255;
  const horizontal = clamp(horizontalEnergy / edgeNormalizer * 14, 0, 1);
  const vertical = clamp(verticalEnergy / edgeNormalizer * 14, 0, 1);
  const diagonal = clamp(diagonalEnergy / edgeNormalizer * 14, 0, 1);
  const gridEnergy = clamp((horizontal + vertical) / 2 - Math.abs(horizontal - vertical) * 0.2, 0, 1);
  const ribEnergy = clamp(columnVariation / Math.max(1, width) / 45, 0, 1);
  const motifComplexity = clamp(colorSpread * 0.6 + contrast * 0.4, 0, 1);
  const openness = transparent / Math.max(1, transparent + samples);

  return {
    colorSpread,
    contrast,
    horizontalEnergy: horizontal,
    verticalEnergy: vertical,
    diagonalEnergy: diagonal,
    gridEnergy,
    ribEnergy,
    motifComplexity,
    openness,
  };
}

function confidence(value: number) {
  return clamp(Math.round(value * 100) / 100, 0.52, 0.92);
}

export function analyzeFabricIntelligence(imageData: ImageData): FabricIntelligence {
  const features = extractFeatures(imageData);
  const knitScore =
    features.ribEnergy * 0.36 +
    features.verticalEnergy * 0.18 +
    features.gridEnergy * 0.14 +
    (1 - features.colorSpread) * 0.16 +
    features.contrast * 0.16;
  const wovenScore =
    features.gridEnergy * 0.36 +
    Math.min(features.horizontalEnergy, features.verticalEnergy) * 0.22 +
    (1 - features.motifComplexity) * 0.18 +
    features.diagonalEnergy * 0.14 +
    (1 - features.openness) * 0.1;
  const jacquardScore =
    features.motifComplexity * 0.42 +
    features.colorSpread * 0.22 +
    features.contrast * 0.16 +
    Math.max(features.horizontalEnergy, features.verticalEnergy) * 0.12 +
    features.gridEnergy * 0.08;
  const technicalScore =
    features.openness * 0.42 +
    features.gridEnergy * 0.2 +
    features.contrast * 0.16 +
    (1 - features.colorSpread) * 0.12 +
    Math.max(features.horizontalEnergy, features.verticalEnergy) * 0.1;

  const scores = [
    { family: "Knit" as FabricFamily, score: knitScore },
    { family: "Woven" as FabricFamily, score: wovenScore },
    { family: "Jacquard" as FabricFamily, score: jacquardScore },
    { family: "Technical textile" as FabricFamily, score: technicalScore },
  ].sort((first, second) => second.score - first.score);
  const family = scores[0].family;
  const gap = scores[0].score - scores[1].score;

  if (family === "Knit") {
    const ribName = features.ribEnergy > 0.72 ? "2x2 Rib Knit" : features.ribEnergy > 0.5 ? "1x1 Rib Knit" : "Jersey Knit";
    return {
      family,
      subCategory: features.motifComplexity > 0.55 ? "Jacquard knit" : ribName,
      confidence: confidence(0.62 + gap * 0.55 + features.ribEnergy * 0.18),
      structureType: features.ribEnergy > 0.55 ? "Vertical rib loops with raised wale structure" : "Soft loop-based knit surface",
      yarnBehavior: "Elastic yarn loops, soft compression, rounded surface relief",
      recommendedSoftness: features.ribEnergy > 0.6 ? [65, 82] : [58, 76],
      reasoning: ["loop-like vertical texture", "soft ridge behavior expected", "normal relief should be rounded"],
    };
  }

  if (family === "Jacquard") {
    return {
      family,
      subCategory: features.colorSpread > 0.72 ? "Double jacquard" : "Jacquard knit",
      confidence: confidence(0.58 + gap * 0.52 + features.motifComplexity * 0.2),
      structureType: "Complex motif structure with multiple yarn/color systems",
      yarnBehavior: "Pattern yarns create moderate relief, but raised areas should remain textile-soft",
      recommendedSoftness: [50, 72],
      reasoning: ["high motif complexity", "multi-color structure", "pattern continuity matters more than sharp relief"],
    };
  }

  if (family === "Technical textile") {
    return {
      family,
      subCategory: features.openness > 0.08 ? "Mesh / open technical textile" : "Technical textile",
      confidence: confidence(0.56 + gap * 0.5 + features.openness * 0.2),
      structureType: "Engineered grid or open structure",
      yarnBehavior: "Firm synthetic behavior with controlled surface relief",
      recommendedSoftness: [28, 52],
      reasoning: ["open or engineered structure detected", "firmer material response recommended"],
    };
  }

  const wovenSubCategory =
    features.diagonalEnergy > features.gridEnergy * 0.72
      ? "Twill weave"
      : features.contrast < 0.24 && features.colorSpread < 0.28
        ? "Satin / Taffeta"
        : "Plain weave";

  return {
    family: "Woven",
    subCategory: wovenSubCategory,
    confidence: confidence(0.6 + gap * 0.52 + features.gridEnergy * 0.14),
    structureType: "Interlaced warp and weft structure",
    yarnBehavior: "Stable woven body with low stretch and flatter surface relief",
    recommendedSoftness: wovenSubCategory === "Satin / Taffeta" ? [35, 58] : [42, 66],
    reasoning: ["warp/weft grid texture", "flatter interlaced construction", "moderate height response recommended"],
  };
}
