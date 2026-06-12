"use client";

import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CropRect } from "@/lib/fabric-segmentation";
import {
  createTiledPreview,
  detectRepeatArea,
  generateSeamlessTexture,
  SeamlessTextureAsset,
  TileMode,
  TileRepeat,
} from "@/lib/seamless-tile";

const MIN_REPEAT_SIZE = 0.16;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

type Interaction = {
  mode: "move" | "resize";
  pointerX: number;
  pointerY: number;
  rect: CropRect;
};

export default function TileStudio({
  source,
  sourceUrl,
  asset,
  onChange,
}: {
  source: ImageData;
  sourceUrl: string;
  asset: SeamlessTextureAsset | null;
  onChange: (asset: SeamlessTextureAsset | null) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const onChangeRef = useRef(onChange);
  const [mode, setMode] = useState<TileMode>("manual");
  const [repeatRect, setRepeatRect] = useState<CropRect>({
    x: 0.12,
    y: 0.12,
    width: 0.5,
    height: 0.5,
  });
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [repeat, setRepeat] = useState<TileRepeat>(4);
  const [isGenerating, setIsGenerating] = useState(false);

  const previewUrl = useMemo(
    () => (asset ? createTiledPreview(asset.imageData, repeat) : ""),
    [asset, repeat],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      const stage = stageRef.current;
      if (!interaction || !stage) return;
      const bounds = stage.getBoundingClientRect();
      const dx = (event.clientX - interaction.pointerX) / bounds.width;
      const dy = (event.clientY - interaction.pointerY) / bounds.height;

      if (interaction.mode === "move") {
        onChangeRef.current(null);
        setRepeatRect({
          ...interaction.rect,
          x: clamp(interaction.rect.x + dx, 0, 1 - interaction.rect.width),
          y: clamp(interaction.rect.y + dy, 0, 1 - interaction.rect.height),
        });
      } else {
        onChangeRef.current(null);
        setRepeatRect({
          ...interaction.rect,
          width: clamp(interaction.rect.width + dx, MIN_REPEAT_SIZE, 1 - interaction.rect.x),
          height: clamp(interaction.rect.height + dy, MIN_REPEAT_SIZE, 1 - interaction.rect.y),
        });
      }
    };
    const end = () => {
      interactionRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, []);

  function beginInteraction(event: ReactPointerEvent, interactionMode: Interaction["mode"]) {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      mode: interactionMode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect: { ...repeatRect },
    };
  }

  function selectMode(nextMode: TileMode) {
    setMode(nextMode);
    onChange(null);
    if (nextMode === "ai") {
      setRepeatRect(detectRepeatArea(source));
      setOffsetX(50);
      setOffsetY(50);
    }
  }

  function generate() {
    setIsGenerating(true);
    window.setTimeout(() => {
      const rect = mode === "ai" ? detectRepeatArea(source) : repeatRect;
      if (mode === "ai") setRepeatRect(rect);
      onChange(generateSeamlessTexture(source, mode, rect, offsetX, offsetY));
      setIsGenerating(false);
    }, 80);
  }

  return (
    <section className="tile-studio">
      <div className="tile-heading">
        <div>
          <p className="section-kicker">SEAMLESS TEXTURE DEVELOPMENT</p>
          <h2>Generate Seamless Tile</h2>
          <p>
            Define the textile repeat before PBR generation. Edge blending removes visible seams
            while preserving pattern rhythm and yarn detail.
          </p>
        </div>
        <span className={`tile-status ${asset ? "ready" : ""}`}>
          <i /> {asset ? "Tile ready" : "Required for PBR"}
        </span>
      </div>

      <div className="tile-mode-switch" aria-label="Tile generation mode">
        <button className={mode === "manual" ? "selected" : ""} onClick={() => selectMode("manual")}>
          <strong>Manual Tile Mode</strong>
          <span>Select repeat area and tune offset</span>
        </button>
        <button className={mode === "ai" ? "selected" : ""} onClick={() => selectMode("ai")}>
          <strong>AI Tile Mode</strong>
          <span>Estimate pattern repeat automatically</span>
        </button>
      </div>

      <div className="tile-workspace">
        <div>
          <div className="panel-label">
            <span>{mode === "manual" ? "Repeat Area Selection" : "AI Detected Repeat"}</span>
            <span className="layer-total">
              {Math.round(repeatRect.width * source.width)} × {Math.round(repeatRect.height * source.height)}px
            </span>
          </div>
          <div
            className="tile-source-stage"
            ref={stageRef}
            style={{ aspectRatio: `${source.width} / ${source.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceUrl} alt="Recolored textile for repeat selection" draggable={false} />
            <div
              className="tile-repeat-box"
              style={{
                left: `${repeatRect.x * 100}%`,
                top: `${repeatRect.y * 100}%`,
                width: `${repeatRect.width * 100}%`,
                height: `${repeatRect.height * 100}%`,
              }}
              onPointerDown={(event) => mode === "manual" && beginInteraction(event, "move")}
            >
              <span>FABRIC REPEAT</span>
              {mode === "manual" && (
                <button
                  className="tile-resize-handle"
                  aria-label="Resize repeat area"
                  onPointerDown={(event) => beginInteraction(event, "resize")}
                />
              )}
            </div>
          </div>
        </div>

        <aside className="tile-controls">
          <div>
            <p className="tile-control-label">Repeat alignment</p>
            <label>
              <span>X offset <strong>{offsetX}%</strong></span>
              <input
                type="range"
                min="-50"
                max="50"
                value={offsetX}
                onChange={(event) => {
                  setOffsetX(Number(event.target.value));
                  onChange(null);
                }}
              />
            </label>
            <label>
              <span>Y offset <strong>{offsetY}%</strong></span>
              <input
                type="range"
                min="-50"
                max="50"
                value={offsetY}
                onChange={(event) => {
                  setOffsetY(Number(event.target.value));
                  onChange(null);
                }}
              />
            </label>
          </div>
          <div className="tile-method-note">
            <strong>{mode === "manual" ? "Designer controlled repeat" : "Image-based repeat detection"}</strong>
            <p>
              {mode === "manual"
                ? "Move and resize the repeat box, then shift the wrap point away from key motifs."
                : "The MVP estimates horizontal and vertical periods using texture autocorrelation."}
            </p>
          </div>
          <button className="create-tile-button" onClick={generate} disabled={isGenerating}>
            {isGenerating ? "Building Seamless Texture..." : mode === "manual" ? "Create Manual Tile" : "Generate AI Tile"}
          </button>
        </aside>

        <div>
          <div className="panel-label">
            <span>Tiled Fabric Preview</span>
            <div className="tile-repeat-options">
              {([2, 4, 8] as TileRepeat[]).map((count) => (
                <button
                  key={count}
                  className={repeat === count ? "selected" : ""}
                  onClick={() => setRepeat(count)}
                >
                  {count}×{count}
                </button>
              ))}
            </div>
          </div>
          <div className={`tile-preview-stage ${asset ? "" : "empty"}`}>
            {asset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={`${repeat} by ${repeat} seamless fabric repeat preview`} />
            ) : (
              <div>
                <span className="tile-preview-grid" />
                <strong>Generate a tile to inspect repeat continuity</strong>
                <p>Check motif spacing and edge transitions at 2×2, 4×4, or 8×8.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
