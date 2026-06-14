"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { FabricMaterialAsset } from "@/lib/material-generation";

type PreviewGeometry = "sphere" | "plane";
type PreviewView = "closeup" | "full";
type TextureRepeat = 1 | 2 | 4 | 8 | 16;
type MaterialScale = 10 | 25 | 50 | 100;

export default function MaterialViewer({ material }: { material: FabricMaterialAsset }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<PreviewGeometry>("sphere");
  const [view, setView] = useState<PreviewView>("full");
  const [textureRepeat, setTextureRepeat] = useState<TextureRepeat>(4);
  const [materialScale, setMaterialScale] = useState<MaterialScale>(50);
  const [lightIntensity, setLightIntensity] = useState(1.1);
  const [autoRotate, setAutoRotate] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8e4da");

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const cameraDistance =
      view === "closeup"
        ? geometry === "sphere"
          ? 3.55
          : 4
        : geometry === "sphere"
          ? 6.25
          : 6.8;
    camera.position.set(0, 0.25, cameraDistance);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;

    const textureLoader = new THREE.TextureLoader();
    const colorMap = textureLoader.load(material.maps.baseColor.url);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    const normalMap = textureLoader.load(material.maps.normal.url);
    const roughnessMap = textureLoader.load(material.maps.roughness.url);
    const displacementMap = textureLoader.load(material.maps.height.url);
    const metalnessMap = textureLoader.load(material.maps.metallic.url);
    const alphaMap = textureLoader.load(material.maps.alpha.url);
    const physicalScaleMultiplier = materialScale / 25;
    const effectiveRepeat = textureRepeat * physicalScaleMultiplier;
    [colorMap, normalMap, roughnessMap, displacementMap, metalnessMap, alphaMap].forEach((texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(effectiveRepeat, effectiveRepeat);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });

    const materialAspect = material.width / material.height;
    const planeWidth = materialAspect >= 1 ? 3.35 : 3.35 * materialAspect;
    const planeHeight = materialAspect >= 1 ? 3.35 / materialAspect : 3.35;
    const geometryObject =
      geometry === "sphere"
        ? new THREE.SphereGeometry(1.45, 128, 96)
        : new THREE.PlaneGeometry(planeWidth, planeHeight, 180, 180);

    const fabricMaterial = new THREE.MeshPhysicalMaterial({
      map: colorMap,
      normalMap,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughnessMap,
      roughness: 0.88,
      metalnessMap,
      metalness: 1,
      displacementMap,
      displacementScale: geometry === "sphere" ? 0.035 : 0.095,
      displacementBias: geometry === "sphere" ? -0.017 : -0.045,
      sheen: 0.28,
      sheenColor: new THREE.Color("#f3eee5"),
      sheenRoughness: 0.72,
      side: THREE.DoubleSide,
      alphaMap,
      transparent: true,
      alphaTest: 0.08,
    });

    const mesh = new THREE.Mesh(geometryObject, fabricMaterial);
    if (geometry === "plane") {
      mesh.rotation.x = -0.13;
      mesh.rotation.y = -0.18;
    }
    scene.add(mesh);

    const keyLight = new THREE.DirectionalLight("#fff7e8", lightIntensity * 1.05);
    keyLight.position.set(3.5, 4.5, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#c9dddc", lightIntensity * 0.32);
    fillLight.position.set(-4, 1.5, 2);
    scene.add(fillLight);
    const hemisphere = new THREE.HemisphereLight("#ffffff", "#776b5e", lightIntensity * 0.42);
    scene.add(hemisphere);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 2.8;
    controls.maxDistance = 10;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.8;

    let frame = 0;
    const resize = () => {
      const width = host.clientWidth;
      const height = Math.max(360, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      geometryObject.dispose();
      fabricMaterial.dispose();
      colorMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      displacementMap.dispose();
      metalnessMap.dispose();
      alphaMap.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [
    autoRotate,
    geometry,
    lightIntensity,
    material,
    materialScale,
    textureRepeat,
    view,
  ]);

  return (
    <section className="material-viewer">
      <div className="material-viewer-stage" ref={hostRef}>
        <span className="viewer-hint">Drag to orbit · scroll to zoom</span>
      </div>
      <div className="viewer-controls">
        <div className="viewer-control-group">
          <span className="viewer-control-label">Preview form</span>
          <div className="viewer-segmented">
            <button
              className={geometry === "sphere" ? "selected" : ""}
              onClick={() => setGeometry("sphere")}
            >
              Sphere
            </button>
            <button
              className={geometry === "plane" ? "selected" : ""}
              onClick={() => setGeometry("plane")}
            >
              Fabric Plane
            </button>
          </div>
        </div>
        <div className="viewer-control-group">
          <span className="viewer-control-label">View distance</span>
          <div className="viewer-segmented">
            <button
              className={view === "closeup" ? "selected" : ""}
              onClick={() => setView("closeup")}
            >
              Close-up View
            </button>
            <button
              className={view === "full" ? "selected" : ""}
              onClick={() => setView("full")}
            >
              Full Material View
            </button>
          </div>
        </div>
        <div className="viewer-control-group viewer-repeat-control">
          <span className="viewer-control-label">Texture repeat</span>
          <div className="viewer-segmented">
            {([1, 2, 4, 8, 16] as TextureRepeat[]).map((value) => (
              <button
                key={value}
                className={textureRepeat === value ? "selected" : ""}
                onClick={() => setTextureRepeat(value)}
              >
                {value}×
              </button>
            ))}
          </div>
        </div>
        <div className="viewer-control-group viewer-scale-control">
          <span className="viewer-control-label">Material scale</span>
          <div className="viewer-segmented">
            {([10, 25, 50, 100] as MaterialScale[]).map((value) => (
              <button
                key={value}
                className={materialScale === value ? "selected" : ""}
                onClick={() => setMaterialScale(value)}
              >
                {value}cm
              </button>
            ))}
          </div>
        </div>
        <label className="viewer-light-control">
          <span>
            <span className="viewer-control-label">Light intensity</span>
            <strong>{lightIntensity.toFixed(1)}×</strong>
          </span>
          <input
            type="range"
            min="0.4"
            max="2"
            step="0.1"
            value={lightIntensity}
            onChange={(event) => setLightIntensity(Number(event.target.value))}
          />
        </label>
        <label className="viewer-toggle">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(event) => setAutoRotate(event.target.checked)}
          />
          <span>Auto rotate</span>
        </label>
        <div className="viewer-scale-readout">
          Effective repeat: <strong>{textureRepeat * (materialScale / 25)}×</strong>
        </div>
      </div>
    </section>
  );
}
