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
  createOffsetPreview,
  createTiledPreview,
  detectRepeatArea,
  fixTileSeams,
  generateTileDraft,
  PatchMode,
  SeamlessOptions,
  SeamlessTextureAsset,
  TileMode,
  TileRepeat,
} from "@/lib/seamless-tile";

const MIN_REPEAT_SIZE = 0.16;
const QUALITY_WARNING_THRESHOLD = 84;

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
  const invalidateRef = useRef<() => void>(() => {});
  const [mode, setMode] = useState<TileMode>("manual");
  const [repeatRect, setRepeatRect] = useState<CropRect>({
    x: 0.12,
    y: 0.12,
    width: 0.5,
    height: 0.5,
  });
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [blendWidth, setBlendWidth] = useState(18);
  const [blendStrength, setBlendStrength] = useState(65);
  const [edgeColorMatch, setEdgeColorMatch] = useState(70);
  const [texturePreservation, setTexturePreservation] = useState(75);
  const [patchMode, setPatchMode] = useState<PatchMode>("clone");
  const [repeat, setRepeat] = useState<TileRepeat>(4);
  const [draft, setDraft] = useState<SeamlessTextureAsset | null>(null);
  const [showOffsetPreview, setShowOffsetPreview] = useState(false);
  const [comparison, setComparison] = useState<"before" | "after">("after");
  const [isGenerating, setIsGenerating] = useState(false);

  function invalidateTile() {
    setDraft(null);
    setShowOffsetPreview(false);
    onChange(null);
  }

  useEffect(() => {
    invalidateRef.current = invalidateTile;
  });

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      const stage = stageRef.current;
      if (!interaction || !stage) return;
      const bounds = stage.getBoundingClientRect();
      const dx = (event.clientX - interaction.pointerX) / bounds.width;
      const dy = (event.clientY - interaction.pointerY) / bounds.height;
      invalidateRef.current();

      if (interaction.mode === "move") {
        setRepeatRect({
          ...interaction.rect,
          x: clamp(interaction.rect.x + dx, 0, 1 - interaction.rect.width),
          y: clamp(interaction.rect.y + dy, 0, 1 - interaction.rect.height),
        });
      } else {
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
    invalidateTile();
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
      setDraft(generateTileDraft(source, mode, rect, offsetX, offsetY, seamlessOptions));
      setShowOffsetPreview(false);
      setComparison("before");
      onChange(null);
      setIsGenerating(false);
    }, 80);
  }

  function fixSeam() {
    if (!draft) return;
    setIsGenerating(true);
    window.setTimeout(() => {
      setDraft(fixTileSeams(draft, seamlessOptions));
      setShowOffsetPreview(true);
      setComparison("after");
      onChange(null);
      setIsGenerating(false);
    }, 80);
  }

  function confirmTile() {
    if (!draft?.fixed) return;
    onChange(draft);
  }

  const seamlessOptions: SeamlessOptions = {
    blendWidth,
    blendStrength,
    edgeColorMatch,
    texturePreservation,
    patchMode,
  };
  const comparisonImage = draft
    ? comparison === "before"
      ? draft.beforeImageData
      : draft.imageData
    : null;
  const tiledComparisonUrl = useMemo(
    () => (comparisonImage ? createTiledPreview(comparisonImage, repeat) : ""),
    [comparisonImage, repeat],
  );
  const offsetComparisonUrl = useMemo(
    () => (comparisonImage ? createOffsetPreview(comparisonImage) : ""),
    [comparisonImage],
  );
  const activePreviewUrl = showOffsetPreview ? offsetComparisonUrl : tiledComparisonUrl;
  const seamWarning = Boolean(draft && draft.seamQuality < QUALITY_WARNING_THRESHOLD);

  function invalidateFixedDraft() {
    if (!draft) return;
    setDraft({ ...draft, fixed: false });
    setComparison("before");
    onChange(null);
  }

  return (
    <section className="tile-studio">
      <div className="tile-heading">
        <div>
          <p className="section-kicker">SEAMLESS TEXTURE DEVELOPMENT</p>
          <h2>Generate Seamless Tile</h2>
          <p>
            Build and inspect a true textile repeat before PBR generation. Offset inspection moves
            border seams to the center so they can be patched and evaluated clearly.
          </p>
        </div>
        <span
          className={`tile-status ${
            asset ? "ready" : draft?.fixed && !seamWarning ? "fixed" : ""
          }`}
        >
          <i />{" "}
          {asset
            ? "Seamless tile confirmed"
            : draft?.fixed && seamWarning
              ? "Seam review required"
              : draft?.fixed
                ? "Ready to confirm"
                : "Required for PBR"}
        </span>
      </div>

      <div className="tile-mode-switch" aria-label="Tile generation mode">
        <button className={mode === "manual" ? "selected" : ""} onClick={() => selectMode("manual")}>
          <strong>Manual Tile Mode</strong>
          <span>Select repeat area and tune alignment</span>
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
                  invalidateTile();
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
                  invalidateTile();
                }}
              />
            </label>
            <label className="seam-strength-control">
              <span>Blend Width <strong>{blendWidth}%</strong></span>
              <input
                type="range"
                min="5"
                max="40"
                value={blendWidth}
                onChange={(event) => {
                  setBlendWidth(Number(event.target.value));
                  invalidateFixedDraft();
                }}
              />
            </label>
            <label>
              <span>Seam Blend Strength <strong>{blendStrength}%</strong></span>
              <input
                type="range"
                min="0"
                max="100"
                value={blendStrength}
                onChange={(event) => {
                  setBlendStrength(Number(event.target.value));
                  invalidateFixedDraft();
                }}
              />
            </label>
            <label>
              <span>Edge Color Match <strong>{edgeColorMatch}%</strong></span>
              <input
                type="range"
                min="0"
                max="100"
                value={edgeColorMatch}
                onChange={(event) => {
                  setEdgeColorMatch(Number(event.target.value));
                  invalidateFixedDraft();
                }}
              />
            </label>
            <label>
              <span>Texture Preservation <strong>{texturePreservation}%</strong></span>
              <input
                type="range"
                min="0"
                max="100"
                value={texturePreservation}
                onChange={(event) => {
                  setTexturePreservation(Number(event.target.value));
                  invalidateFixedDraft();
                }}
              />
            </label>
            <div className="patch-mode-control">
              <span className="tile-control-label">Patch mode</span>
              <div className="viewer-segmented">
                {(["clone", "mirror"] as PatchMode[]).map((value) => (
                  <button
                    key={value}
                    className={patchMode === value ? "selected" : ""}
                    onClick={() => {
                      setPatchMode(value);
                      invalidateFixedDraft();
                    }}
                  >
                    {value === "clone" ? "Clone Patch" : "Mirror Patch"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="tile-method-note">
            <strong>{mode === "manual" ? "Designer controlled repeat" : "Image-based repeat detection"}</strong>
            <p>
              Generate the repeat, inspect its centered seams, then use Fix Seam before confirming
              the texture for PBR generation.
            </p>
          </div>
          <div className="tile-action-stack">
            <button className="create-tile-button" onClick={generate} disabled={isGenerating}>
              {isGenerating ? "Processing Texture..." : mode === "manual" ? "Generate Tile" : "Generate AI Tile"}
            </button>
            <button
              className="offset-preview-button"
              onClick={() => setShowOffsetPreview((current) => !current)}
              disabled={!draft}
            >
              {showOffsetPreview ? "Show Repeat Preview" : "Offset Preview 50%"}
            </button>
            <button className="fix-seam-button" onClick={fixSeam} disabled={!draft || isGenerating}>
              Fix Seam
            </button>
          </div>
        </aside>

        <div>
          <div className="panel-label">
            <span>{showOffsetPreview ? "50% Offset Seam Inspection" : "Tile Quality Preview"}</span>
            <div className="tile-preview-controls">
              {draft && (
                <div className="before-after-toggle">
                  <button
                    className={comparison === "before" ? "selected" : ""}
                    onClick={() => setComparison("before")}
                  >
                    Before
                  </button>
                  <button
                    className={comparison === "after" ? "selected" : ""}
                    onClick={() => setComparison("after")}
                    disabled={!draft.fixed}
                  >
                    After
                  </button>
                </div>
              )}
              {!showOffsetPreview && (
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
              )}
            </div>
          </div>
          <div className={`tile-preview-stage ${draft ? "" : "empty"} ${showOffsetPreview ? "offset" : ""}`}>
            {draft ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activePreviewUrl}
                  alt={
                    showOffsetPreview
                      ? "50 percent offset seam inspection"
                      : `${repeat} by ${repeat} seamless fabric repeat preview`
                  }
                />
                {showOffsetPreview && <span className="offset-crosshair" />}
              </>
            ) : (
              <div>
                <span className="tile-preview-grid" />
                <strong>Generate a tile to begin seam inspection</strong>
                <p>Then offset, patch, and inspect the result at multiple repeat scales.</p>
              </div>
            )}
          </div>

          {draft && (
            <div className={`seam-quality ${seamWarning ? "warning" : "pass"}`}>
              <div>
                <span>Seam quality estimate</span>
                <strong>{draft.seamQuality}/100</strong>
              </div>
              <div className="seam-quality-track">
                <i style={{ width: `${draft.seamQuality}%` }} />
              </div>
              {seamWarning ? (
                <p>Seam may still be visible. Try adjusting repeat area or increasing blend strength.</p>
              ) : (
                <p>Border continuity looks suitable for repeat preview. Inspect motifs before confirming.</p>
              )}
            </div>
          )}

          <button
            className="confirm-tile-button"
            onClick={confirmTile}
            disabled={!draft?.fixed || seamWarning || Boolean(asset && asset === draft)}
          >
            {asset && asset === draft ? "Seamless Tile Confirmed" : "Confirm Seamless Tile"}
          </button>
        </div>
      </div>
    </section>
  );
}
