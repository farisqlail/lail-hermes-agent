import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface GraphNodeData {
  id: string;
  label: string;
  type: 'core' | 'session' | 'task';
  status?: string;
  details?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GraphLinkData {
  source: string;
  target: string;
}

export type ShapeType = 'sphere' | 'cube' | 'torus' | 'icosahedron' | 'teapot' | 'dna' | 'wave';

const SHAPES: ShapeType[] = ['sphere', 'cube', 'torus', 'icosahedron', 'teapot', 'dna', 'wave'];
const NUM_PARTICLES = 25000;
const MORPH_DURATION = 1.5;

interface WaveConstellationGraphProps {
  systemNodes: GraphNodeData[];
  systemLinks: GraphLinkData[];
  sessionId?: string;
  onSelectNode?: (node: { id: string; label: string; type: string; details?: string; status?: string } | null) => void;
  onNavigateSession?: (sessionId: string) => void;
}

/** Mutable render params — kept off React state so a slider drag never re-creates the scene. */
interface RenderParams {
  particleSize: number;
  particleColor: THREE.Color;
  rotationSpeed: number;
  waveSpeed: number;
  bloomStrength: number;
  motionTrail: number;
  shape: ShapeType;
}

/** Vertex source for the shapes that come straight from a Three.js geometry. */
function shapeGeometry(shape: ShapeType): THREE.BufferGeometry | null {
  switch (shape) {
    case 'sphere': return new THREE.SphereGeometry(1.5, 64, 64);
    // Higher segment counts than a default box: 24 corner vertices would clump
    // every particle onto 8 points.
    case 'cube': return new THREE.BoxGeometry(2.2, 2.2, 2.2, 24, 24, 24);
    case 'torus': return new THREE.TorusGeometry(1.2, 0.4, 32, 200);
    case 'icosahedron': return new THREE.IcosahedronGeometry(1.7, 3);
    case 'teapot': return new TeapotGeometry(1.2, 16);
    default: return null;
  }
}

/** Writes the target position of every particle for `shape` into `arr`. */
function fillTargets(shape: ShapeType, arr: Float32Array, time: number) {
  const count = arr.length / 3;

  if (shape === 'wave') {
    const side = Math.round(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const u = ((i % side) / side - 0.5) * 3.6;
      const v = (Math.floor(i / side) / side - 0.5) * 3.6;
      arr[i * 3] = u;
      arr[i * 3 + 1] = Math.sin(u * 2 + time * 1.5) * Math.cos(v * 2 + time * 1.5) * 0.65;
      arr[i * 3 + 2] = v;
    }
    return;
  }

  if (shape === 'dna') {
    const radius = 1.1;
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 40;
      const height = (i / count - 0.5) * 3.8;
      if (i % 10 === 0) {
        // Every tenth particle becomes a base-pair rung between the two strands.
        const f = (i % 5) / 5;
        const x1 = Math.cos(t) * radius;
        const z1 = Math.sin(t) * radius;
        arr[i * 3] = x1 + (-x1 - x1) * f;
        arr[i * 3 + 1] = height;
        arr[i * 3 + 2] = z1 + (-z1 - z1) * f;
      } else {
        const offset = i % 2 === 0 ? 0 : Math.PI;
        arr[i * 3] = Math.cos(t + offset) * radius;
        arr[i * 3 + 1] = height;
        arr[i * 3 + 2] = Math.sin(t + offset) * radius;
      }
    }
    return;
  }

  const geo = shapeGeometry(shape);
  if (!geo) return;
  const pos = geo.getAttribute('position');
  for (let i = 0; i < count; i++) {
    const j = i % pos.count;
    arr[i * 3] = pos.getX(j);
    arr[i * 3 + 1] = pos.getY(j);
    arr[i * 3 + 2] = pos.getZ(j);
  }
  geo.dispose();
}

