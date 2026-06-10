"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cropFabricImage,
  CropRect,
  detectFabricLayers,
  FabricLayer,
  imageDataToUrl,
  loadFabricImage,
  maskToUrl,
  recolorFabric,
  selectPolygonFabric,
  SelectionPoint,
  SegmentationResult,
} from "@/lib/fabric-segmentation";

type IconProps = { className?: string };

function UploadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V3m0 0 4.5 4.5M12 3 7.5 7.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

function SparkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 .9 3.2a6.9 6.9 0 0 0 4.8 4.8l3.3 1-3.3.9a6.9 6.9 0 0 0-4.8 4.8L12 21l-.9-3.3a6.9 6.9 0 0 0-4.8-4.8L3 12l3.3-1a6.9 6.9 0 0 0 4.8-4.8L12 3Z" />
    </svg>
  );
}

function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
    </svg>
  );
}

function ResetIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6" />
    </svg>
  );
}

function CropIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12" />
    </svg>
  );
}

type CropInteraction = {
  mode: "move" | "nw" | "ne" | "sw" | "se";
  pointerX: number;
  pointerY: number;
  crop: CropRect;
};

type SelectionMode = "rectangle" | "polygon";

type PointInteraction = {
  index: number;
};

const MIN_CROP_SIZE = 0.12;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function CropEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  selectionMode,
  onSelectionModeChange,
  crop,
  onChange,
  polygonPoints,
  onPolygonPointsChange,
  onConfirm,
  onReplace,
  isLoading,
}: {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  selectionMode: SelectionMode;
  onSelectionModeChange: (mode: SelectionMode) => void;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
  polygonPoints: SelectionPoint[];
  onPolygonPointsChange: (points: SelectionPoint[]) => void;
  onConfirm: () => void;
  onReplace: () => void;
  isLoading: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<CropInteraction | null>(null);
  const pointInteractionRef = useRef<PointInteraction | null>(null);

  function startInteraction(
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    mode: CropInteraction["mode"],
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      crop: { ...crop },
    };
  }

  function updateInteraction(event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) {
    const interaction = interactionRef.current;
    const stage = stageRef.current;
    if (!interaction || !stage) return;

    const bounds = stage.getBoundingClientRect();
    const deltaX = (event.clientX - interaction.pointerX) / bounds.width;
    const deltaY = (event.clientY - interaction.pointerY) / bounds.height;
    const start = interaction.crop;

    if (interaction.mode === "move") {
      onChange({
        ...start,
        x: clamp(start.x + deltaX, 0, 1 - start.width),
        y: clamp(start.y + deltaY, 0, 1 - start.height),
      });
      return;
    }

    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;

    if (interaction.mode.includes("w")) {
      left = clamp(start.x + deltaX, 0, right - MIN_CROP_SIZE);
    }
    if (interaction.mode.includes("e")) {
      right = clamp(right + deltaX, left + MIN_CROP_SIZE, 1);
    }
    if (interaction.mode.includes("n")) {
      top = clamp(start.y + deltaY, 0, bottom - MIN_CROP_SIZE);
    }
    if (interaction.mode.includes("s")) {
      bottom = clamp(bottom + deltaY, top + MIN_CROP_SIZE, 1);
    }

    onChange({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }

  function stopInteraction(event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interactionRef.current = null;
  }

  function updateZoom(value: number) {
    const size = clamp(value / 100, MIN_CROP_SIZE, 1);
    const aspect = crop.width / crop.height;
    let width = size;
    let height = size;

    if (aspect > 1) {
      height = size / aspect;
    } else {
      width = size * aspect;
    }

    width = clamp(width, MIN_CROP_SIZE, 1);
    height = clamp(height, MIN_CROP_SIZE, 1);
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;

    onChange({
      x: clamp(centerX - width / 2, 0, 1 - width),
      y: clamp(centerY - height / 2, 0, 1 - height),
      width,
      height,
    });
  }

  function getNormalizedPoint(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return null;
    const bounds = stage.getBoundingClientRect();
    return {
      x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  function addPolygonPoint(event: ReactPointerEvent<HTMLDivElement>) {
    if (selectionMode !== "polygon" || pointInteractionRef.current) return;
    if (event.target !== event.currentTarget && (event.target as HTMLElement).tagName !== "IMG") return;
    const point = getNormalizedPoint(event.clientX, event.clientY);
    if (point) onPolygonPointsChange([...polygonPoints, point]);
  }

  function startPointDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointInteractionRef.current = { index };
  }

  function updatePointDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const interaction = pointInteractionRef.current;
    if (!interaction) return;
    const point = getNormalizedPoint(event.clientX, event.clientY);
    if (!point) return;
    onPolygonPointsChange(
      polygonPoints.map((current, index) => (index === interaction.index ? point : current)),
    );
  }

  function stopPointDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointInteractionRef.current = null;
  }

  const zoomValue = Math.round(Math.max(crop.width, crop.height) * 100);
  const polygonBounds = polygonPoints.length
    ? {
        width:
          (Math.max(...polygonPoints.map((point) => point.x)) -
            Math.min(...polygonPoints.map((point) => point.x))) *
          imageWidth,
        height:
          (Math.max(...polygonPoints.map((point) => point.y)) -
            Math.min(...polygonPoints.map((point) => point.y))) *
          imageHeight,
      }
    : { width: 0, height: 0 };
  const polygonPath = polygonPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
  const canConfirm = selectionMode === "rectangle" || polygonPoints.length >= 3;

  return (
    <div className="crop-workspace">
      <div className="crop-intro">
        <div>
          <p className="section-kicker">FABRIC AREA SELECTION</p>
          <h3>Crop / Select Fabric Area</h3>
          <p>
            Exclude labels, hands, table surfaces, and shadows. Only the selected textile area
            will be analyzed for fabric layers.
          </p>
        </div>
        <button className="text-button" onClick={onReplace}>Replace image</button>
      </div>

      <div className="crop-layout">
        <div
          ref={stageRef}
          className={`crop-stage ${selectionMode === "polygon" ? "polygon-mode" : ""}`}
          style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
          onPointerDown={addPolygonPoint}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Uploaded fabric photo ready for cropping" draggable={false} />
          {selectionMode === "rectangle" ? (
            <>
              <div className="crop-shade crop-shade-top" style={{ height: `${crop.y * 100}%` }} />
              <div
                className="crop-shade crop-shade-left"
                style={{
                  top: `${crop.y * 100}%`,
                  width: `${crop.x * 100}%`,
                  height: `${crop.height * 100}%`,
                }}
              />
              <div
                className="crop-shade crop-shade-right"
                style={{
                  top: `${crop.y * 100}%`,
                  left: `${(crop.x + crop.width) * 100}%`,
                  right: 0,
                  height: `${crop.height * 100}%`,
                }}
              />
              <div
                className="crop-shade crop-shade-bottom"
                style={{ top: `${(crop.y + crop.height) * 100}%` }}
              />
              <div
                className="crop-box"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`,
                }}
                onPointerDown={(event) => startInteraction(event, "move")}
                onPointerMove={updateInteraction}
                onPointerUp={stopInteraction}
                onPointerCancel={stopInteraction}
              >
                <span className="crop-grid vertical first" />
                <span className="crop-grid vertical second" />
                <span className="crop-grid horizontal first" />
                <span className="crop-grid horizontal second" />
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <button
                    key={corner}
                    className={`crop-handle ${corner}`}
                    aria-label={`Resize crop ${corner}`}
                    onPointerDown={(event) => startInteraction(event, corner)}
                    onPointerMove={updateInteraction}
                    onPointerUp={stopInteraction}
                    onPointerCancel={stopInteraction}
                  />
                ))}
                <span className="crop-move-label">Drag to position fabric area</span>
              </div>
            </>
          ) : (
            <>
              <svg className="polygon-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <mask id="fabric-polygon-mask">
                    <rect width="100" height="100" fill="white" />
                    {polygonPoints.length >= 3 && <polygon points={polygonPath} fill="black" />}
                  </mask>
                </defs>
                <rect width="100" height="100" className="polygon-shade" mask="url(#fabric-polygon-mask)" />
                {polygonPoints.length >= 2 && (
                  <polyline points={polygonPath} className="polygon-line" />
                )}
                {polygonPoints.length >= 3 && (
                  <line
                    x1={polygonPoints[polygonPoints.length - 1].x * 100}
                    y1={polygonPoints[polygonPoints.length - 1].y * 100}
                    x2={polygonPoints[0].x * 100}
                    y2={polygonPoints[0].y * 100}
                    className="polygon-closing-line"
                  />
                )}
              </svg>
              {polygonPoints.map((point, index) => (
                <button
                  key={index}
                  className="polygon-point"
                  style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  aria-label={`Adjust polygon point ${index + 1}`}
                  onPointerDown={(event) => startPointDrag(event, index)}
                  onPointerMove={updatePointDrag}
                  onPointerUp={stopPointDrag}
                  onPointerCancel={stopPointDrag}
                >
                  <span>{index + 1}</span>
                </button>
              ))}
              {polygonPoints.length === 0 && (
                <span className="polygon-empty-message">Click around the fabric boundary to add points</span>
              )}
            </>
          )}
        </div>

        <aside className="crop-controls">
          <div>
            <p className="crop-control-label">Selection method</p>
            <div className="selection-mode-control">
              <button
                className={selectionMode === "rectangle" ? "selected" : ""}
                onClick={() => onSelectionModeChange("rectangle")}
              >
                Rectangle
              </button>
              <button
                className={selectionMode === "polygon" ? "selected" : ""}
                onClick={() => onSelectionModeChange("polygon")}
              >
                Polygon
              </button>
            </div>
          </div>

          <div>
            <p className="crop-control-label">
              {selectionMode === "rectangle" ? "Selection size" : "Boundary points"}
            </p>
            {selectionMode === "rectangle" ? (
              <div className="crop-zoom-row">
                <span>Zoom</span>
                <input
                  type="range"
                  min="12"
                  max="100"
                  value={zoomValue}
                  onChange={(event) => updateZoom(Number(event.target.value))}
                  aria-label="Crop zoom"
                />
                <strong>{zoomValue}%</strong>
              </div>
            ) : (
              <div className="polygon-actions">
                <span>{polygonPoints.length} points</span>
                <button
                  onClick={() => onPolygonPointsChange(polygonPoints.slice(0, -1))}
                  disabled={!polygonPoints.length}
                >
                  Undo Last
                </button>
                <button
                  onClick={() => onPolygonPointsChange([])}
                  disabled={!polygonPoints.length}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="crop-guidance">
            <span className="weave-icon" />
            <p>
              <strong>Choose textile only</strong>
              {selectionMode === "rectangle"
                ? "Keep the crop inside the physical fabric whenever possible."
                : "Add points around the real fabric edge, then drag any point to refine it."}
            </p>
          </div>

          <div className="crop-dimensions">
            <span>Analysis area</span>
            <strong>
              {selectionMode === "rectangle"
                ? `${Math.round(imageWidth * crop.width)} × ${Math.round(imageHeight * crop.height)} px`
                : polygonPoints.length >= 3
                  ? `${Math.round(polygonBounds.width)} × ${Math.round(polygonBounds.height)} px`
                  : "Add 3+ points"}
            </strong>
          </div>

          <button
            className="confirm-crop-button"
            onClick={onConfirm}
            disabled={isLoading || !canConfirm}
          >
            <CropIcon />
            {isLoading ? "Preparing Fabric..." : "Confirm Fabric Area"}
          </button>
        </aside>
      </div>
    </div>
  );
}

function LayerPreview({
  layer,
  width,
  height,
  active,
  onClick,
}: {
  layer: FabricLayer;
  width: number;
  height: number;
  active: boolean;
  onClick: () => void;
}) {
  const preview = useMemo(
    () => maskToUrl(layer.mask, width, height, layer.sourceColor),
    [height, layer.mask, layer.sourceColor, width],
  );

  return (
    <button className={`layer-card ${active ? "active" : ""}`} onClick={onClick}>
      <span className="layer-mask" style={{ backgroundImage: `url(${preview})` }} />
      <span className="layer-copy">
        <span className="layer-name">{layer.name}</span>
        <span className="layer-description">{layer.description}</span>
      </span>
      <span className="coverage">{layer.coverage.toFixed(0)}%</span>
    </button>
  );
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function createSampleFabric() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");

  context.fillStyle = "#d5b98c";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.globalAlpha = 0.2;
  context.strokeStyle = "#765f45";
  context.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 7) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  context.strokeStyle = "#f0dfbc";
  for (let y = 0; y < canvas.height; y += 7) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  context.globalAlpha = 1;

  for (let x = 38; x < canvas.width; x += 180) {
    context.fillStyle = "#294c47";
    context.fillRect(x, 0, 25, canvas.height);
    context.fillStyle = "#f1e5c9";
    context.fillRect(x + 34, 0, 8, canvas.height);
  }

  context.fillStyle = "#a94f3f";
  for (let y = 65; y < canvas.height; y += 210) {
    for (let x = 120; x < canvas.width; x += 210) {
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.fillRect(-31, -31, 62, 62);
      context.restore();
      context.fillStyle = "#efe0bd";
      context.beginPath();
      context.arc(x, y, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#a94f3f";
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Could not create sample."))), "image/png");
  });

  return new File([blob], "textile-stripe-motif-sample.png", { type: "image/png" });
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [uploadedImage, setUploadedImage] = useState<ImageData | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("rectangle");
  const [crop, setCrop] = useState<CropRect>({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
  const [polygonPoints, setPolygonPoints] = useState<SelectionPoint[]>([]);
  const [originalUrl, setOriginalUrl] = useState("");
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [targetColors, setTargetColors] = useState<string[]>([]);
  const [layerCount, setLayerCount] = useState(4);
  const [activeLayer, setActiveLayer] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function processFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please upload a PNG, JPG, or WebP fabric image.");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setError("Please choose an image smaller than 15 MB.");
      return;
    }

    setIsLoading(true);
    setError("");
    setUploadedUrl("");
    setUploadedImage(null);
    setSelectionMode("rectangle");
    setCrop({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
    setPolygonPoints([]);
    setSegmentation(null);
    setResultUrl("");
    setFileName(file.name);

    try {
      const loaded = await loadFabricImage(file);
      setUploadedUrl(loaded.previewUrl);
      setUploadedImage(loaded.imageData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyze this fabric image.");
    } finally {
      setIsLoading(false);
    }
  }

  function confirmCrop() {
    if (!uploadedImage) return;
    setIsLoading(true);
    setError("");

    window.setTimeout(() => {
      try {
        const selectedFabric =
          selectionMode === "rectangle"
            ? cropFabricImage(uploadedImage, crop)
            : selectPolygonFabric(uploadedImage, polygonPoints);
        const detected = detectFabricLayers(selectedFabric, layerCount);
        const colors = detected.layers.map((layer) => layer.sourceColor);
        const selectedUrl = imageDataToUrl(selectedFabric);
        setOriginalUrl(selectedUrl);
        setSegmentation(detected);
        setTargetColors(colors);
        setResultUrl(selectedUrl);
        setActiveLayer(0);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not crop this fabric image.");
      } finally {
        setIsLoading(false);
      }
    }, 60);
  }

  function editCrop() {
    setSegmentation(null);
    setOriginalUrl("");
    setResultUrl("");
    setTargetColors([]);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  async function loadSampleFabric() {
    setIsLoading(true);
    try {
      const sample = await createSampleFabric();
      await processFile(sample);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the sample fabric.");
      setIsLoading(false);
    }
  }

  function redetectLayers() {
    if (!segmentation) return;
    setIsLoading(true);
    window.setTimeout(() => {
      try {
        const detected = detectFabricLayers(segmentation.original, layerCount);
        const colors = detected.layers.map((layer) => layer.sourceColor);
        setSegmentation(detected);
        setTargetColors(colors);
        setResultUrl(imageDataToUrl(detected.original));
        setActiveLayer(0);
      } finally {
        setIsLoading(false);
      }
    }, 80);
  }

  function updateColor(index: number, color: string) {
    setTargetColors((current) => current.map((value, itemIndex) => (itemIndex === index ? color : value)));
  }

  function applyColors() {
    if (!segmentation) return;
    setResultUrl(imageDataToUrl(recolorFabric(segmentation, targetColors)));
  }

  function resetColors() {
    if (!segmentation) return;
    const colors = segmentation.layers.map((layer) => layer.sourceColor);
    setTargetColors(colors);
    setResultUrl(imageDataToUrl(segmentation.original));
  }

  function downloadResult() {
    if (!resultUrl) return;
    const link = document.createElement("a");
    const baseName = fileName.replace(/\.[^/.]+$/, "") || "fabric";
    link.download = `${baseName}-recolor.png`;
    link.href = resultUrl;
    link.click();
  }

  const isCropping = Boolean(uploadedUrl && uploadedImage && !segmentation);
  const hasFabric = Boolean(originalUrl && segmentation);

  return (
    <main>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>AI Fabric Studio</strong>
            <small>Layer Recolor Lab</small>
          </span>
        </div>
        <div className="prototype-badge"><span /> Local MVP</div>
      </header>

      <section className="hero">
        <p className="eyebrow">TEXTILE COLOR DEVELOPMENT</p>
        <h1>Recolor the structure.<br />Preserve the fabric.</h1>
        <p className="hero-copy">
          Detect ground, motif, and woven color regions from a fabric image, then develop new
          colorways while retaining the original textile texture.
        </p>
        <div className="workflow-line">
          <span className="current">01 Upload</span>
          <i />
          <span className={isCropping || hasFabric ? "current" : ""}>02 Select Area</span>
          <i />
          <span className={hasFabric ? "current" : ""}>03 Detect Layers</span>
          <i />
          <span className={resultUrl ? "current" : ""}>04 Recolor</span>
          <i />
          <span>05 Export</span>
        </div>
      </section>

      <section className={`studio-shell ${hasFabric ? "has-fabric" : ""}`}>
        <div className="studio-heading">
          <div>
            <p className="section-kicker">FABRIC INPUT</p>
            <h2>Upload Fabric</h2>
          </div>
          {fileName && <p className="file-name">{fileName}</p>}
        </div>

        {!uploadedImage || !uploadedUrl ? (
          <div
            className={`upload-zone ${isDragging ? "dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="upload-icon-wrap"><UploadIcon /></div>
            <h3>{isLoading ? "Reading textile color structure..." : "Drop your fabric image here"}</h3>
            <p>Use a clear, front-facing image or scan of the textile surface.</p>
            <button className="primary-button" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
              <UploadIcon />
              Choose Fabric Image
            </button>
            <button className="sample-button" onClick={() => void loadSampleFabric()} disabled={isLoading}>
              Try sample fabric
            </button>
            <span className="upload-meta">PNG, JPG or WebP · up to 15 MB</span>
          </div>
        ) : isCropping ? (
          <CropEditor
            imageUrl={uploadedUrl}
            imageWidth={uploadedImage.width}
            imageHeight={uploadedImage.height}
            selectionMode={selectionMode}
            onSelectionModeChange={setSelectionMode}
            crop={crop}
            onChange={setCrop}
            polygonPoints={polygonPoints}
            onPolygonPointsChange={setPolygonPoints}
            onConfirm={confirmCrop}
            onReplace={() => fileInputRef.current?.click()}
            isLoading={isLoading}
          />
        ) : segmentation && originalUrl ? (
          <div className="workspace-grid">
            <div className="visual-column">
              <div className="panel-label">
                <span>Original Fabric</span>
                <button className="text-button" onClick={editCrop}>
                  Edit crop
                </button>
              </div>
              <div className="fabric-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={originalUrl} alt="Original uploaded fabric" />
                <span className="image-tag">SOURCE</span>
              </div>
              <div className="source-note">
                <span className="weave-icon" />
                <p><strong>Texture protected</strong>Original luminance and surface variation remain in the recolored output.</p>
              </div>
            </div>

            <div className="controls-column">
              <div className="panel-label">
                <span>Detected Fabric Layers</span>
                <span className="layer-total">{segmentation.layers.length} layers</span>
              </div>

              <div className="detection-control">
                <label htmlFor="layer-count">Color structures to detect</label>
                <div className="segmented-control">
                  {[2, 3, 4].map((count) => (
                    <button
                      key={count}
                      className={layerCount === count ? "selected" : ""}
                      onClick={() => setLayerCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <button className="detect-button" onClick={redetectLayers} disabled={isLoading}>
                  <SparkIcon />
                  {isLoading ? "Analyzing..." : "Detect Fabric Layers"}
                </button>
              </div>

              <div className="layer-list">
                {segmentation.layers.map((layer, index) => (
                  <LayerPreview
                    key={`${layer.id}-${layer.sourceColor}`}
                    layer={layer}
                    width={segmentation.width}
                    height={segmentation.height}
                    active={activeLayer === index}
                    onClick={() => setActiveLayer(index)}
                  />
                ))}
              </div>

              <div className="colorway-panel">
                <div className="colorway-heading">
                  <div>
                    <p>COLORWAY CONTROLS</p>
                    <h3>Fabric Layer Recolor</h3>
                  </div>
                  <button className="icon-button" onClick={resetColors} title="Reset original colors">
                    <ResetIcon />
                  </button>
                </div>
                <div className="color-controls">
                  {segmentation.layers.map((layer, index) => (
                    <label
                      className={`color-control ${activeLayer === index ? "active" : ""}`}
                      key={layer.id}
                      onClick={() => setActiveLayer(index)}
                    >
                      <span>
                        <strong>{index === 0 ? "Base Color" : index === 1 ? "Pattern Color" : layer.name}</strong>
                        <small>{targetColors[index]?.toUpperCase()}</small>
                      </span>
                      <span className="color-input-shell" style={{ backgroundColor: targetColors[index] }}>
                        <input
                          type="color"
                          value={targetColors[index]}
                          onChange={(event) => updateColor(index, event.target.value)}
                          aria-label={`Choose ${layer.name} color`}
                        />
                      </span>
                    </label>
                  ))}
                </div>
                <button className="apply-button" onClick={applyColors}>
                  <SparkIcon />
                  Apply Color
                </button>
              </div>
            </div>

            <div className="visual-column result-column">
              <div className="panel-label">
                <span>Colorway Result</span>
                <span className="result-status"><i /> Live preview</span>
              </div>
              <div className="fabric-frame result-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resultUrl} alt="Recolored fabric result" />
                <span className="image-tag dark">COLORWAY 01</span>
              </div>
              <button className="download-button" onClick={downloadResult}>
                <DownloadIcon />
                Download PNG
              </button>
              <p className="export-note">Exports at analyzed resolution · transparent-safe PNG</p>
            </div>
          </div>
        ) : null}

        {error && <p className="error-message">{error}</p>}
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
        />
      </section>

      <footer>
        <span>AI Fabric Studio · Local Prototype</span>
        <span>Color-based segmentation engine · SAM-ready architecture</span>
      </footer>
    </main>
  );
}
