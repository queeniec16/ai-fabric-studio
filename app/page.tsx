"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import {
  detectFabricLayers,
  FabricLayer,
  imageDataToUrl,
  loadFabricImage,
  maskToUrl,
  recolorFabric,
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
    setSegmentation(null);
    setResultUrl("");
    setFileName(file.name);

    try {
      const loaded = await loadFabricImage(file);
      setOriginalUrl(loaded.previewUrl);
      const detected = detectFabricLayers(loaded.imageData, layerCount);
      const colors = detected.layers.map((layer) => layer.sourceColor);
      setSegmentation(detected);
      setTargetColors(colors);
      setResultUrl(imageDataToUrl(loaded.imageData));
      setActiveLayer(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyze this fabric image.");
    } finally {
      setIsLoading(false);
    }
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
          <span className={hasFabric ? "current" : ""}>02 Detect Layers</span>
          <i />
          <span className={resultUrl ? "current" : ""}>03 Recolor</span>
          <i />
          <span>04 Export</span>
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

        {!segmentation || !originalUrl ? (
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
        ) : (
          <div className="workspace-grid">
            <div className="visual-column">
              <div className="panel-label">
                <span>Original Fabric</span>
                <button className="text-button" onClick={() => fileInputRef.current?.click()}>
                  Replace image
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
        )}

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
