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
  Sparkles,
  Search,
  CheckCircle2,
  Zap,
} from 'lucide-react';

interface OfficeCanvasProps {
  employees: Employee[];
  onSelectEmployee?: (employee: Employee) => void;
  selectedEmployeeId?: string | null;
}

type LightingPreset = 'day' | 'night' | 'sunset';
type CameraViewPreset = 'overview' | 'desks' | 'meeting' | 'lounge' | 'focus';

// Zone slot definitions in 3D space
interface Slot {
  x: number;
  z: number;
  rotationY: number;
  isSeated: boolean;
  type: 'desk' | 'meeting' | 'lounge' | 'lobby' | 'focus';
}

const DESK_SLOTS: Slot[] = [
  // Front Desk Row
  { x: -11.5, z: 9.5, rotationY: 0, isSeated: true, type: 'desk' },
  { x: -8.5, z: 9.5, rotationY: 0, isSeated: true, type: 'desk' },
  { x: -5.5, z: 9.5, rotationY: 0, isSeated: true, type: 'desk' },
  // Back Desk Row (Facing front)
  { x: -11.5, z: 2.5, rotationY: 0, isSeated: true, type: 'desk' },
  { x: -8.5, z: 2.5, rotationY: 0, isSeated: true, type: 'desk' },
  { x: -5.5, z: 2.5, rotationY: 0, isSeated: true, type: 'desk' },
];

const MEETING_SLOTS: Slot[] = [
  { x: 5.5, z: 2, rotationY: Math.PI / 2, isSeated: true, type: 'meeting' },
  { x: 10.5, z: 2, rotationY: -Math.PI / 2, isSeated: true, type: 'meeting' },
  { x: 7, z: -1.5, rotationY: 0, isSeated: true, type: 'meeting' },
  { x: 9, z: -1.5, rotationY: 0, isSeated: true, type: 'meeting' },
  { x: 7, z: 5.5, rotationY: Math.PI, isSeated: true, type: 'meeting' },
  { x: 9, z: 5.5, rotationY: Math.PI, isSeated: true, type: 'meeting' },
  // Presenter standing by whiteboard
  { x: 6, z: -4, rotationY: Math.PI * 0.75, isSeated: false, type: 'meeting' },
];

const LOUNGE_SLOTS: Slot[] = [
  // Sofa seats
  { x: -9.5, z: -8, rotationY: Math.PI / 2, isSeated: true, type: 'lounge' },
  { x: -9.5, z: -6.5, rotationY: Math.PI / 2, isSeated: true, type: 'lounge' },
  // Standing by water cooler / coffee credenza
  { x: -4.5, z: -6.5, rotationY: -Math.PI * 0.4, isSeated: false, type: 'lounge' },
  { x: -4.5, z: -8.5, rotationY: -Math.PI * 0.6, isSeated: false, type: 'lounge' },
];

const LOBBY_SLOTS: Slot[] = [
  { x: 0, z: 8, rotationY: -Math.PI * 0.25, isSeated: false, type: 'lobby' },
  { x: 1.5, z: 5, rotationY: Math.PI * 0.5, isSeated: false, type: 'lobby' },
  { x: -1.5, z: 5, rotationY: -Math.PI * 0.5, isSeated: false, type: 'lobby' },
  { x: 0, z: 2, rotationY: 0, isSeated: false, type: 'lobby' },
];

const FOCUS_SLOT: Slot = { x: -0.5, z: -9.5, rotationY: 0, isSeated: true, type: 'focus' };

const STATUS_COLOR_HEX = {
  working: 0x38bdf8,   // Vibrant Cyan
  in_meeting: 0xa855f7,// Purple
  on_break: 0xf59e0b,  // Amber
  idle: 0x94a3b8,      // Slate
};

function getSlotForEmployee(emp: Employee, indexInStatus: number): Slot {
  switch (emp.status) {
    case 'working':
      return DESK_SLOTS[indexInStatus % DESK_SLOTS.length] || DESK_SLOTS[0];
    case 'in_meeting':
      return MEETING_SLOTS[indexInStatus % MEETING_SLOTS.length] || MEETING_SLOTS[0];
    case 'on_break':
      return LOUNGE_SLOTS[indexInStatus % LOUNGE_SLOTS.length] || LOUNGE_SLOTS[0];
    case 'idle':
    default:
      if (indexInStatus === 0 && Math.random() > 0.5) return FOCUS_SLOT;
      return LOBBY_SLOTS[indexInStatus % LOBBY_SLOTS.length] || LOBBY_SLOTS[0];
  }
}

