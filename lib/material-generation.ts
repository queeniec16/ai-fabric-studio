export type MaterialMapKind = "baseColor" | "normal" | "roughness" | "height";

export type MaterialMapAsset = {
  kind: MaterialMapKind;
  label: string;
  description: string;
  fileSuffix: string;
  imageData: ImageData;
  url: string;
};

export type FabricMaterialAsset = {
  width: number;
  height: number;
  maps: Record<MaterialMapKind, MaterialMapAsset>;
};

const MAP_META: Record<
  MaterialMapKind,
  Pick<MaterialMapAsset, "label" | "description" | "fileSuffix">
> = {
  baseColor: {
    label: "Base Color",
    description: "Recolored textile surface and pattern",
    fileSuffix: "base-color",
  },
  normal: {
    label: "Normal",
    description: "Estimated yarn direction and surface relief",
    fileSuffix: "normal",
  },
  roughness: {
    label: "Roughness",
    description: "Estimated matte and reflective response",
    fileSuffix: "roughness",
  },
  height: {
    label: "Height",
    description: "Grayscale textile displacement estimate",
    fileSuffix: "height",
  },
};

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
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

function luminanceField(imageData: ImageData) {
  const values = new Float32Array(imageData.width * imageData.height);

  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * 4;
    values[pixel] =
      imageData.data[offset] * 0.299 +
      imageData.data[offset + 1] * 0.587 +
      imageData.data[offset + 2] * 0.114;
  }

  return values;
}

function blurField(source: Float32Array, width: number, height: number, radius: number) {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += source[y * width + Math.max(0, Math.min(width - 1, x))];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      const removeX = Math.max(0, x - radius);
      const addX = Math.min(width - 1, x + radius + 1);
      sum += source[y * width + addX] - source[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / (radius * 2 + 1);
      const removeY = Math.max(0, y - radius);
      const addY = Math.min(height - 1, y + radius + 1);
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
    }
  }

  return output;
}

function createMap(
  source: ImageData,
  writePixel: (pixel: number, x: number, y: number, output: Uint8ClampedArray) => void,
) {
  const output = new ImageData(source.width, source.height);

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const pixel = y * source.width + x;
      writePixel(pixel, x, y, output.data);
      output.data[pixel * 4 + 3] = source.data[pixel * 4 + 3];
    }
  }

  return output;
}

function makeAsset(kind: MaterialMapKind, imageData: ImageData): MaterialMapAsset {
  return {
    kind,
    ...MAP_META[kind],
    imageData,
    url: imageDataToUrl(imageData),
  };
}

export function generateFabricMaterial(baseColor: ImageData): FabricMaterialAsset {
  const { width, height } = baseColor;
  const luminance = luminanceField(baseColor);
  const localAverage = blurField(luminance, width, height, 4);
  const broadAverage = blurField(luminance, width, height, 14);
  const heightField = new Float32Array(luminance.length);

  for (let pixel = 0; pixel < heightField.length; pixel += 1) {
    const fineTexture = luminance[pixel] - localAverage[pixel];
    const broadTexture = localAverage[pixel] - broadAverage[pixel];
    heightField[pixel] = clampByte(128 + fineTexture * 2.2 + broadTexture * 0.7);
  }

  const heightMap = createMap(baseColor, (pixel, _x, _y, output) => {
    const value = heightField[pixel];
    const offset = pixel * 4;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
  });

  const normalMap = createMap(baseColor, (pixel, x, y, output) => {
    const left = heightField[y * width + Math.max(0, x - 1)];
    const right = heightField[y * width + Math.min(width - 1, x + 1)];
    const up = heightField[Math.max(0, y - 1) * width + x];
    const down = heightField[Math.min(height - 1, y + 1) * width + x];
    const dx = (right - left) / 255;
    const dy = (down - up) / 255;
    const strength = 3.2;
    const nx = -dx * strength;
    const ny = dy * strength;
    const nz = 1;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const offset = pixel * 4;
    output[offset] = clampByte((nx / length * 0.5 + 0.5) * 255);
    output[offset + 1] = clampByte((ny / length * 0.5 + 0.5) * 255);
    output[offset + 2] = clampByte((nz / length * 0.5 + 0.5) * 255);
  });

  const roughnessMap = createMap(baseColor, (pixel, _x, _y, output) => {
    const microContrast = Math.abs(luminance[pixel] - localAverage[pixel]);
    const highlight = Math.max(0, luminance[pixel] - 185);
    const roughness = clampByte(205 + microContrast * 1.25 - highlight * 0.42);
    const offset = pixel * 4;
    output[offset] = roughness;
    output[offset + 1] = roughness;
    output[offset + 2] = roughness;
  });

  const baseColorCopy = new ImageData(
    new Uint8ClampedArray(baseColor.data),
    baseColor.width,
    baseColor.height,
  );

  return {
    width,
    height,
    maps: {
      baseColor: makeAsset("baseColor", baseColorCopy),
      normal: makeAsset("normal", normalMap),
      roughness: makeAsset("roughness", roughnessMap),
      height: makeAsset("height", heightMap),
    },
  };
}

export function materialMapEntries(material: FabricMaterialAsset) {
  return [
    material.maps.baseColor,
    material.maps.normal,
    material.maps.roughness,
    material.maps.height,
  ];
}