export const WaveConstellationGraph: React.FC<WaveConstellationGraphProps> = ({
  systemNodes,
  systemLinks,
  sessionId,
  onSelectNode,
  onNavigateSession,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const [shape, setShape] = useState<ShapeType>('wave');
  const [hovered, setHovered] = useState<{ node: GraphNodeData; x: number; y: number } | null>(null);

  // No settings UI — these are the fixed look of the cloud.
  const paramsRef = useRef<RenderParams>({
    particleSize: 0.035,
    particleColor: new THREE.Color(0x1f7693),
    rotationSpeed: 0.1,
    waveSpeed: 1.0,
    bloomStrength: 0.8,
    motionTrail: 0.3,
    shape: 'wave',
  });

  // Latest callbacks/props for the render loop, which is created once.
  const handlersRef = useRef({ onSelectNode, onNavigateSession, sessionId });
  handlersRef.current = { onSelectNode, onNavigateSession, sessionId };

  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    particles: THREE.Points;
    bloomPass: UnrealBloomPass;
    trailPass: AfterimagePass;
    targets: Float32Array;
    morphProgress: number;
    systemGroup: THREE.Group;
    systemPoints: THREE.Points | null;
    systemLines: THREE.LineSegments | null;
    systemData: GraphNodeData[];
    /** Index into the main cloud that each system node rides on. */
    slots: number[];
    /** Link endpoints as pairs of systemNodes indices. */
    linkPairs: [number, number][];
  } | null>(null);

  /** Re-point every particle at the new shape and restart the morph timer. */
  const morphTo = useCallback((next: ShapeType) => {
    setShape(next);
    paramsRef.current.shape = next;
    const ctx = sceneRef.current;
    if (!ctx) return;
    fillTargets(next, ctx.targets, 0);
    ctx.morphProgress = 0;
  }, []);

  // ---- scene lifecycle: created once, torn down on unmount ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.Fog(0x050505, 10, 50);

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 0, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(1, 3, 2);
    scene.add(dirLight);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), paramsRef.current.bloomStrength, 0.5, 0.85);
    composer.addPass(bloomPass);
    const trailPass = new AfterimagePass(paramsRef.current.motionTrail);
    composer.addPass(trailPass);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 2;
    controls.maxDistance = 10;

    // Particle cloud: opens on the wave field.
    const positions = new Float32Array(NUM_PARTICLES * 3);
    const colors = new Float32Array(NUM_PARTICLES * 3);
    const targets = new Float32Array(NUM_PARTICLES * 3);
    fillTargets('wave', targets, 0);
    positions.set(targets);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: paramsRef.current.particleSize,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const systemGroup = new THREE.Group();
    scene.add(systemGroup);

    sceneRef.current = {
      scene, camera, controls, particles, bloomPass, trailPass,
      targets, morphProgress: 1, systemGroup, systemPoints: null, systemLines: null,
      systemData: [], slots: [], linkPairs: [],
    };

    // Every particle takes the base colour flat — no lightness jitter.
    const paintColors = () => {
      const attr = geometry.getAttribute('color') as THREE.BufferAttribute;
      const c = paramsRef.current.particleColor;
      for (let i = 0; i < NUM_PARTICLES; i++) attr.setXYZ(i, c.r, c.g, c.b);
      attr.needsUpdate = true;
    };
    paintColors();
    (particles.userData as { paintColors: () => void }).paintColors = paintColors;

    // ---- picking ----
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.14 };
    const pointer = new THREE.Vector2();
    let pointerInside = false;
    let pointerPx = { x: 0, y: 0 };
    let downAt: { x: number; y: number } | null = null;

    const pickSystemNode = (): GraphNodeData | null => {
      const ctx = sceneRef.current;
      if (!ctx || !ctx.systemPoints || !pointerInside) return null;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(ctx.systemPoints, false)[0];
      if (!hit || hit.index === undefined) return null;
      return ctx.systemData[hit.index] ?? null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      pointer.x = (pointerPx.x / rect.width) * 2 - 1;
      pointer.y = -(pointerPx.y / rect.height) * 2 + 1;
      pointerInside = true;
    };
    const onPointerLeave = () => { pointerInside = false; setHovered(null); };
    const onPointerDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = (e: PointerEvent) => {
      // An orbit drag ends on the canvas too — only a near-stationary release is a click.
      const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
      downAt = null;
      if (moved > 4) return;
      const node = pickSystemNode();
      handlersRef.current.onSelectNode?.(
        node ? { id: node.id, label: node.label, type: node.type, details: node.details, status: node.status } : null
      );
    };
    const onDoubleClick = () => {
      const node = pickSystemNode();
      if (node?.type === 'session') {
        handlersRef.current.onNavigateSession?.(node.id);
        return;
      }
      controls.reset();
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);
    };

    const el = renderer.domElement;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('dblclick', onDoubleClick);

    // ---- resize ----
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloomPass.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // ---- render loop ----
    const clock = new THREE.Clock();
    let waveTime = 0;
    let frame = 0;
    let hoverTick = 0;

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const ctx = sceneRef.current;
      if (!ctx) return;
      const p = paramsRef.current;
      const delta = clock.getDelta();
      waveTime += delta * p.waveSpeed;

      material.size = p.particleSize;
      bloomPass.strength = p.bloomStrength;
      trailPass.uniforms['damp'].value = p.motionTrail;
      trailPass.enabled = p.motionTrail > 0.01;

      particles.rotation.y += delta * p.rotationSpeed;
      systemGroup.rotation.y = particles.rotation.y;

      if (p.shape === 'wave') fillTargets('wave', ctx.targets, waveTime);

      if (p.shape === 'wave' || ctx.morphProgress < 1) {
        ctx.morphProgress = Math.min(1, ctx.morphProgress + delta / MORPH_DURATION);
        const arr = (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
        const step = Math.min(1, delta / (p.shape === 'wave' ? 0.25 : MORPH_DURATION));
        for (let i = 0; i < arr.length; i++) arr[i] += (ctx.targets[i] - arr[i]) * step;
        geometry.getAttribute('position').needsUpdate = true;
        geometry.computeBoundingSphere();
      }

      // System nodes are not placed independently — they ride whichever cloud
      // particle they were assigned, so they morph and wave with the shape.
      const cloud = (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      if (ctx.systemPoints) {
        const attr = ctx.systemPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
        ctx.slots.forEach((slot, i) => attr.setXYZ(i, cloud[slot * 3], cloud[slot * 3 + 1], cloud[slot * 3 + 2]));
        attr.needsUpdate = true;
        ctx.systemPoints.geometry.computeBoundingSphere();
      }
      if (ctx.systemLines) {
        const attr = ctx.systemLines.geometry.getAttribute('position') as THREE.BufferAttribute;
        ctx.linkPairs.forEach(([a, b], i) => {
          const sa = ctx.slots[a] * 3;
          const sb = ctx.slots[b] * 3;
          attr.setXYZ(i * 2, cloud[sa], cloud[sa + 1], cloud[sa + 2]);
          attr.setXYZ(i * 2 + 1, cloud[sb], cloud[sb + 1], cloud[sb + 2]);
        });
        attr.needsUpdate = true;
        ctx.systemLines.geometry.computeBoundingSphere();
        (ctx.systemLines.material as THREE.LineBasicMaterial).color.copy(p.particleColor);
      }

      // Hover picking is the only per-frame raycast; 10 Hz is plenty for a tooltip.
      hoverTick += delta;
      if (hoverTick > 0.1) {
        hoverTick = 0;
        const node = pickSystemNode();
        setHovered(node ? { node, x: pointerPx.x, y: pointerPx.y } : null);
      }

      controls.update();
      composer.render();
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('dblclick', onDoubleClick);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      composer.dispose();
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      sceneRef.current = null;
    };
  }, []);

  // ---- system nodes + links, rebuilt whenever the graph data changes ----
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    const group = ctx.systemGroup;
    group.clear();
    ctx.systemPoints = null;
    ctx.systemLines = null;
    ctx.systemData = systemNodes;
    ctx.slots = [];
    ctx.linkPairs = [];
    if (systemNodes.length === 0) return;

    // Each node claims one particle of the cloud, spread evenly over the shape.
    // The render loop copies that particle's position every frame, so a node is
    // visually the cloud particle itself — same colour, same size, same form.
    ctx.slots = systemNodes.map((_, i) => Math.floor((i + 0.5) * NUM_PARTICLES / systemNodes.length));

    const index = new Map<string, number>();
    systemNodes.forEach((node, i) => index.set(node.id, i));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(systemNodes.length * 3), 3));
    // Invisible pick proxy: the particle underneath is what the eye sees, so
    // drawing here would make these nodes brighter than the rest of the cloud.
    // A raycaster skips objects with visible === false, hence opacity instead.
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.16, transparent: true, opacity: 0, depthWrite: false,
    }));
    group.add(points);
    ctx.systemPoints = points;

    systemLinks.forEach((link) => {
      const a = index.get(link.source);
      const b = index.get(link.target);
      if (a !== undefined && b !== undefined) ctx.linkPairs.push([a, b]);
    });
    if (ctx.linkPairs.length > 0) {
      const linkGeo = new THREE.BufferGeometry();
      linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ctx.linkPairs.length * 6), 3));
      const lines = new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
      }));
      group.add(lines);
      ctx.systemLines = lines;
    }

    return () => {
      group.traverse((obj) => {
        const mesh = obj as THREE.Points;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
      group.clear();
    };
  }, [systemNodes, systemLinks]);

  return (
    <div
      className="graph-canvas-container"
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', backgroundColor: '#050505' }}
    >
      {/* Shape switcher (top-right) */}
      <div style={{
        position: 'absolute', top: '16px', right: '16px', display: 'flex',
        flexDirection: 'column', alignItems: 'flex-end', gap: '8px', zIndex: 20,
      }}>
        {SHAPES.map((s) => (
          <button
            key={s}
            onClick={() => morphTo(s)}
            style={{
              cursor: 'pointer', padding: '6px 14px', borderRadius: '20px',
              border: shape === s ? '1px solid var(--accent)' : '1px solid rgba(0, 229, 255, 0.25)',
              backgroundColor: shape === s ? 'rgba(0, 229, 255, 0.18)' : 'rgba(0, 0, 0, 0.55)',
              color: shape === s ? 'var(--accent)' : 'var(--text-dim)',
              fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 'bold',
              textTransform: 'capitalize', width: '124px', textAlign: 'center',
              boxShadow: shape === s ? '0 0 12px rgba(0, 229, 255, 0.45)' : 'none',
              transition: 'all 0.25s ease',
            }}
          >
            {s === 'wave' ? '🌊 Wave' : s}
          </button>
        ))}
      </div>

      {/* WebGL canvas mount */}
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {hovered && (
        <div style={{
          position: 'absolute', left: hovered.x + 14, top: hovered.y + 14,
          padding: '4px 8px', borderRadius: '4px', pointerEvents: 'none', zIndex: 25,
          background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '10px', whiteSpace: 'nowrap',
        }}>
          {hovered.node.label}
          {hovered.node.status ? ` — ${hovered.node.status}` : ''}
        </div>
      )}

      <div style={{
        position: 'absolute', bottom: '16px', left: '16px', color: 'rgba(255,255,255,0.6)',
        fontFamily: 'var(--font-mono)', fontSize: '9px', pointerEvents: 'none', zIndex: 20,
      }}>
        Drag to rotate | Scroll to zoom | Double-click to reset view
      </div>
    </div>
  );
};