// Procedural 3D Avatar representation
interface AvatarMeshGroup {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  headMesh: THREE.Mesh;
  haloRing: THREE.Mesh;
  auraRing: THREE.Mesh;
  currentX: number;
  currentZ: number;
  targetX: number;
  targetZ: number;
  targetRotY: number;
  isSeated: boolean;
  employeeId: string;
}

export function OfficeCanvas({ employees, onSelectEmployee, selectedEmployeeId }: OfficeCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lighting, setLighting] = useState<LightingPreset>('day');
  const [activeView, setActiveView] = useState<CameraViewPreset>('overview');
  const [hoveredEmp, setHoveredEmp] = useState<Employee | null>(null);
  const [stats, setStats] = useState({ working: 0, meeting: 0, break: 0, idle: 0 });

  // Three.js instance references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const avatarsRef = useRef<Map<string, AvatarMeshGroup>>(new Map());
  const lightsRef = useRef<{ dirLight?: THREE.DirectionalLight; ambLight?: THREE.AmbientLight; deskLights?: THREE.PointLight[] }>({});
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const reqAnimRef = useRef<number>(0);

  // Target camera state for smooth transitions
  const camTargetPos = useRef<THREE.Vector3>(new THREE.Vector3(26, 22, 26));
  const camTargetLookAt = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));

  // Compute stats
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

  // Set camera view preset
  const setCameraPreset = useCallback((preset: CameraViewPreset) => {
    setActiveView(preset);
    switch (preset) {
      case 'desks':
        camTargetPos.current.set(-1, 14, 18);
        camTargetLookAt.current.set(-8.5, 2, 6);
        break;
      case 'meeting':
        camTargetPos.current.set(18, 14, 12);
        camTargetLookAt.current.set(8, 2, 2);
        break;
      case 'lounge':
        camTargetPos.current.set(-2, 14, -2);
        camTargetLookAt.current.set(-7, 2, -7.5);
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

  // Update lighting preset
  useEffect(() => {
    const { dirLight, ambLight, deskLights } = lightsRef.current;
    if (!dirLight || !ambLight) return;

    if (lighting === 'day') {
      ambLight.color.setHex(0xffffff);
      ambLight.intensity = 0.75;
      dirLight.color.setHex(0xfffaed);
      dirLight.intensity = 1.35;
      dirLight.position.set(28, 35, 24);
      deskLights?.forEach((l) => { l.intensity = 0.4; l.color.setHex(0xffedd5); });
    } else if (lighting === 'night') {
      ambLight.color.setHex(0x1e293b);
      ambLight.intensity = 0.4;
      dirLight.color.setHex(0x38bdf8);
      dirLight.intensity = 0.5;
      dirLight.position.set(-20, 30, 20);
      deskLights?.forEach((l) => { l.intensity = 1.2; l.color.setHex(0x38bdf8); });
    } else if (lighting === 'sunset') {
      ambLight.color.setHex(0xfde047);
      ambLight.intensity = 0.5;
      dirLight.color.setHex(0xf97316);
      dirLight.intensity = 1.4;
      dirLight.position.set(30, 18, 15);
      deskLights?.forEach((l) => { l.intensity = 0.8; l.color.setHex(0xfbbf24); });
    }
  }, [lighting]);

  // Main 3D Office Construction
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 560;

    // 1. Scene & Camera setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0f14);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 200);
    camera.position.set(24, 20, 24);
    cameraRef.current = camera;

    // 2. Renderer
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

    // 3. OrbitControls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.15; // Don't allow camera under floor
    controls.minDistance = 8;
    controls.maxDistance = 55;
    controls.target.set(0, 1, 0);
    controlsRef.current = controls;

    // 4. Lights
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

    // Warm desk lights
    const deskLights: THREE.PointLight[] = [];
    const deskLight1 = new THREE.PointLight(0xffedd5, 0.5, 15);
    deskLight1.position.set(-8.5, 5, 6);
    scene.add(deskLight1);
    deskLights.push(deskLight1);

    const meetingLight = new THREE.PointLight(0xfef08a, 0.6, 16);
    meetingLight.position.set(8, 6, 2);
    scene.add(meetingLight);
    deskLights.push(meetingLight);

    lightsRef.current = { dirLight, ambLight: ambientLight, deskLights };

    // ==========================================
    // 5. ARCHITECTURAL STRUCTURE & ROOMS
    // ==========================================
    const officeGroup = new THREE.Group();
    scene.add(officeGroup);

    // Materials Palette (Matching reference photo)
    const matMatteFloor = new THREE.MeshStandardMaterial({ color: 0x181c24, roughness: 0.7, metalness: 0.1 });
    const matParquetFloor = new THREE.MeshStandardMaterial({ color: 0x5c331a, roughness: 0.45, metalness: 0.1 });
    const matCorridorFloor = new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.35, metalness: 0.2 });
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
    const matDeskTop = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 });
    const matBlackLegs = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5, metalness: 0.8 });
    const matChair = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.6 });
    const matWhiteboard = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 });
    const matScreenGlow = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.8 });

    // --- Base Plinth Ground ---
    const plinthGeo = new THREE.BoxGeometry(36, 0.8, 32);
    const plinthMesh = new THREE.Mesh(plinthGeo, new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 0.9 }));
    plinthMesh.position.set(0, -0.4, 0);
    plinthMesh.receiveShadow = true;
    officeGroup.add(plinthMesh);

    // --- Floor 1: Open Desks Workspace (Left) ---
    const deskFloorGeo = new THREE.BoxGeometry(16, 0.1, 17);
    const deskFloor = new THREE.Mesh(deskFloorGeo, matMatteFloor);
    deskFloor.position.set(-8.5, 0.05, 6);
    deskFloor.receiveShadow = true;
    officeGroup.add(deskFloor);

    // --- Floor 2: Meeting Room (Right Parquet) ---
    const meetingFloorGeo = new THREE.BoxGeometry(16, 0.1, 18);
    const meetingFloor = new THREE.Mesh(meetingFloorGeo, matParquetFloor);
    meetingFloor.position.set(8.5, 0.05, 1.5);
    meetingFloor.receiveShadow = true;
    officeGroup.add(meetingFloor);

    // --- Floor 3: Break Lounge (Top-Left) ---
    const loungeFloorGeo = new THREE.BoxGeometry(14, 0.1, 11);
    const loungeFloor = new THREE.Mesh(loungeFloorGeo, matMatteFloor);
    loungeFloor.position.set(-7.5, 0.05, -8);
    loungeFloor.receiveShadow = true;
    officeGroup.add(loungeFloor);

    // --- Floor 4: Corridor & Entryway ---
    const corridorGeo = new THREE.BoxGeometry(34, 0.08, 30);
    const corridor = new THREE.Mesh(corridorGeo, matCorridorFloor);
    corridor.position.set(0, 0.04, 0);
    corridor.receiveShadow = true;
    officeGroup.add(corridor);

    // --- Perimeter & Cutaway Outer Walls ---
    const createWall = (x: number, y: number, z: number, w: number, h: number, d: number, mat = matDarkWall) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      officeGroup.add(mesh);
      return mesh;
    };

    // Back perimeter walls
    createWall(-8.5, 2.5, -13.6, 17, 5, 0.6);
    createWall(8.5, 2.5, -7.6, 17, 5, 0.6, matBrick);

    // Far-left perimeter wall with Yellow Acoustic Wave Texture Panel
    createWall(-16.8, 2.5, 0, 0.6, 5, 27);
    const wavePanel = createWall(-16.4, 2.5, 6, 0.3, 4, 12, matYellowAccent);
    wavePanel.castShadow = true;

    // Far-right glass facade wall
    createWall(16.8, 2.5, 1.5, 0.6, 5, 18, matGlass);
    createWall(16.8, 0.2, 1.5, 0.7, 0.4, 18, matGlassFrame);
    createWall(16.8, 4.8, 1.5, 0.7, 0.4, 18, matGlassFrame);

    // --- Interior Slatted Wood Partition (between desks & corridor) ---
    for (let i = 0; i < 18; i++) {
      createWall(-0.5, 2.2, 14.5 - i * 0.7, 0.15, 4.4, 0.2, matWoodSlat);
    }

    // --- Glass Partitions & Meeting Room Walls ---
    createWall(0.5, 2.5, 1.5, 0.2, 5, 17, matGlass);
    createWall(0.5, 0.2, 1.5, 0.35, 0.4, 17, matGlassFrame);
    createWall(0.5, 4.8, 1.5, 0.35, 0.4, 17, matGlassFrame);
    for (let z = -6; z <= 9; z += 3) {
      createWall(0.5, 2.5, z, 0.35, 5, 0.2, matGlassFrame);
    }
    createWall(0.5, 2.2, 7.5, 0.4, 4.4, 0.3, matYellowAccent);

    // ==========================================
    // 6. FURNITURE & PROPS
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

    // --- Meeting Room: Yellow Oval Conference Table ---
    const meetingTableGroup = new THREE.Group();
    meetingTableGroup.position.set(8, 0, 2);

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

    const chairPositions = [
      { x: -3.8, z: 0, r: Math.PI / 2 },
      { x: 3.8, z: 0, r: -Math.PI / 2 },
      { x: -1.8, z: -2.0, r: 0 },
      { x: 0, z: -2.0, r: 0 },
      { x: 1.8, z: -2.0, r: 0 },
      { x: -1.8, z: 2.0, r: Math.PI },
      { x: 0, z: 2.0, r: Math.PI },
      { x: 1.8, z: 2.0, r: Math.PI },
    ];
    for (const cp of chairPositions) {
      const c = new THREE.Group();
      c.position.set(cp.x, 0, cp.z);
      c.rotation.y = cp.r;
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
    waterCooler.position.set(-3.5, 0, -11.5);
    const coolerBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), matWhiteboard);
    coolerBody.position.set(0, 0.9, 0);
    const waterBottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.6, transmission: 0.8 })
    );
    waterBottle.position.set(0, 2.1, 0);
    waterCooler.add(coolerBody, waterBottle);
    officeGroup.add(waterCooler);

    const credenza = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 1.0), matYellowAccent);
    credenza.position.set(-4.5, 0.6, -8);
    credenza.castShadow = true;
    officeGroup.add(credenza);

    const createPlant = (x: number, z: number, scale = 1) => {
      const plant = new THREE.Group();
      plant.position.set(x, 0, z);
      plant.scale.set(scale, scale, scale);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 16), matBlackLegs);
      pot.position.set(0, 0.35, 0);
      pot.castShadow = true;
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.6 });
      const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 1), leafMat);
      foliage.position.set(0, 1.2, 0);
      foliage.castShadow = true;
      plant.add(pot, foliage);
      officeGroup.add(plant);
    };

    createPlant(-14.5, 12, 1.2);
    createPlant(-0.5, 12, 1.1);
    createPlant(14.5, -4, 1.0);
    createPlant(14.5, 8, 1.0);
    createPlant(-14.5, -11, 0.9);

    // ==========================================
    // 7. ANIMATION LOOP & RESIZE
    // ==========================================
    let time = 0;
    const animate = () => {
      time += 0.02;

      if (cameraRef.current && controlsRef.current) {
        cameraRef.current.position.lerp(camTargetPos.current, 0.05);
        controlsRef.current.target.lerp(camTargetLookAt.current, 0.05);
        controlsRef.current.update();
      }

      avatarsRef.current.forEach((av) => {
        const dx = av.targetX - av.currentX;
        const dz = av.targetZ - av.currentZ;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.05) {
          av.currentX += dx * 0.06;
          av.currentZ += dz * 0.06;
          av.group.position.x = av.currentX;
          av.group.position.z = av.currentZ;
          av.group.position.y = Math.abs(Math.sin(time * 8)) * 0.15;
          av.group.rotation.y = Math.atan2(dx, dz);
        } else {
          av.group.position.x = av.targetX;
          av.group.position.z = av.targetZ;
          av.group.position.y = av.isSeated ? -0.25 : 0;
          av.group.rotation.y = THREE.MathUtils.lerp(av.group.rotation.y, av.targetRotY, 0.08);

          if (av.isSeated) {
            av.headMesh.position.y = 1.35 + Math.sin(time * 3) * 0.03;
            av.headMesh.rotation.x = 0.15 + Math.sin(time * 6) * 0.04;
          } else {
            av.headMesh.position.y = 1.55 + Math.sin(time * 2) * 0.02;
          }
        }

        if (av.auraRing) {
          const pulse = 1 + Math.sin(time * 4) * 0.12;
          av.auraRing.scale.set(pulse, pulse, pulse);
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

    return () => {
      window.removeEventListener('resize', handleResize);
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
        currentMap.delete(id);
      }
    });

    const countByStatus: Record<string, number> = { working: 0, in_meeting: 0, on_break: 0, idle: 0 };

    employees.forEach((emp) => {
      const statusIdx = countByStatus[emp.status] || 0;
      countByStatus[emp.status] = statusIdx + 1;

      const slot = getSlotForEmployee(emp, statusIdx);
      const isSelected = selectedEmployeeId === emp.employee_id;

      let av = currentMap.get(emp.employee_id);

      if (!av) {
        const group = new THREE.Group();
        group.position.set(slot.x, 0, slot.z);

        let colorHash = 0;
        for (let i = 0; i < emp.name.length; i++) colorHash = (colorHash * 31 + emp.name.charCodeAt(i)) >>> 0;
        const shirtPalette = [0x38bdf8, 0xf59e0b, 0x10b981, 0xec4899, 0x8b5cf6, 0x6366f1];
        const shirtColor = shirtPalette[colorHash % shirtPalette.length];

        const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.6, 8, 16);
        const bodyMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.5 });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.position.set(0, 0.85, 0);
        bodyMesh.castShadow = true;
        group.add(bodyMesh);

        const headGeo = new THREE.SphereGeometry(0.24, 16, 16);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.4 });
        const headMesh = new THREE.Mesh(headGeo, headMat);
        headMesh.position.set(0, 1.45, 0);
        headMesh.castShadow = true;
        group.add(headMesh);

        const hairGeo = new THREE.SphereGeometry(0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const hairMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
        const hairMesh = new THREE.Mesh(hairGeo, hairMat);
        hairMesh.position.set(0, 1.48, 0);
        group.add(hairMesh);

        const haloGeo = new THREE.RingGeometry(0.35, 0.42, 32);
        haloGeo.rotateX(-Math.PI / 2);
        const haloMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
        });
        const haloRing = new THREE.Mesh(haloGeo, haloMat);
        haloRing.position.set(0, 1.85, 0);
        haloRing.visible = isSelected;
        group.add(haloRing);

        const auraGeo = new THREE.RingGeometry(0.6, 0.75, 32);
        auraGeo.rotateX(-Math.PI / 2);
        const auraMat = new THREE.MeshBasicMaterial({
          color: STATUS_COLOR_HEX[emp.status] || 0x94a3b8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
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
          currentX: slot.x,
          currentZ: slot.z,
          targetX: slot.x,
          targetZ: slot.z,
          targetRotY: slot.rotationY,
          isSeated: slot.isSeated,
          employeeId: emp.employee_id,
        };
        currentMap.set(emp.employee_id, av);
      } else {
        av.targetX = slot.x;
        av.targetZ = slot.z;
        av.targetRotY = slot.rotationY;
        av.isSeated = slot.isSeated;
        av.haloRing.visible = isSelected;
        (av.auraRing.material as THREE.MeshBasicMaterial).color.setHex(STATUS_COLOR_HEX[emp.status] || 0x94a3b8);
      }
    });
  }, [employees, selectedEmployeeId]);

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
        camTargetPos.current.set(av.targetX + 8, 8, av.targetZ + 8);
        camTargetLookAt.current.set(av.targetX, 1.2, av.targetZ);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: isFullscreen ? '100vh' : '580px',
        backgroundColor: '#0c0f14',
        borderRadius: isFullscreen ? '0' : '12px',
        border: isFullscreen ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
        overflow: 'hidden',
        boxShadow: '0 20px 40px -15px rgba(0,0,0,0.5)',
        zIndex: isFullscreen ? 99999 : 1,
      }}
    >
      {/* Three.js Canvas */}
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
        {/* Left: Room Navigation Badges */}
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

        {/* Right: Lighting Mode & Fullscreen */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
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

      {/* Embedded CSS for 3D Overlay buttons */}
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
