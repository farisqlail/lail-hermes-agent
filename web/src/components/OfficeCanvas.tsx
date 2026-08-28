import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Employee } from '../api/types';
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  Sun,
  Moon,
  Sunset,
  Monitor,
  Users,
  Coffee,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface OfficeCanvasProps {
  employees: Employee[];
  onSelectEmployee?: (employee: Employee) => void;
  selectedEmployeeId?: string | null;
  speakingEmployeeId?: string | null;
}

type LightingPreset = 'day' | 'night' | 'sunset';
type CameraViewPreset = 'overview' | 'desks' | 'meeting' | 'lounge' | 'focus';

// Specific POIs (Points of Interest) across the 3D Office
interface OfficePOI {
  id: string;
  name: string;
  x: number;
  z: number;
  rotationY: number;
  isSeated: boolean;
  zone: 'desk' | 'meeting' | 'lounge' | 'hallway' | 'focus';
}

// rotationY: Math.PI — createWorkstation's chair sits at local +Z (behind the
// avatar) with the monitors at local -Z (in front), and the avatar mesh's own
// forward axis is local +Z at rotation 0 (see the atan2(dx, dz) walk-facing
// code below), so 0 would face the avatar away from its screen, into the
// chair back. PI turns it around to face the monitors like an occupied desk.
const DESK_POIS: OfficePOI[] = [
  { id: 'desk-1', name: 'Front Desk Left', x: -11.5, z: 9.5, rotationY: Math.PI, isSeated: true, zone: 'desk' },
  { id: 'desk-2', name: 'Front Desk Mid', x: -8.0, z: 9.5, rotationY: Math.PI, isSeated: true, zone: 'desk' },
  { id: 'desk-3', name: 'Front Desk Right', x: -4.5, z: 9.5, rotationY: Math.PI, isSeated: true, zone: 'desk' },
  { id: 'desk-4', name: 'Back Desk Left', x: -11.5, z: 2.5, rotationY: Math.PI, isSeated: true, zone: 'desk' },
  { id: 'desk-5', name: 'Back Desk Mid', x: -8.0, z: 2.5, rotationY: Math.PI, isSeated: true, zone: 'desk' },
  { id: 'desk-6', name: 'Back Desk Right', x: -4.5, z: 2.5, rotationY: Math.PI, isSeated: true, zone: 'desk' },
];

const MEETING_POIS: OfficePOI[] = [
  { id: 'meet-presenter', name: 'Whiteboard Presenter', x: 6.5, z: -4.0, rotationY: Math.PI * 0.75, isSeated: false, zone: 'meeting' },
  { id: 'meet-chair-1', name: 'Meeting Chair 1', x: 4.5, z: 2.0, rotationY: Math.PI / 2, isSeated: true, zone: 'meeting' },
  { id: 'meet-chair-2', name: 'Meeting Chair 2', x: 11.5, z: 2.0, rotationY: -Math.PI / 2, isSeated: true, zone: 'meeting' },
  { id: 'meet-chair-3', name: 'Meeting Chair 3', x: 6.5, z: -0.5, rotationY: 0, isSeated: true, zone: 'meeting' },
  { id: 'meet-chair-4', name: 'Meeting Chair 4', x: 9.5, z: -0.5, rotationY: 0, isSeated: true, zone: 'meeting' },
  { id: 'meet-chair-5', name: 'Meeting Chair 5', x: 6.5, z: 4.5, rotationY: Math.PI, isSeated: true, zone: 'meeting' },
  { id: 'meet-chair-6', name: 'Meeting Chair 6', x: 9.5, z: 4.5, rotationY: Math.PI, isSeated: true, zone: 'meeting' },
  { id: 'meet-window', name: 'Meeting Window View', x: 14.5, z: 1.5, rotationY: -Math.PI / 2, isSeated: false, zone: 'meeting' },
];

const LOUNGE_POIS: OfficePOI[] = [
  { id: 'sofa-1', name: 'Lounge Sofa Left', x: -9.5, z: -8.0, rotationY: Math.PI / 2, isSeated: true, zone: 'lounge' },
  { id: 'sofa-2', name: 'Lounge Sofa Right', x: -9.5, z: -6.5, rotationY: Math.PI / 2, isSeated: true, zone: 'lounge' },
  { id: 'water-cooler', name: 'Water Cooler', x: -3.5, z: -10.5, rotationY: -Math.PI * 0.4, isSeated: false, zone: 'lounge' },
  { id: 'coffee-bar', name: 'Coffee Credenza', x: -4.5, z: -7.0, rotationY: -Math.PI * 0.6, isSeated: false, zone: 'lounge' },
  { id: 'lounge-clock', name: 'Clock Wall View', x: -9.0, z: -11.0, rotationY: 0, isSeated: false, zone: 'lounge' },
];

const IDLE_EXPLORATION_POIS: OfficePOI[] = [
  { id: 'hall-welcome', name: 'Office Entrance', x: 0, z: 12.0, rotationY: -Math.PI * 0.25, isSeated: false, zone: 'hallway' },
  { id: 'hall-mid', name: 'Central Hallway', x: 0, z: 5.0, rotationY: Math.PI * 0.5, isSeated: false, zone: 'hallway' },
  { id: 'hall-door', name: 'Meeting Entrance', x: 0, z: 0.0, rotationY: 0, isSeated: false, zone: 'hallway' },
  { id: 'hall-back', name: 'Lounge Corner', x: 0, z: -6.0, rotationY: -Math.PI * 0.5, isSeated: false, zone: 'hallway' },
  { id: 'focus-pod', name: 'Focus Pod Desk', x: -0.5, z: -9.5, rotationY: 0, isSeated: true, zone: 'focus' },
  { id: 'plant-corner', name: 'Plant Corner', x: -14.0, z: 12.0, rotationY: Math.PI * 0.25, isSeated: false, zone: 'desk' },
  { id: 'meet-whiteboard-view', name: 'Whiteboard Observer', x: 5.0, z: -2.5, rotationY: Math.PI * 0.75, isSeated: false, zone: 'meeting' },
  { id: 'meet-glass-view', name: 'Glass Wall View', x: 13.5, z: 6.0, rotationY: -Math.PI * 0.4, isSeated: false, zone: 'meeting' },
  { id: 'lounge-relax', name: 'Lounge Relax', x: -7.0, z: -9.0, rotationY: Math.PI * 0.3, isSeated: false, zone: 'lounge' },
];

const STATUS_COLOR_HEX = {
  working: 0x38bdf8,
  in_meeting: 0xa855f7,
  on_break: 0xf59e0b,
  idle: 0x94a3b8,
};

// Procedural R6-style Face Canvas Texture
let _faceTexture: THREE.CanvasTexture | null = null;
function getFaceTexture(): THREE.CanvasTexture {
  if (_faceTexture) return _faceTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fde047';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(16, 24, 8, 8);
  ctx.fillRect(40, 24, 8, 8);
  ctx.beginPath();
  ctx.arc(32, 42, 10, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();
  _faceTexture = new THREE.CanvasTexture(canvas);
  return _faceTexture;
}

// Procedural Wood Texture Generator
const _woodTextureCache = new Map<string, THREE.Texture>();
function getWoodTexture(base: string, plankAlt: string, grain: string): THREE.Texture {
  const key = base + plankAlt + grain;
  const cached = _woodTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);

  const plankHeight = 32;
  for (let y = 0; y < 256; y += plankHeight) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = Math.random() > 0.5 ? plankAlt : base;
    ctx.fillRect(0, y, 256, plankHeight);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = grain;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const gy = y + 4 + Math.random() * (plankHeight - 8);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 8; x <= 256; x += 16) {
        ctx.lineTo(x, gy + (Math.random() - 0.5) * 4);
      }
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  _woodTextureCache.set(key, texture);
  return texture;
}

function createWoodMaterial(
  spec: { base: string; plankAlt: string; grain: string },
  repeatX = 4,
  repeatY = 4,
  roughness = 0.55
): THREE.MeshStandardMaterial {
  const tex = getWoodTexture(spec.base, spec.plankAlt, spec.grain).clone();
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: tex, roughness, metalness: 0.08 });
}

function createNameSprite(name: string, role?: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
  ctx.fillText(label, 128, role ? 24 : 32);

  if (role) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const sub = role.length > 20 ? role.slice(0, 19) + '…' : role;
    ctx.fillText(sub, 128, 44);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

function createSpeechBubbleSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 40, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, 44);
  ctx.lineTo(10, 58);
  ctx.lineTo(28, 44);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(20 + i * 12, 24, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

interface AvatarMeshGroup {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  headMesh: THREE.Mesh;
  haloRing: THREE.Mesh;
  auraRing: THREE.Mesh;
  nameSprite: THREE.Sprite;
  speechBubble: THREE.Sprite;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  currentX: number;
  currentZ: number;
  targetX: number;
  targetZ: number;
  targetRotY: number;
  isSeated: boolean;
  employeeId: string;
  assignedPoi?: OfficePOI;
  nextMoveAt: number;
  arrived: boolean;
  zoneStatus: Employee['status'];
}

export function OfficeCanvas({ employees, onSelectEmployee, selectedEmployeeId, speakingEmployeeId }: OfficeCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lighting, setLighting] = useState<LightingPreset>('day');
  const [activeView, setActiveView] = useState<CameraViewPreset>('overview');
  const [hoveredEmp, setHoveredEmp] = useState<Employee | null>(null);
  const [stats, setStats] = useState({ working: 0, meeting: 0, break: 0, idle: 0 });

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const avatarsRef = useRef<Map<string, AvatarMeshGroup>>(new Map());
  const lightsRef = useRef<{ dirLight?: THREE.DirectionalLight; ambLight?: THREE.AmbientLight; deskLights?: THREE.PointLight[] }>({});
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const reqAnimRef = useRef<number>(0);

  const camTargetPos = useRef<THREE.Vector3>(new THREE.Vector3(26, 22, 26));
  const camTargetLookAt = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
  const isTransitioningRef = useRef<boolean>(false);

  useEffect(() => {
    let working = 0; let meeting = 0; let brk = 0; let idle = 0;
    for (const e of employees) {
      if (e.status === 'working') working++;
      else if (e.status === 'in_meeting') meeting++;
      else if (e.status === 'on_break') brk++;
      else idle++;
    }
    setStats({ working, meeting, break: brk, idle });
  }, [employees]);

  const setCameraPreset = useCallback((preset: CameraViewPreset) => {
    setActiveView(preset);
    isTransitioningRef.current = true;
    switch (preset) {
      case 'desks':
        camTargetPos.current.set(-2, 14, 18);
        camTargetLookAt.current.set(-8.0, 2, 6);
        break;
      case 'meeting':
        camTargetPos.current.set(18, 14, 12);
        camTargetLookAt.current.set(8.5, 2, 1.5);
        break;
      case 'lounge':
        camTargetPos.current.set(-2, 14, -2);
        camTargetLookAt.current.set(-7.5, 2, -8);
        break;
      case 'focus':
        camTargetPos.current.set(4, 10, -5);
        camTargetLookAt.current.set(0, 2, -9.5);
        break;
      case 'overview':
      default:
        camTargetPos.current.set(24, 20, 24);
        camTargetLookAt.current.set(0, 1, 0);
        break;
    }
  }, []);

  const handleZoomIn = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    isTransitioningRef.current = false;
    const forward = new THREE.Vector3();
    cameraRef.current.getWorldDirection(forward);
    cameraRef.current.position.addScaledVector(forward, 4);
    controlsRef.current.update();
  };

  const handleZoomOut = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    isTransitioningRef.current = false;
    const forward = new THREE.Vector3();
    cameraRef.current.getWorldDirection(forward);
    cameraRef.current.position.addScaledVector(forward, -4);
    controlsRef.current.update();
  };

  useEffect(() => {
    const { dirLight, ambLight, deskLights } = lightsRef.current;
    const scene = sceneRef.current;
    if (!dirLight || !ambLight || !scene) return;

    if (lighting === 'day') {
      ambLight.color.setHex(0xffffff);
      ambLight.intensity = 0.75;
      dirLight.color.setHex(0xfffaed);
      dirLight.intensity = 1.35;
      dirLight.position.set(28, 35, 24);
      deskLights?.forEach((l) => { l.intensity = 0.4; l.color.setHex(0xffedd5); });
      scene.background = new THREE.Color(0x8fc1e3);
      if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(0x8fc1e3);
    } else if (lighting === 'night') {
      ambLight.color.setHex(0x1e293b);
      ambLight.intensity = 0.4;
      dirLight.color.setHex(0x38bdf8);
      dirLight.intensity = 0.5;
      dirLight.position.set(-20, 30, 20);
      deskLights?.forEach((l) => { l.intensity = 1.2; l.color.setHex(0x38bdf8); });
      scene.background = new THREE.Color(0x0a0e1a);
      if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(0x0a0e1a);
    } else if (lighting === 'sunset') {
      ambLight.color.setHex(0xfde047);
      ambLight.intensity = 0.5;
      dirLight.color.setHex(0xf97316);
      dirLight.intensity = 1.4;
      dirLight.position.set(30, 18, 15);
      deskLights?.forEach((l) => { l.intensity = 0.8; l.color.setHex(0xfbbf24); });
      scene.background = new THREE.Color(0xf4a672);
      if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(0xf4a672);
    }
  }, [lighting]);

  // Main 3D Office Construction
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 560;

    const scene = new THREE.Scene();
    // Sky-blue day default, matching the 'day' lighting preset — the lighting
    // effect keeps this in sync afterward. Fog fades the ground/trees into
    // the sky at a distance instead of a hard black edge, which is what made
    // the building look like it was floating in a void with nothing around.
    scene.background = new THREE.Color(0x8fc1e3);
    scene.fog = new THREE.Fog(0x8fc1e3, 45, 160);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 200);
    camera.position.set(24, 20, 24);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.9;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 3;
    controls.maxDistance = 80;
    controls.enablePan = true;
    controls.panSpeed = 1.0;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minPolarAngle = 0.05;
    controls.target.set(0, 1, 0);

    controls.addEventListener('start', () => {
      isTransitioningRef.current = false;
    });
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.35);
    dirLight.position.set(28, 35, 24);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 5;
    dirLight.shadow.camera.far = 70;
    dirLight.shadow.camera.left = -22;
    dirLight.shadow.camera.right = 22;
    dirLight.shadow.camera.top = 22;
    dirLight.shadow.camera.bottom = -22;
    dirLight.shadow.bias = -0.0003;
    scene.add(dirLight);

    const deskLights: THREE.PointLight[] = [];
    const deskLight1 = new THREE.PointLight(0xffedd5, 0.5, 15);
    deskLight1.position.set(-8.0, 5, 6);
    scene.add(deskLight1);
    deskLights.push(deskLight1);

    const meetingLight = new THREE.PointLight(0xfef08a, 0.6, 16);
    meetingLight.position.set(8.5, 6, 1.5);
    scene.add(meetingLight);
    deskLights.push(meetingLight);

    lightsRef.current = { dirLight, ambLight: ambientLight, deskLights };

    // ==========================================
    // ARCHITECTURAL STRUCTURE & ROOMS
    // ==========================================
    const officeGroup = new THREE.Group();
    scene.add(officeGroup);

    const WOOD_OAK = { base: '#9c7a52', plankAlt: '#8a6941', grain: 'rgba(45,25,8,0.6)' };
    const WOOD_WALNUT = { base: '#6b4a2e', plankAlt: '#5c3e26', grain: 'rgba(30,15,5,0.6)' };
    const WOOD_CHESTNUT = { base: '#7a5230', plankAlt: '#68451f', grain: 'rgba(35,18,6,0.6)' };
    const WOOD_PARQUET = { base: '#8a5a2e', plankAlt: '#7a4d22', grain: 'rgba(50,25,8,0.55)' };
    const WOOD_DESK = { base: '#c99a5c', plankAlt: '#b8874a', grain: 'rgba(60,35,10,0.5)' };
    const WOOD_CREDENZA = { base: '#a97b45', plankAlt: '#96693a', grain: 'rgba(55,30,10,0.5)' };

    const matDarkWall = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.6 });
    const matYellowAccent = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.15 });
    const matWoodSlat = new THREE.MeshStandardMaterial({ color: 0xc2782e, roughness: 0.5 });
    const matBrick = new THREE.MeshStandardMaterial({ color: 0x6e2c18, roughness: 0.8 });
    const matGlass = new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.25,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.7,
      ior: 1.5,
    });
    const matGlassFrame = new THREE.MeshStandardMaterial({ color: 0x090b0e, roughness: 0.4, metalness: 0.8 });
    const matDeskTop = createWoodMaterial(WOOD_DESK, 3.6, 1.8, 0.3);
    const matBlackLegs = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5, metalness: 0.8 });
    const matChair = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.85, metalness: 0 });
    const matWhiteboard = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 });
    const matScreenGlow = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.8 });

    // Base Plinth Ground
    const plinthGeo = new THREE.BoxGeometry(36, 0.8, 32);
    const plinthMesh = new THREE.Mesh(plinthGeo, new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 0.9 }));
    plinthMesh.position.set(0, -0.4, 0);
    plinthMesh.receiveShadow = true;
    officeGroup.add(plinthMesh);

    // --- Surrounding grounds: a real outdoor world instead of the building
    // ending at a hard edge over blank black. A big grass plane under/around
    // the plinth plus scattered trees sells "sitting on the ground outdoors"
    // — fog (set on the scene above) fades the far edge into the sky instead
    // of the ground just stopping. ---
    const matGrass = new THREE.MeshStandardMaterial({ color: 0x3f6b3f, roughness: 0.95 });
    const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), matGrass);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.82; // just below the plinth's underside, no z-fighting
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const matTrunk = new THREE.MeshStandardMaterial({ color: 0x5b3a21, roughness: 0.9 });
    const matFoliage = new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 0.85 });
    const matFoliageLight = new THREE.MeshStandardMaterial({ color: 0x3f9350, roughness: 0.85 });
    const createExteriorTree = (x: number, z: number, scale: number) => {
      const tree = new THREE.Group();
      tree.position.set(x, -0.4, z);
      tree.scale.set(scale, scale, scale);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 8), matTrunk);
      trunk.position.set(0, 1.1, 0);
      trunk.castShadow = true;
      tree.add(trunk);
      const canopyMat = Math.random() > 0.5 ? matFoliage : matFoliageLight;
      const canopy1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), canopyMat);
      canopy1.position.set(0, 2.6, 0);
      canopy1.castShadow = true;
      tree.add(canopy1);
      const canopy2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), canopyMat);
      canopy2.position.set(0.6, 3.2, 0.3);
      canopy2.castShadow = true;
      tree.add(canopy2);
      scene.add(tree);
    };

    // Scattered in a rough ring outside the building footprint (walls span
    // roughly x:[-17,17] z:[-14,15]) so nothing pokes through a wall.
    const buildingFootprint = { xMin: -19, xMax: 19, zMin: -16, zMax: 17 };
    let placed = 0;
    let attempts = 0;
    while (placed < 26 && attempts < 200) {
      attempts++;
      const angle = Math.random() * Math.PI * 2;
      const radius = 22 + Math.random() * 40;
      const tx = Math.cos(angle) * radius;
      const tz = Math.sin(angle) * radius;
      if (tx > buildingFootprint.xMin && tx < buildingFootprint.xMax &&
          tz > buildingFootprint.zMin && tz < buildingFootprint.zMax) {
        continue; // would land inside/against the building — resample
      }
      createExteriorTree(tx, tz, 0.9 + Math.random() * 0.7);
      placed++;
    }

    // Floor 1: Open Desks Workspace (Left) — light oak
    const deskFloorGeo = new THREE.BoxGeometry(15, 0.1, 17);
    const deskFloor = new THREE.Mesh(deskFloorGeo, createWoodMaterial(WOOD_OAK, 15, 17));
    deskFloor.position.set(-9.0, 0.05, 6);
    deskFloor.receiveShadow = true;
    officeGroup.add(deskFloor);

    // Floor 2: Meeting Room (Right) — warm parquet
    const meetingFloorGeo = new THREE.BoxGeometry(15, 0.1, 18);
    const meetingFloor = new THREE.Mesh(meetingFloorGeo, createWoodMaterial(WOOD_PARQUET, 15, 18, 0.4));
    meetingFloor.position.set(9.0, 0.05, 1.5);
    meetingFloor.receiveShadow = true;
    officeGroup.add(meetingFloor);

    // Floor 3: Break Lounge (Top-Left) — chestnut
    const loungeFloorGeo = new THREE.BoxGeometry(14, 0.1, 11);
    const loungeFloor = new THREE.Mesh(loungeFloorGeo, createWoodMaterial(WOOD_CHESTNUT, 14, 11));
    loungeFloor.position.set(-7.5, 0.05, -8);
    loungeFloor.receiveShadow = true;
    officeGroup.add(loungeFloor);

    // Floor 4: Central Corridor & Entryway — walnut
    const corridorGeo = new THREE.BoxGeometry(34, 0.08, 30);
    const corridor = new THREE.Mesh(corridorGeo, createWoodMaterial(WOOD_WALNUT, 34, 30));
    corridor.position.set(0, 0.04, 0);
    corridor.receiveShadow = true;
    officeGroup.add(corridor);

    // Wall Helper
    const createWall = (x: number, y: number, z: number, w: number, h: number, d: number, mat = matDarkWall) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      officeGroup.add(mesh);
      return mesh;
    };

    // Outer Cutaway Walls
    createWall(-8.5, 2.5, -13.6, 17, 5, 0.6); // Top-left back wall
    createWall(8.5, 2.5, -7.6, 17, 5, 0.6, matBrick); // Meeting room back brick wall
    createWall(-16.8, 2.5, 0, 0.6, 5, 27); // Far left wall
    const wavePanel = createWall(-16.4, 2.5, 6, 0.3, 4, 12, matYellowAccent); // Yellow acoustic wave panel
    wavePanel.castShadow = true;

    createWall(16.8, 2.5, 1.5, 0.6, 5, 18, matGlass); // Far right glass facade
    createWall(16.8, 0.2, 1.5, 0.7, 0.4, 18, matGlassFrame);
    createWall(16.8, 4.8, 1.5, 0.7, 0.4, 18, matGlassFrame);

    // --- Elegant Wood Slat Screen on LEFT of Hallway (Separates Front Desks from Corridor) ---
    // Placed at x: -2.2 from z: 1.0 to z: 13.0, leaving the central corridor x:[-1.5, 1.8] wide open!
    for (let i = 0; i < 15; i++) {
      createWall(-2.2, 2.1, 12.5 - i * 0.8, 0.12, 4.2, 0.18, matWoodSlat);
    }

    // --- Glass Meeting Room Partition & Doorway (on RIGHT at x = 1.8) ---
    // Glass Wall Front Segment (z: -7.0 to z: 5.5)
    createWall(1.8, 2.5, -0.75, 0.18, 5, 12.5, matGlass);
    createWall(1.8, 0.2, -0.75, 0.3, 0.4, 12.5, matGlassFrame);
    createWall(1.8, 4.8, -0.75, 0.3, 0.4, 12.5, matGlassFrame);
    for (let z = -7; z <= 5; z += 3) {
      createWall(1.8, 2.5, z, 0.3, 5, 0.18, matGlassFrame);
    }

    // Glass Wall Back Segment (z: 8.5 to z: 10.5)
    createWall(1.8, 2.5, 9.5, 0.18, 5, 2.0, matGlass);
    createWall(1.8, 0.2, 9.5, 0.3, 0.4, 2.0, matGlassFrame);
    createWall(1.8, 4.8, 9.5, 0.3, 0.4, 2.0, matGlassFrame);

    // Yellow Accent Meeting Doorway Frame (Open Portal at z = 7.0, character walks through freely)
    createWall(1.8, 4.5, 7.0, 0.35, 0.6, 2.8, matYellowAccent); // Top lintel
    createWall(1.8, 2.2, 5.6, 0.35, 4.4, 0.3, matYellowAccent); // Left jamb
    createWall(1.8, 2.2, 8.4, 0.35, 4.4, 0.3, matYellowAccent); // Right jamb

    // ==========================================
    // FURNITURE & PROPS
    // ==========================================
    const createWorkstation = (x: number, z: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);

      const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.8), matDeskTop);
      top.position.set(0, 1.25, 0);
      top.castShadow = true;
      top.receiveShadow = true;
      g.add(top);

      const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.7), matBlackLegs);
      leg1.position.set(-1.7, 0.6, 0);
      g.add(leg1);
      const leg2 = leg1.clone();
      leg2.position.set(1.7, 0.6, 0);
      g.add(leg2);

      const divider = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.08), matYellowAccent);
      divider.position.set(0, 1.55, -0.85);
      g.add(divider);

      const mon1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.05), matBlackLegs);
      mon1.position.set(-0.6, 1.75, -0.6);
      mon1.rotation.y = 0.1;
      const screen1 = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55), matScreenGlow);
      screen1.position.set(-0.6, 1.75, -0.57);
      screen1.rotation.y = 0.1;
      g.add(mon1);
      g.add(screen1);

      const mon2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.05), matBlackLegs);
      mon2.position.set(0.6, 1.75, -0.6);
      mon2.rotation.y = -0.1;
      const screen2 = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55), matScreenGlow);
      screen2.position.set(0.6, 1.75, -0.57);
      screen2.rotation.y = -0.1;
      g.add(mon2);
      g.add(screen2);

      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.8), matChair);
      seat.position.set(0, 0.8, 0.5);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.8, 0.1), matChair);
      back.position.set(0, 1.25, 0.9);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.75), matBlackLegs);
      stem.position.set(0, 0.4, 0.5);
      chair.add(seat, back, stem);
      g.add(chair);

      officeGroup.add(g);
    };

    createWorkstation(-11.5, 8.5);
    createWorkstation(-7.5, 8.5);
    createWorkstation(-11.5, 1.5);
    createWorkstation(-7.5, 1.5);

    // Meeting Room: Iconic Yellow Oval Conference Table
    const meetingTableGroup = new THREE.Group();
    meetingTableGroup.position.set(8.5, 0, 1.5);

    const tableTopGeo = new THREE.CylinderGeometry(2.4, 2.4, 0.14, 32);
    tableTopGeo.scale(1.8, 1, 1);
    const tableTop = new THREE.Mesh(tableTopGeo, matDeskTop);
    tableTop.position.set(0, 1.3, 0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    meetingTableGroup.add(tableTop);

    const pillar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.25, 16), matBlackLegs);
    pillar1.position.set(-2, 0.65, 0);
    const pillar2 = pillar1.clone();
    pillar2.position.set(2, 0.65, 0);
    meetingTableGroup.add(pillar1, pillar2);

    // Table top is an oval (x-radius 4.32, z-radius 2.4 — see tableTopGeo
    // above). The old x:±3.8 / z:±2.0 sat almost entirely under that edge —
    // barely 0.4-0.5 units of clearance, chair and tabletop visually
    // overlapping. Pushed out to a real ~1-unit gap past the table edge.
    const chairPositions = [
      { x: -5.2, z: 0, r: Math.PI / 2 },
      { x: 5.2, z: 0, r: -Math.PI / 2 },
      { x: -1.8, z: -3.3, r: 0 },
      { x: 0, z: -3.3, r: 0 },
      { x: 1.8, z: -3.3, r: 0 },
      { x: -1.8, z: 3.3, r: Math.PI },
      { x: 0, z: 3.3, r: Math.PI },
      { x: 1.8, z: 3.3, r: Math.PI },
    ];
    for (const cp of chairPositions) {
      const c = new THREE.Group();
      c.position.set(cp.x, 0, cp.z);
      // + PI: cp.r as written pointed the backrest (local +Z, see cBack
      // below) toward the table center instead of away from it — every chair
      // was seated facing outward, away from the table.
      c.rotation.y = cp.r + Math.PI;
      const cSeat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), matChair);
      cSeat.position.set(0, 0.8, 0);
      const cBack = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.75, 0.08), matChair);
      cBack.position.set(0, 1.2, 0.35);
      const cLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.75), matBlackLegs);
      cLeg.position.set(0, 0.4, 0);
      c.add(cSeat, cBack, cLeg);
      meetingTableGroup.add(c);
    }
    officeGroup.add(meetingTableGroup);

    // Presentation Whiteboard
    const boardGroup = new THREE.Group();
    boardGroup.position.set(6.5, 0, -5);
    boardGroup.rotation.y = 0.2;
    const boardSurface = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.2, 0.06), matWhiteboard);
    boardSurface.position.set(0, 2.2, 0);
    boardSurface.castShadow = true;
    const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.3, 0.04), matBlackLegs);
    boardFrame.position.set(0, 2.2, -0.02);
    const boardLegL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5), matBlackLegs);
    boardLegL.position.set(-1.6, 1.25, 0);
    const boardLegR = boardLegL.clone();
    boardLegR.position.set(1.6, 1.25, 0);
    boardGroup.add(boardSurface, boardFrame, boardLegL, boardLegR);
    officeGroup.add(boardGroup);

    // Break Lounge Sofa & Water Cooler
    const sofaGroup = new THREE.Group();
    sofaGroup.position.set(-9.5, 0, -7.5);
    sofaGroup.rotation.y = Math.PI / 2;
    const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.5, 1.4), matChair);
    sofaBase.position.set(0, 0.4, 0);
    const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.0, 0.4), matChair);
    sofaBack.position.set(0, 1.0, -0.6);
    const pillow1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), matYellowAccent);
    pillow1.position.set(-1.2, 0.8, -0.35);
    pillow1.rotation.z = 0.2;
    const pillow2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), matYellowAccent);
    pillow2.position.set(1.2, 0.8, -0.35);
    pillow2.rotation.z = -0.2;
    sofaGroup.add(sofaBase, sofaBack, pillow1, pillow2);
    officeGroup.add(sofaGroup);

    const waterCooler = new THREE.Group();
    waterCooler.position.set(-3.5, 0, -10.5);
    const coolerBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), matWhiteboard);
    coolerBody.position.set(0, 0.9, 0);
    const waterBottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.6, transmission: 0.8 })
    );
    waterBottle.position.set(0, 2.1, 0);
    waterCooler.add(coolerBody, waterBottle);
    officeGroup.add(waterCooler);

    const credenza = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 1.0), createWoodMaterial(WOOD_CREDENZA, 2.6, 1.0, 0.5));
    credenza.position.set(-4.5, 0.6, -7);
    credenza.castShadow = true;
    officeGroup.add(credenza);

    // Interior potted plants: a single low-poly dodecahedron read as a green
    // rock, not foliage. Layered clusters (like the exterior trees) plus a
    // two-tone pot (body + rim trim) reads as an actual plant instead.
    const matPotBody = new THREE.MeshStandardMaterial({ color: 0x3f3a34, roughness: 0.7 });
    const matPotRim = new THREE.MeshStandardMaterial({ color: 0x57504a, roughness: 0.55, metalness: 0.15 });
    const matLeafDark = new THREE.MeshStandardMaterial({ color: 0x1f7a3e, roughness: 0.75 });
    const matLeafLight = new THREE.MeshStandardMaterial({ color: 0x36a457, roughness: 0.75 });
    const createPlant = (x: number, z: number, scale = 1) => {
      const plant = new THREE.Group();
      plant.position.set(x, 0, z);
      plant.scale.set(scale, scale, scale);

      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 16), matPotBody);
      pot.position.set(0, 0.35, 0);
      pot.castShadow = true;
      const potRim = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.46, 0.1, 16), matPotRim);
      potRim.position.set(0, 0.68, 0);
      plant.add(pot, potRim);

      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.8 }));
      stem.position.set(0, 0.95, 0);
      plant.add(stem);

      // Three overlapping foliage clumps instead of one — fuller, less
      // like a single geometric rock sitting in a pot.
      const clumps: [number, number, number, number][] = [
        [0, 1.35, 0, 0.5], [0.35, 1.55, 0.15, 0.36], [-0.3, 1.5, -0.2, 0.34],
      ];
      clumps.forEach(([cx, cy, cz, r], i) => {
        const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 2 === 0 ? matLeafDark : matLeafLight);
        foliage.position.set(cx, cy, cz);
        foliage.rotation.y = Math.random() * Math.PI;
        foliage.castShadow = true;
        plant.add(foliage);
      });

      officeGroup.add(plant);
    };

    createPlant(-14.5, 12, 1.2);
    createPlant(-14.5, 0, 1.0);
    createPlant(14.5, -4, 1.0);
    createPlant(14.5, 8, 1.0);
    createPlant(-14.5, -11, 0.9);

    // ==========================================
    // ANIMATION LOOP & SMART MOVEMENT
    // ==========================================
    let time = 0;
    const animate = () => {
      time += 0.02;

      if (cameraRef.current && controlsRef.current) {
        if (isTransitioningRef.current) {
          cameraRef.current.position.lerp(camTargetPos.current, 0.06);
          controlsRef.current.target.lerp(camTargetLookAt.current, 0.06);
          if (
            cameraRef.current.position.distanceTo(camTargetPos.current) < 0.1 &&
            controlsRef.current.target.distanceTo(camTargetLookAt.current) < 0.1
          ) {
            isTransitioningRef.current = false;
          }
        }
        controlsRef.current.update();
      }

      const nowS = Date.now() / 1000;
      avatarsRef.current.forEach((av) => {
        const dx = av.targetX - av.currentX;
        const dz = av.targetZ - av.currentZ;
        const dist = Math.hypot(dx, dz);
        const walking = dist > 0.06;

        if (walking) {
          av.currentX += dx * 0.04;
          av.currentZ += dz * 0.04;
          av.group.position.x = av.currentX;
          av.group.position.z = av.currentZ;
          av.group.position.y = Math.abs(Math.sin(time * 8)) * 0.06;
          av.group.rotation.y = THREE.MathUtils.lerp(av.group.rotation.y, Math.atan2(dx, dz), 0.15);
          av.arrived = false;

          // Walking limb cycle
          const swing = Math.sin(time * 8) * 0.6;
          av.leftLegPivot.rotation.x = swing;
          av.rightLegPivot.rotation.x = -swing;
          av.leftArmPivot.rotation.x = -swing * 0.7;
          av.rightArmPivot.rotation.x = swing * 0.7;
        } else {
          av.group.position.x = av.targetX;
          av.group.position.z = av.targetZ;
          av.group.position.y = av.isSeated ? -0.22 : 0;
          av.group.rotation.y = THREE.MathUtils.lerp(av.group.rotation.y, av.targetRotY, 0.08);

          // Seated vs Standing Pose
          if (av.isSeated) {
            av.leftLegPivot.rotation.x = -Math.PI / 2.2;
            av.rightLegPivot.rotation.x = -Math.PI / 2.2;
            av.leftArmPivot.rotation.x = -Math.PI / 3 + Math.sin(time * 6) * 0.1; // Typing motion
            av.rightArmPivot.rotation.x = -Math.PI / 3 - Math.sin(time * 6) * 0.1;
            av.headMesh.position.y = 1.42 + Math.sin(time * 3) * 0.02;
            av.headMesh.rotation.x = 0.15 + Math.sin(time * 5) * 0.03;
          } else {
            av.leftLegPivot.rotation.x = THREE.MathUtils.lerp(av.leftLegPivot.rotation.x, 0, 0.15);
            av.rightLegPivot.rotation.x = THREE.MathUtils.lerp(av.rightLegPivot.rotation.x, 0, 0.15);
            av.leftArmPivot.rotation.x = THREE.MathUtils.lerp(av.leftArmPivot.rotation.x, 0, 0.15);
            av.rightArmPivot.rotation.x = THREE.MathUtils.lerp(av.rightArmPivot.rotation.x, 0, 0.15);
            av.headMesh.position.y = 1.5 + Math.sin(time * 2) * 0.02;
            av.headMesh.rotation.x = 0;
          }

          // Autonomous POI Wandering Behavior
          if (!av.arrived) {
            av.arrived = true;
            av.nextMoveAt = nowS + 6.0 + Math.random() * 8.0;
          } else if (nowS >= av.nextMoveAt) {
            if (av.zoneStatus === 'idle') {
              // Idle employees explore all POIs across the entire office
              const randomPoi = IDLE_EXPLORATION_POIS[Math.floor(Math.random() * IDLE_EXPLORATION_POIS.length)];
              av.targetX = randomPoi.x;
              av.targetZ = randomPoi.z;
              av.targetRotY = randomPoi.rotationY;
              av.isSeated = randomPoi.isSeated;
              av.assignedPoi = randomPoi;
              av.arrived = false;
            } else if (av.zoneStatus === 'on_break') {
              // Break employees switch between sofa, coffee, water, and lounge views
              const randomPoi = LOUNGE_POIS[Math.floor(Math.random() * LOUNGE_POIS.length)];
              av.targetX = randomPoi.x;
              av.targetZ = randomPoi.z;
              av.targetRotY = randomPoi.rotationY;
              av.isSeated = randomPoi.isSeated;
              av.assignedPoi = randomPoi;
              av.arrived = false;
            } else if (av.zoneStatus === 'in_meeting') {
              // Meeting employees switch chairs or stand at whiteboard
              const randomPoi = MEETING_POIS[Math.floor(Math.random() * MEETING_POIS.length)];
              av.targetX = randomPoi.x;
              av.targetZ = randomPoi.z;
              av.targetRotY = randomPoi.rotationY;
              av.isSeated = randomPoi.isSeated;
              av.assignedPoi = randomPoi;
              av.arrived = false;
            }
          }
        }

        if (av.auraRing) {
          const pulse = 1 + Math.sin(time * 4) * 0.12;
          av.auraRing.scale.set(pulse, pulse, pulse);
        }

        if (av.speechBubble.visible) {
          const bubblePulse = 1 + Math.sin(time * 5) * 0.1;
          av.speechBubble.scale.set(0.5 * bubblePulse, 0.5 * bubblePulse, 1);
        }
      });

      renderer.render(scene, camera);
      reqAnimRef.current = requestAnimationFrame(animate);
    };

    reqAnimRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth || 900;
      const h = container.clientHeight || 560;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      cancelAnimationFrame(reqAnimRef.current);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Update or Spawn 3D Employee Avatars
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentMap = avatarsRef.current;
    const activeIds = new Set(employees.map((e) => e.employee_id));

    currentMap.forEach((av, id) => {
      if (!activeIds.has(id)) {
        scene.remove(av.group);
        av.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => m.dispose());
          }
        });
        av.nameSprite.material.map?.dispose();
        av.nameSprite.material.dispose();
        av.speechBubble.material.map?.dispose();
        av.speechBubble.material.dispose();
        currentMap.delete(id);
      }
    });

    const counts: Record<string, number> = { working: 0, in_meeting: 0, on_break: 0, idle: 0 };

    employees.forEach((emp) => {
      const isSelected = selectedEmployeeId === emp.employee_id;
      const idx = counts[emp.status] || 0;
      counts[emp.status] = idx + 1;

      let chosenPoi: OfficePOI;
      if (emp.status === 'working') {
        chosenPoi = DESK_POIS[idx % DESK_POIS.length];
      } else if (emp.status === 'in_meeting') {
        chosenPoi = MEETING_POIS[idx % MEETING_POIS.length];
      } else if (emp.status === 'on_break') {
        chosenPoi = LOUNGE_POIS[idx % LOUNGE_POIS.length];
      } else {
        chosenPoi = IDLE_EXPLORATION_POIS[idx % IDLE_EXPLORATION_POIS.length];
      }

      let av = currentMap.get(emp.employee_id);

      if (!av) {
        const group = new THREE.Group();
        group.position.set(chosenPoi.x, 0, chosenPoi.z);

        let colorHash = 0;
        for (let i = 0; i < emp.name.length; i++) colorHash = (colorHash * 31 + emp.name.charCodeAt(i)) >>> 0;
        const shirtPalette = [0x38bdf8, 0xf59e0b, 0x10b981, 0xec4899, 0x8b5cf6, 0x6366f1];
        const shirtColor = shirtPalette[colorHash % shirtPalette.length];
        const pantsColor = 0x1e293b;
        const skinColor = 0xfde047;

        // Torso
        const bodyGeo = new THREE.BoxGeometry(0.75, 0.75, 0.4);
        const bodyMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.65 });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.position.set(0, 0.98, 0);
        bodyMesh.castShadow = true;
        group.add(bodyMesh);

        // Head with Face
        const headGeo = new THREE.BoxGeometry(0.48, 0.48, 0.48);
        const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.5 });
        const faceMat = new THREE.MeshStandardMaterial({ map: getFaceTexture(), roughness: 0.5 });
        const headMaterials = [skinMat, skinMat, skinMat, skinMat, faceMat, skinMat];
        const headMesh = new THREE.Mesh(headGeo, headMaterials);
        headMesh.position.set(0, 1.5, 0);
        headMesh.castShadow = true;
        group.add(headMesh);

        // Hair / Cap
        const hairGeo = new THREE.BoxGeometry(0.52, 0.16, 0.52);
        const hairMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
        const hairMesh = new THREE.Mesh(hairGeo, hairMat);
        hairMesh.position.set(0, 1.74, 0);
        group.add(hairMesh);

        // Arms with Pivot Joints
        const armGeo = new THREE.BoxGeometry(0.28, 0.65, 0.28);
        const armMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.65 });

        const leftArmPivot = new THREE.Group();
        leftArmPivot.position.set(-0.52, 1.3, 0);
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(0, -0.28, 0);
        leftArm.castShadow = true;
        leftArmPivot.add(leftArm);
        group.add(leftArmPivot);

        const rightArmPivot = new THREE.Group();
        rightArmPivot.position.set(0.52, 1.3, 0);
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0, -0.28, 0);
        rightArm.castShadow = true;
        rightArmPivot.add(rightArm);
        group.add(rightArmPivot);

        // Legs with Hip Pivots
        const legGeo = new THREE.BoxGeometry(0.32, 0.65, 0.32);
        const legMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.8 });

        const leftLegPivot = new THREE.Group();
        leftLegPivot.position.set(-0.18, 0.62, 0);
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(0, -0.3, 0);
        leftLeg.castShadow = true;
        leftLegPivot.add(leftLeg);
        group.add(leftLegPivot);

        const rightLegPivot = new THREE.Group();
        rightLegPivot.position.set(0.18, 0.62, 0);
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0, -0.3, 0);
        rightLeg.castShadow = true;
        rightLegPivot.add(rightLeg);
        group.add(rightLegPivot);

        // Overhead Name Sprite
        const nameSprite = createNameSprite(emp.name, emp.role);
        nameSprite.position.set(0, 2.35, 0);
        group.add(nameSprite);

        // Chat-active speech bubble (hidden by default, toggled in the
        // speakingEmployeeId effect below)
        const speechBubble = createSpeechBubbleSprite();
        speechBubble.position.set(0, 2.75, 0);
        speechBubble.visible = false;
        group.add(speechBubble);

        // Floating Selection Halo Ring
        const haloGeo = new THREE.RingGeometry(0.45, 0.55, 32);
        haloGeo.rotateX(-Math.PI / 2);
        const haloMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
        });
        const haloRing = new THREE.Mesh(haloGeo, haloMat);
        haloRing.position.set(0, 2.0, 0);
        haloRing.visible = isSelected;
        group.add(haloRing);

        // Pulsing Floor Status Aura Ring
        const auraGeo = new THREE.RingGeometry(0.65, 0.82, 32);
        auraGeo.rotateX(-Math.PI / 2);
        const auraMat = new THREE.MeshBasicMaterial({
          color: STATUS_COLOR_HEX[emp.status] || 0x94a3b8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        });
        const auraRing = new THREE.Mesh(auraGeo, auraMat);
        auraRing.position.set(0, 0.08, 0);
        group.add(auraRing);

        scene.add(group);

        av = {
          group,
          bodyMesh,
          headMesh,
          haloRing,
          auraRing,
          nameSprite,
          speechBubble,
          leftArmPivot,
          rightArmPivot,
          leftLegPivot,
          rightLegPivot,
          currentX: chosenPoi.x,
          currentZ: chosenPoi.z,
          targetX: chosenPoi.x,
          targetZ: chosenPoi.z,
          targetRotY: chosenPoi.rotationY,
          isSeated: chosenPoi.isSeated,
          employeeId: emp.employee_id,
          assignedPoi: chosenPoi,
          nextMoveAt: Date.now() / 1000 + 4 + Math.random() * 6,
          arrived: true,
          zoneStatus: emp.status,
        };
        currentMap.set(emp.employee_id, av);
      } else {
        if (av.zoneStatus !== emp.status) {
          av.zoneStatus = emp.status;
          av.targetX = chosenPoi.x;
          av.targetZ = chosenPoi.z;
          av.targetRotY = chosenPoi.rotationY;
          av.isSeated = chosenPoi.isSeated;
          av.assignedPoi = chosenPoi;
          av.arrived = false;
        }
        av.haloRing.visible = isSelected;
        (av.auraRing.material as THREE.MeshBasicMaterial).color.setHex(STATUS_COLOR_HEX[emp.status] || 0x94a3b8);
      }
    });
  }, [employees, selectedEmployeeId]);

  // Chat-active speech bubble: independent of the employees/status sync
  // above so it reacts immediately when a chat starts/stops streaming.
  useEffect(() => {
    avatarsRef.current.forEach((av) => {
      av.speechBubble.visible = av.employeeId === speakingEmployeeId;
    });
  }, [speakingEmployeeId]);

  // Click & Hover Raycaster handling
  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !cameraRef.current) return;

    const rect = canvas.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    let foundEmp: Employee | null = null;
    const avatarGroups: THREE.Object3D[] = [];
    avatarsRef.current.forEach((av) => avatarGroups.push(av.group));

    const intersects = raycasterRef.current.intersectObjects(avatarGroups, true);
    if (intersects.length > 0) {
      let topObj: THREE.Object3D | null = intersects[0].object;
      while (topObj && topObj.parent && topObj.parent !== sceneRef.current) {
        topObj = topObj.parent;
      }
      if (topObj) {
        avatarsRef.current.forEach((av) => {
          if (av.group === topObj) {
            const match = employees.find((e) => e.employee_id === av.employeeId);
            if (match) foundEmp = match;
          }
        });
      }
    }
    setHoveredEmp(foundEmp);
  };

  const handleCanvasClick = () => {
    if (hoveredEmp && onSelectEmployee) {
      onSelectEmployee(hoveredEmp);
      const av = avatarsRef.current.get(hoveredEmp.employee_id);
      if (av) {
        isTransitioningRef.current = true;
        camTargetPos.current.set(av.targetX + 8, 8, av.targetZ + 8);
        camTargetLookAt.current.set(av.targetX, 1.2, av.targetZ);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : undefined,
        left: isFullscreen ? 0 : undefined,
        width: '100%',
        height: isFullscreen ? '100vh' : '620px',
        backgroundColor: '#0c0f14',
        borderRadius: isFullscreen ? '0' : '12px',
        border: isFullscreen ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
        overflow: 'hidden',
        boxShadow: '0 20px 40px -15px rgba(0,0,0,0.5)',
        zIndex: isFullscreen ? 99999 : 1,
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerMove={handleCanvasPointerMove}
        onClick={handleCanvasClick}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: hoveredEmp ? 'pointer' : 'grab',
        }}
      />

      {/* Top Floating Control Bar */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          right: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '4px',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            className={`btn-office-nav ${activeView === 'overview' ? 'active' : ''}`}
            onClick={() => setCameraPreset('overview')}
            title="Overview 3D Office"
          >
            <RotateCcw size={12} />
            <span>Overview</span>
          </button>
          <button
            type="button"
            className={`btn-office-nav ${activeView === 'desks' ? 'active' : ''}`}
            onClick={() => setCameraPreset('desks')}
            title="Developer Workstations"
          >
            <Monitor size={12} />
            <span>Desks</span>
          </button>
          <button
            type="button"
            className={`btn-office-nav ${activeView === 'meeting' ? 'active' : ''}`}
            onClick={() => setCameraPreset('meeting')}
            title="Conference Room"
          >
            <Users size={12} />
            <span>Meeting</span>
          </button>
          <button
            type="button"
            className={`btn-office-nav ${activeView === 'lounge' ? 'active' : ''}`}
            onClick={() => setCameraPreset('lounge')}
            title="Break Lounge"
          >
            <Coffee size={12} />
            <span>Lounge</span>
          </button>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '4px',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            className="btn-office-icon"
            onClick={handleZoomIn}
            title="Zoom In (+)"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="btn-office-icon"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
          >
            <ZoomOut size={13} />
          </button>

          <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

          <button
            type="button"
            className={`btn-office-icon ${lighting === 'day' ? 'active' : ''}`}
            onClick={() => setLighting('day')}
            title="Daylight Mode"
          >
            <Sun size={13} />
          </button>
          <button
            type="button"
            className={`btn-office-icon ${lighting === 'sunset' ? 'active' : ''}`}
            onClick={() => setLighting('sunset')}
            title="Golden Hour Sunset"
          >
            <Sunset size={13} />
          </button>
          <button
            type="button"
            className={`btn-office-icon ${lighting === 'night' ? 'active' : ''}`}
            onClick={() => setLighting('night')}
            title="Cyberpunk Night"
          >
            <Moon size={13} />
          </button>

          <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

          <button
            type="button"
            className="btn-office-icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen 3D Mode'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Dynamic Hint Pill */}
      <div
        style={{
          position: 'absolute',
          top: '64px',
          right: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '6px',
          padding: '4px 10px',
          pointerEvents: 'none',
          fontSize: '10.5px',
          color: 'var(--text-dim)',
        }}
      >
        <span>🖱️ Drag to rotate</span>
        <span>•</span>
        <span>Right-click / Drag to pan</span>
        <span>•</span>
        <span>Scroll to zoom</span>
      </div>

      {/* Bottom Floating Stats Pill */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '14px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '8px',
          padding: '8px 14px',
          pointerEvents: 'none',
          fontSize: '11.5px',
          color: 'var(--text-dim)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#38bdf8' }} />
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{stats.working}</span> Working
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a855f7' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#a855f7' }} />
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{stats.meeting}</span> Meeting
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f59e0b' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#f59e0b' }} />
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{stats.break}</span> Break
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#94a3b8' }} />
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{stats.idle}</span> Idle
        </div>
      </div>

      {/* Hover Employee Profile Card */}
      {hoveredEmp && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          <div style={{ fontSize: '26px' }}>{hoveredEmp.avatar || '🧑‍💻'}</div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{hoveredEmp.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{hoveredEmp.role || 'AI Employee'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor:
                    hoveredEmp.status === 'working'
                      ? '#38bdf8'
                      : hoveredEmp.status === 'in_meeting'
                      ? '#a855f7'
                      : hoveredEmp.status === 'on_break'
                      ? '#f59e0b'
                      : '#94a3b8',
                }}
              />
              <span style={{ fontSize: '10.5px', textTransform: 'capitalize', color: 'var(--text-dim)' }}>
                {hoveredEmp.status.replace('_', ' ')}
              </span>
            </div>
          </div>
          <div style={{ marginLeft: '8px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', fontSize: '10.5px' }}>
            Click to inspect
          </div>
        </div>
      )}

      {/* Embedded CSS */}
      <style>{`
        .btn-office-nav {
          background: transparent;
          border: none;
          color: #94a3b8;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .btn-office-nav:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.08);
        }
        .btn-office-nav.active {
          color: #ffffff;
          background: #2563eb;
        }
        .btn-office-icon {
          background: transparent;
          border: none;
          color: #94a3b8;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .btn-office-icon:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.08);
        }
        .btn-office-icon.active {
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.15);
        }
      `}</style>
    </div>
  );
}
