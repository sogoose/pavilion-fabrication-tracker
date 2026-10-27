// LAMA Slicer - interface
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ModelArm, UR_COLOURS, DeltaPrinter, moduleExtruder, stationExtruder, stationTable, loadModel, frameMatrix, zyz } from './robots.js';
import { parseGcode } from './gcode.js';

const $ = id => document.getElementById(id);
const D2R = Math.PI / 180;
const SETTINGS_VERSION = 2;
const MACHINES = { wasp: 'WASP 40100', ur5: 'UR5', comau: 'Comau NJ60-2.2' };
const TYPE_STYLE = {
  external: { color: 0x00a6d6, label: 'Outer wall' },
  perimeter: { color: 0x0c2340, label: 'Inner wall' },
  infill: { color: 0x9aa5b1, label: 'Infill / weave' },
  fill: { color: 0x5c6670, label: 'Fill' },
  custom: { color: 0x00a6d6, label: 'Imported path' },
  other: { color: 0xc8102e, label: 'Other' },
};
// preview highlights (TU Delft secondary colours)
const HL_STYLE = {
  seams: { color: 0xe03c31, label: 'Seams', title: 'start / end of every closed loop' },
  anchors: { color: 0xffb81c, label: 'Anchors', title: 'infill bead touching another infill bead (weave peak contacts)' },
  overlaps: { color: 0x6cc24a, label: 'Overlaps', title: 'infill bead touching a wall (wall-contact plateaus)' },
};
const WALL_TYPES = new Set(['external', 'perimeter']);
// values of the .pdl conversion that stay as in converters/settings.json (not editable here)
const PDL_EDITABLE = ['print_speed_mm_s', 'travel_speed_mm_s', 'flow_rate_S', 'extrusion_factor', 'first_layer_z', 'placement', 'tool', 'uframe', 'home', 'orient', 'config', 'approach_speed'];
const ROT_PRESETS = [0, 30, 45, 60, 90, 120, 135, 150, 180, 270];

// ------------------------------------------------------------------------------ state
let CONFIG = null;
const state = {
  v: SETTINGS_VERSION,
  config: 'standard',    // configuration mode (configurations/*.json): standard or a project configuration such as earthen
  machine: 'comau',
  toolpath: 'N2',
  params: {},          // per machine: nozzle, layer_height, first_layer_height
  pdl: {},
  ur5: { plate: [0, -400, 6], tcp: [0, 0, 150, 0, 0, 0] },
  scene: {               // view only: print boards, robot base plates, UR5 rotation on its table
    comau: { board: [600, 600, 18], base: [1200, 1200, 30, -19, 0] },   // base plate from Environment.3dm
    ur5: { board: [400, 400, 6], base: [0, 0, 0, 0, 0], rot: [0] },
  },
  out_name: '',
  out_dir: '',
  adv: {},               // Advanced settings per toolpath: {N2: {ANCHOR: 6}, ...} (only changed values)
  gs: {},                // general settings (G-code writer: speed, material, printer, time correction), only changed values
  rel: 1,                // adv / gs values that follow the nozzle / layer height are stored for the 6 mm bead, 3.5 mm layer
  out_results: true,     // export the results as .txt
  out_preview: false,    // export the layer preview of the toolpath settings as .png
};
const objects = [];    // on the plate: {id, name, group, pivot, proxy, mesh, unit, rot:[x,y,z] deg, size, visible}
const registry = new Map();   // every object ever added (undo can bring deleted ones back)
let solo = false;             // show only the selected object
let machineView = 'solid';    // preview: solid | ghost | hidden
let selected = null;
let sliced = null;     // {kind:'slice'|'gcode', slice_id, layers, ...}
let stale = false;
let mode = 'prepare';
let objId = 0;
let rotAxis = 2;

// ------------------------------------------------------------------------------ scene
const vp = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
vp.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 5, 60000);
camera.up.set(0, 0, 1);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.screenSpacePanning = true;
  // Rhino-style navigation (pavilion website): left select, right-drag orbit (pan in Top / Front),
  // Shift + right-drag orbit, Ctrl + right-drag zoom, middle-drag pan, wheel zoom to the cursor.
  let rhinoViewMode = 'perspective';
  orbit.mouseButtons.LEFT = -1;
  orbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  orbit.zoomToCursor = true;
  orbit.zoomSpeed = 1.15;
  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 2) return;
    orbit.mouseButtons.RIGHT = (e.ctrlKey || e.metaKey) ? THREE.MOUSE.DOLLY
      : e.shiftKey ? THREE.MOUSE.ROTATE : rhinoViewMode === 'parallel' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }, { capture: true });
  const clearRhinoPointer = e => { if (!e || e.button === 2) orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; };
  renderer.domElement.addEventListener('pointerup', clearRhinoPointer, { capture: true });
  renderer.domElement.addEventListener('pointercancel', () => clearRhinoPointer(), { capture: true });
  window.addEventListener('blur', () => clearRhinoPointer());


scene.add(new THREE.HemisphereLight(0xffffff, 0x8a939c, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(2500, -1800, 4200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3000, right: 3000, top: 3000, bottom: -3000, near: 100, far: 12000 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xe8f4ff, 0.55);
fill.position.set(-3000, 2500, 1500);
scene.add(fill);

const ground = new THREE.Group();
scene.add(ground);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.ShadowMaterial({ opacity: 0.16 }));
floor.receiveShadow = true;
floor.position.z = -0.5;
ground.add(floor);
const grid = new THREE.GridHelper(8000, 80, 0x8f9aa5, 0xc4cbd2);
grid.rotation.x = Math.PI / 2;
grid.material.transparent = true;
grid.material.opacity = 0.6;
ground.add(grid);
const grid10 = new THREE.GridHelper(8000, 8, 0x6f7a85, 0x6f7a85);
grid10.rotation.x = Math.PI / 2;
grid10.position.z = 0.2;
ground.add(grid10);

const machineRoot = new THREE.Group();   // robot / printer / station
scene.add(machineRoot);
const plate = new THREE.Group();         // plate frame: origin = (0,0,0) of the print
plate.matrixAutoUpdate = false;
scene.add(plate);
const plateVisual = new THREE.Group();
plate.add(plateVisual);
const objectsRoot = new THREE.Group();
plate.add(objectsRoot);
const previewRoot = new THREE.Group();
plate.add(previewRoot);

const tcontrols = new TransformControls(camera, renderer.domElement);
tcontrols.setSpace('world');
tcontrols.setSize(0.9);
scene.add(tcontrols);
const frameHandle = new THREE.Object3D();   // gizmo handle for moving the print frame
scene.add(frameHandle);
let tMode = 'translate';                    // translate | rotate | frame
tcontrols.addEventListener('dragging-changed', e => {
  orbit.enabled = !e.value;
  if (e.value) return;
  if (tMode === 'frame') { saveSettings(); markStale(); return; }
  if (selected) { showObjectProps(); placementChanged(); }
});
tcontrols.addEventListener('objectChange', () => {
  if (tMode === 'frame') {                  // frame dragged: x, y in the robot base frame (1 mm steps)
    const v = frameVec();
    v[0] = Math.round(frameHandle.position.x); v[1] = Math.round(frameHandle.position.y);
    frameHandle.position.z = v[2];
    setFrameVec(v);
    applyFrame();
    return;
  }
  if (!selected) return;
  if (tMode === 'scale') {                  // scale handle: object axes; the centre box scales uniformly
    const p = selected.proxy.scale, o = selected, lock = $('scaleLock').checked;
    let sc = [p.x, p.y, p.z].map(v => Math.min(100, Math.max(0.01, Math.abs(v))));
    if (lock) { const k = [0, 1, 2].reduce((a, i) => Math.abs(sc[i] - o.scale[i]) > Math.abs(sc[a] - o.scale[a]) ? i : a, 0); sc = [sc[k], sc[k], sc[k]]; }
    o.scale = sc.map(v => Math.round(v * 1000) / 1000);
    selected.proxy.scale.set(...o.scale);
    applyRotation(o, false);
  } else if (tcontrols.mode === 'translate') {
    selected.group.position.z = 0;
  } else {
    const e = new THREE.Euler().setFromQuaternion(selected.proxy.quaternion, 'ZYX');
    selected.rot = [e.x, e.y, e.z].map(v => Math.round(v / D2R * 100) / 100);
    applyRotation(selected, false);
  }
  showObjectProps();
});

let machine = null;   // {kind, obj, seeds}
let buildToken = 0;
async function buildMachine() {
  const token = ++buildToken;
  const m = state.machine;
  const model = await loadModel({ wasp: 'wasp', ur5: 'ur5', comau: 'comau_nj60' }[m]);
  const station = m === 'ur5' ? await loadModel('ur5_station') : null;
  const wasp = m === 'comau' ? await loadModel('wasp') : null;     // the Comau extruder is drawn like the WASP one
  if (token !== buildToken) return;
  machineRoot.clear();
  plateVisual.clear();
  let floorZ = 0;
  if (m === 'wasp') {
    machine = { kind: 'delta', obj: new DeltaPrinter(model) };
    machineRoot.add(machine.obj.root);
    plate.matrix.identity();
    floorZ = model.meta.floor_z;
  } else {
    let arm;
    if (m === 'comau') {                // RoboDK model, joints = Comau J1..J6, IK starts from the PDL home pose
      arm = new ModelArm(model);
      arm.setTool(vec(state.pdl.tool, 6), moduleExtruder(wasp));
      const home = vec(state.pdl.home, 6);
      arm.setQ(home.map(v => v * D2R));
      machine = { kind: 'arm', obj: arm, seeds: [home] };
    } else {                            // UR5 from RoboDK, extruder + tank from the station file, elbow-up start pose
      arm = new ModelArm(model, UR_COLOURS);
      arm.setTool(vec(state.ur5.tcp, 6), stationExtruder(station));
      const start = [-64, -88, -86, -14, -26, -83];
      arm.setQ(start.map(v => v * D2R));
      machine = { kind: 'arm', obj: arm, seeds: [start, [-64, -103, -40, 135, 26, 97]] };
    }
    machineRoot.add(arm.root);
    const sc = state.scene[m];
    const [bw, bd, bt, bx, by] = vec(sc.base, 5);         // robot base plate (view only): size + offset of its centre
    if (bt > 0 && bw > 0 && bd > 0) {
      const bp = new THREE.Mesh(new THREE.BoxGeometry(bw, bd, bt), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.55, metalness: 0.35 }));
      bp.position.set(bx, by, -bt / 2); bp.receiveShadow = true; bp.castShadow = true;
      machineRoot.add(bp);
      const boltMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.8, roughness: 0.3 });
      for (let i = 0; i < 12; i++) {                      // bolts along the edge of the plate
        const a = i / 12 * Math.PI * 2, bolt = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 10, 6), boltMat);
        const r = Math.min(bw, bd) / 2 - 45;
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(bx + Math.max(-bw / 2 + 45, Math.min(bw / 2 - 45, Math.cos(a) * r * 1.42)), by + Math.max(-bd / 2 + 45, Math.min(bd / 2 - 45, Math.sin(a) * r * 1.42)), 5);
        machineRoot.add(bolt);
      }
    }
    const fr = m === 'comau' ? vec(state.pdl.uframe, 6) : [...vec(state.ur5.plate, 3), 0, 0, 0];
    plate.matrix.copy(frameMatrix(fr));
    const [pw, pd, pt] = vec(sc.board, 3);                // print board under the plate origin (view only)
    const boardMat = new THREE.MeshStandardMaterial({ color: boardColor(m), roughness: 0.85 });
    if (pt > 0 && pw > 0 && pd > 0) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(pw, pd, pt), boardMat);
      board.position.z = -pt / 2 - 0.5; board.receiveShadow = true;
      plateVisual.add(board);
    }
    if (m === 'ur5') {
      const table = stationTable(station);
      table.position.z = -bt;                             // the robot (and its base plate) stand on the table
      table.rotation.z = -vec(sc.rot, 1)[0] * D2R;        // table turned around the robot base
      machineRoot.add(table);
      floorZ = station.meta.floor_z - bt;
    } else {
      floorZ = -bt;                                       // Comau: floor under its base plate
      const h = fr[2] - pt - floorZ;                      // legs of the print board down to the floor
      if (h > 5) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, h, 12), new THREE.MeshStandardMaterial({ color: 0x4a5058 }));
        leg.rotation.x = Math.PI / 2; leg.position.set(sx * (pw / 2 - 50), sy * (pd / 2 - 50), -pt - h / 2);
        plateVisual.add(leg);
      }
    }
  }
  ground.position.z = floorZ;
  plate.updateMatrixWorld(true);
  const axes = new THREE.AxesHelper(140);
  axes.material.depthTest = false;
  axes.renderOrder = 5;
  plateVisual.add(axes);
  machineRoot.traverse(o => { if (o.isMesh) o.castShadow = true; });
  $('btnFrame').classList.toggle('hidden', m === 'wasp');
  if (m === 'wasp' && tMode === 'frame') setTMode('translate');
  frameHandle.position.setFromMatrixPosition(plate.matrix);
  attachGizmo();
  applyMachineView();
  objects.forEach(updateSize);
  checkBounds();
  if (anim.keys) {                       // other machine = other speeds: same point of the print, new timeline
    const f = anim.total ? anim.t / anim.total : 0;
    buildTimeline();
    anim.t = f * anim.total;
  }
  if (mode === 'preview' && sliced) { if (anim.t > 0) animRender(); else setPreviewLayer(+$('layerSlider').value); }
  else poseMachine();
}

function applyMachineView() {
  const v = mode === 'preview' && sliced ? machineView : 'solid';
  machineRoot.visible = v !== 'hidden';
  machineRoot.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mt of mats) {
      if (mt.userData.op === undefined) mt.userData.op = [mt.transparent, mt.opacity, mt.depthWrite];
      const [t, op, dw] = mt.userData.op;
      mt.transparent = v === 'ghost' ? true : t;
      mt.opacity = v === 'ghost' ? 0.14 : op;
      mt.depthWrite = v === 'ghost' ? false : dw;
      mt.needsUpdate = true;
    }
    o.castShadow = v === 'solid';
  });
}

function poseMachine(pt) {
  if (!machine) return;
  // pt: nozzle point in plate coordinates (preview / playback) or hover above the plate (prepare)
  if (!pt) {
    let h = 0;
    for (const o of objects) h = Math.max(h, o.size[2]);
    pt = new THREE.Vector3(0, 0, h + (state.machine === 'wasp' ? 120 : 150));
  }
  let res;
  if (machine.kind === 'delta') res = machine.obj.place(pt);
  else {
    const T = plate.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(pt.x, pt.y, pt.z));
    const o = state.machine === 'comau' ? vec(state.pdl.orient, 3) : [0, 180, 0];
    T.multiply(zyz(o[0], o[1], o[2]));
    res = machine.obj.solve(T, machine.seeds);
  }
  setBadge('reach', res.ok ? null : (machine.kind === 'delta'
    ? 'Nozzle position outside the WASP build volume (Ø400 × 1000 mm)'
    : `Out of reach: the ${MACHINES[state.machine]} cannot put the nozzle here (off by ${res.posErr.toFixed(0)} mm). Move the plate or the part.`));
  return res;
}

// ------------------------------------------------------------------------------ helpers
function vec(v, n) {
  const a = Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/).filter(Boolean).map(Number);
  return [...Array(n)].map((_, i) => Number.isFinite(+a[i]) ? +a[i] : 0);
}
const fmtVec = v => v.map(x => +(+x).toFixed(4)).join(', ');
function log(lines, open = false) {
  const el = $('logText');
  const t = new Date().toLocaleTimeString();
  el.textContent += (el.textContent ? '\n' : '') + [].concat(lines).map(l => `[${t}] ${l}`).join('\n');
  el.scrollTop = el.scrollHeight;
  if (open) setLogView('log');
  else if (!$('logBox').classList.contains('open')) $('logBox').classList.add('unread');
}
const badges = {};
function setBadge(key, text, ok = false) {
  if (!text) { if (badges[key]) { badges[key].remove(); delete badges[key]; } return; }
  if (!badges[key]) { badges[key] = document.createElement('div'); $('badges').append(badges[key]); }
  badges[key].className = 'badge' + (ok ? ' ok' : '');
  badges[key].textContent = text;
}
async function api(path, body) { return window.lamaApi(path, body); }
const desktop = () => !!(window.pywebview && window.pywebview.api);
const fmtTime = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

// number fields must not change when the wheel scrolls the panel over them
document.addEventListener('wheel', e => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'number' && document.activeElement === t) t.blur();
}, { capture: true, passive: true });

// ------------------------------------------------------------------------------ settings UI
const P_FIELDS = ['nozzle', 'layer_height', 'first_layer_height'];
const PDL_NUM = ['print_speed_mm_s', 'travel_speed_mm_s', 'flow_rate_S', 'extrusion_factor', 'first_layer_z', 'approach_speed'];
const PDL_VEC = { tool: 6, home: 6, orient: 3 };
const PDL_TXT = ['placement', 'config'];

function defaultParams(m) {
  const d = CONFIG.toolpaths[state.toolpath] || CONFIG.toolpaths.N2;
  return {
    nozzle: d.INFILL_WIDTH, layer_height: d.LAYER_HEIGHT, first_layer_height: d.FIRST_LAYER_HEIGHT,
  };
}

const tpTitle = k => (CONFIG.toolpaths[k] && CONFIG.toolpaths[k].title) || k;

// ------------------------------------------------------------------------------ configuration modes
// standard = the plain slicer (Contour, Orthogonal, imported scripts); a project configuration (earthen) offers its own
// toolpaths, factory toolpath / machine and colours. Every project belongs to one configuration.
const cfgList = () => CONFIG.configs || [];
const cfgOf = id => cfgList().find(c => c.id === id) || cfgList().find(c => c.id === 'standard') ||
  { id: 'standard', title: 'LAMA Slicer', label: 'Standard', toolpaths: Object.keys(CONFIG.toolpaths), imported: true, defaults: {}, theme: {} };
const curCfg = () => cfgOf(state.config);
function cfgToolpaths(c = curCfg()) {
  const list = (c.toolpaths || []).filter(k => CONFIG.toolpaths[k]);
  if (c.imported) for (const [k, d] of Object.entries(CONFIG.toolpaths)) if (d.custom && !d.builtin && !list.includes(k)) list.push(k);
  return list.length ? list : Object.keys(CONFIG.toolpaths);
}
const cfgDefaultToolpath = (c = curCfg()) => { const l = cfgToolpaths(c); return l.includes((c.defaults || {}).toolpath) ? c.defaults.toolpath : l[0]; };
function inferConfig(st) {                   // projects before 1.6 have no configuration: the one that offers their toolpath
  if (st.config && cfgList().some(c => c.id === st.config)) return st.config;
  const c = cfgList().find(c => c.id !== 'standard' && (c.toolpaths || []).includes(st.toolpath));
  return c ? c.id : 'standard';
}
function defaultsFor(cid) {
  const c = cfgOf(cid), d = clone(defaults);
  d.config = c.id;
  d.toolpath = cfgDefaultToolpath(c);
  if (c.defaults && c.defaults.machine && MACHINES[c.defaults.machine]) d.machine = c.defaults.machine;
  return d;
}
const BASE_TYPE = Object.fromEntries(Object.entries(TYPE_STYLE).map(([k, v]) => [k, v.color]));
const hexInt = h => parseInt(String(h).replace('#', ''), 16);
function applyTheme(c = curCfg()) {          // colours of the configuration: interface (CSS), toolpath preview, print board
  const th = c.theme || {};
  document.body.dataset.config = c.id;
  for (const [k, v] of Object.entries(BASE_TYPE)) TYPE_STYLE[k].color = th.paths && th.paths[k] ? hexInt(th.paths[k]) : v;
  $('brandSub').textContent = th.subtitle || 'earth-based materials · TU Delft BK';
}
const boardColor = m => { const b = (curCfg().theme || {}).board; return b && b[m] ? hexInt(b[m]) : (m === 'ur5' ? 0xb8936a : 0xd9c4a0); };

function renderToolpaths() {
  const seg = $('toolpathSeg');
  seg.innerHTML = '';
  const list = cfgToolpaths();
  seg.dataset.key = list.join('|');
  for (const k of list) {
    const d = CONFIG.toolpaths[k];
    const b = document.createElement('button');
    b.dataset.t = k;
    b.textContent = d.title || k;
    b.title = d.custom ? `${d.title || k} (custom toolpath script)` : d.title || k;
    b.onclick = () => {
      if (sliced && sliced.kind === 'gcode') return;
      state.toolpath = k; renderSettings(); markStale(); saveSettings(); schedulePreview(0);
    };
    seg.append(b);
  }
}

function renderSettings() {
  document.querySelectorAll('#machineList button').forEach(b => b.classList.toggle('active', b.dataset.m === state.machine));
  const tpl = cfgToolpaths();
  if (!tpl.includes(state.toolpath) && !(sliced && sliced.kind === 'gcode')) state.toolpath = cfgDefaultToolpath();
  if ($('toolpathSeg').dataset.key !== tpl.join('|')) renderToolpaths();
  $('btnImportToolpath').classList.toggle('hidden', !curCfg().imported);
  $('btnCode').classList.toggle('hidden', !curCfg().code);
  document.querySelectorAll('#toolpathSeg button').forEach(b => b.classList.toggle('active', b.dataset.t === state.toolpath));
  const imp = sliced && sliced.kind === 'gcode';
  $('toolpathSeg').classList.toggle('off', !!imp);
  $('importedBox').classList.toggle('hidden', !imp);
  if (imp) $('importedName').textContent = sliced.name;
  const d = CONFIG.toolpaths[state.toolpath];
  $('toolpathHint').textContent = imp
    ? 'The imported G-code is used as it is (coordinates = plate coordinates, mm). Slicing is not needed; Export writes it for the selected machine.'
    : d.custom ? (d.description.toLowerCase().startsWith((d.title || state.toolpath).toLowerCase()) ? d.description : `${d.title || state.toolpath}: ${d.description}`)
        + (d.builtin ? '' : ' (imported toolpath script)')
      : `${d.title || state.toolpath}: ${d.description}`;
  $('btnRemoveToolpath').classList.toggle('hidden', !(d.custom && !d.builtin) || !!imp);
  $('paramsFor').textContent = MACHINES[state.machine];
  const p = state.params[state.machine];
  P_FIELDS.forEach(k => { $('p_' + k).value = p[k]; });
  document.querySelectorAll('[data-noz]').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.noz - p.nozzle) < 1e-9));
  const k = p.nozzle / d.INFILL_WIDTH, aw = key => { const a = advSpec().find(x => x.key === key); return a ? +advGet(a) : d[key] * k; };
  $('widthHint').classList.toggle('hidden', !!d.custom);
  $('widthHint').textContent = d.custom ? '' : `Bead widths: outer wall ${aw('EXTERNAL_PERIMETER_WIDTH').toFixed(1)}, inner wall ${(d.PERIMETER_WIDTH * k).toFixed(1)}, weave ${(d.INFILL_WIDTH * k).toFixed(1)}, first layer ${aw('FIRST_LAYER_WIDTH').toFixed(1)} mm.`;
  renderGeneral();
  document.querySelectorAll('.gsfor').forEach(t => { t.textContent = MACHINES[state.machine]; });
  $('out_results').checked = state.out_results !== false;
  $('out_preview').checked = !!state.out_preview;
  $('out_preview').disabled = !advSpec().length || !!imp;

  ['Comau', 'Ur5', 'Wasp'].forEach(n => $('panel' + n).classList.toggle('hidden', n.toLowerCase() !== state.machine));
  PDL_NUM.forEach(k => { $('pdl_' + k).value = state.pdl[k] ?? ''; });
  PDL_TXT.forEach(k => { $('pdl_' + k).value = state.pdl[k] ?? ''; });
  Object.keys(PDL_VEC).forEach(k => { $('pdl_' + k).value = fmtVec(vec(state.pdl[k], PDL_VEC[k])); });
  const c = CONFIG.pdl;
  $('pdlFixed').textContent = `Fixed (settings.json): ${c.com_port} · gear ratio ${c.gear_ratio} · $FLY_DIST ${c.fly_dist} · $STRESS_PER ${c.stress_per}`;
  renderFrame();
  renderAdvanced();
  document.querySelectorAll('[data-scene]').forEach(i => { const [mm, k] = i.dataset.scene.split('.'); i.value = fmtVec(vec(state.scene[mm][k], +i.dataset.n)); });
  $('ur5_tcp').value = fmtVec(vec(state.ur5.tcp, 6));
  $('out_name').value = state.out_name;
  pdlStatus();
}

// ------------------------------------------------------------------------------ print frame ($UFRAME / UR5 plate origin)
// shown as X, Y and the height above the floor (Comau) / table (UR5): the robot base stands on its base plate,
// so the frame z in the robot base frame = height - base plate thickness
function frameVec() { return state.machine === 'comau' ? vec(state.pdl.uframe, 6) : [...vec(state.ur5.plate, 3), 0, 0, 0]; }
function setFrameVec(v) {
  if (state.machine === 'comau') state.pdl.uframe = v.map(x => +(+x).toFixed(3));
  else state.ur5.plate = v.slice(0, 3).map(x => +(+x).toFixed(3));
}
const baseThickness = () => (state.scene[state.machine] ? vec(state.scene[state.machine].base, 5)[2] : 0);
function renderFrame() {
  const box = document.querySelector(`.frame[data-frame="${state.machine}"]`);
  if (!box) return;
  const v = frameVec(), t = baseThickness();
  const set = (f, val) => { const i = box.querySelector(`[data-f="${f}"]`); if (i && document.activeElement !== i) i.value = val; };
  set('x', +v[0].toFixed(1)); set('y', +v[1].toFixed(1)); set('h', +(v[2] + t).toFixed(1)); set('rot', fmtVec(v.slice(3)));
  box.querySelector('.fhint').textContent = state.machine === 'comau'
    ? `$UFRAME := POS(${fmtVec(v.slice(0, 3))}, ${fmtVec(v.slice(3))})  ·  z = height − ${t} mm robot base plate`
    : `plate origin in the robot base frame: ${fmtVec(v.slice(0, 3))}  ·  z = height − ${t} mm base plate`;
  box.querySelector('.fmove').classList.toggle('on', tMode === 'frame');
}
function applyFrame() {                      // frame moved in x / y: no rebuild needed
  plate.matrix.copy(frameMatrix(frameVec()));
  plate.updateMatrixWorld(true);
  frameHandle.position.setFromMatrixPosition(plate.matrix);
  objects.forEach(updateSize);
  renderFrame();
  if (mode === 'prepare') poseMachine();
}
function bindFrame() {
  document.querySelectorAll('.frame').forEach(box => {
    box.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => {
      const v = frameVec(), f = inp.dataset.f;
      if (f === 'rot') {
        const r = inp.value.split(/[,;\s]+/).filter(Boolean).map(Number);
        if (r.length !== 3 || r.some(x => !Number.isFinite(x))) { inp.classList.add('bad'); return; }
        inp.classList.remove('bad'); v[3] = r[0]; v[4] = r[1]; v[5] = r[2];
      } else {
        const x = parseFloat(inp.value);
        if (!Number.isFinite(x)) { renderFrame(); return; }
        if (f === 'x') v[0] = x; else if (f === 'y') v[1] = x; else v[2] = x - baseThickness();
      }
      setFrameVec(v);
      renderFrame();
      if (f === 'x' || f === 'y') applyFrame(); else buildMachine();
      saveSettings(); markStale();
    }));
    box.querySelector('.fmove').onclick = () => {
      if (mode !== 'prepare') { setMode('prepare'); setTMode('frame'); fitView('iso'); return; }
      setTMode(tMode === 'frame' ? 'translate' : 'frame');
      if (tMode === 'frame') fitView('iso');
    };
  });
}

function pdlStatus() {
  const S = Math.round(+state.pdl.flow_rate_S * +state.pdl.extrusion_factor);
  const n = safeName(state.out_name || defaultName()), rb = { wasp: 'Wasp', ur5: 'UR5', comau: 'Comau' }[state.machine];
  $('pdlStatus').textContent = `S written: S${S} · program: ${pdlName()}.pdl`;
  outputHints();
}
function exportList() {                    // the files of an export (in the folder named after the file name)
  const n = safeName(state.out_name || defaultName()), rb = { wasp: 'Wasp', ur5: 'UR5', comau: 'Comau' }[state.machine];
  const imp = sliced && sliced.kind === 'gcode', f = [`${n}${rb}.gcode`];
  if (state.machine === 'comau') f.push(`${pdlName()}.pdl`);
  if (state.out_results !== false && !imp) f.push(`${n}${rb}_results.txt`);
  if (state.out_preview && advSpec().length && !imp) f.push(`${n}${rb}_preview_L${advLayer}.png`);
  return { folder: n, files: f };
}
function outputHints() {
  const e = exportList();
  $('outFiles').textContent = `→ folder ${e.folder}: ${e.files.join(', ')}`;
}
function pdlName() {                       // [file name][robot]: letters / digits only (PDL program name)
  const base = (safeName(state.out_name || defaultName()) + 'Comau').replace(/[^A-Za-z0-9]/g, '');
  return /^[A-Za-z]/.test(base) ? base : 'P' + base;
}
const safeName = s => (s || '').replace(/ /g, '_').replace(/[^A-Za-z0-9_\-]/g, '') || 'part';
const defaultName = () => (sliced && sliced.kind === 'gcode') ? sliced.name.replace(/\.[^.]+$/, '') : (objects[0] ? objects[0].name.replace(/\.[^.]+$/, '') : 'part');

let saveTimer = null;
function postSettings() {        // last used settings (= defaults of a new project) + the open project tabs
  const session = { open: projects.filter(p => p.saved).map(p => p.id), active: current && current.saved ? current.id : null };
  return api('/api/settings', { ...state, session }).catch(() => {});
}
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(postSettings, 500);
  commit();
}

// ------------------------------------------------------------------------------ undo / redo (Ctrl+Z, Ctrl+Y / Ctrl+X)
const hist = { past: [], future: [], last: null, restoring: false };
function snapshot() {
  return JSON.stringify({
    state, solo, sel: selected ? selected.id : null,
    objs: objects.map(o => ({ id: o.id, unit: o.unit, rot: o.rot, scale: o.scale, x: o.group.position.x, y: o.group.position.y, visible: o.visible })),
  });
}
function commit() {
  if (hist.restoring || !CONFIG) return;
  const s = snapshot();
  if (s === hist.last) return;
  if (hist.last) hist.past.push(hist.last);
  if (hist.past.length > 200) hist.past.shift();
  hist.future = [];
  hist.last = s;
  updateUndoButtons();
  scheduleProjectSave();
}
function undo() { if (!hist.past.length) return; hist.future.push(hist.last); hist.last = hist.past.pop(); restore(hist.last); }
function redo() { if (!hist.future.length) return; hist.past.push(hist.last); hist.last = hist.future.pop(); restore(hist.last); }
function updateUndoButtons() { $('btnUndo').disabled = !hist.past.length; $('btnRedo').disabled = !hist.future.length; }
const machineKey = () => JSON.stringify([state.machine, state.pdl.uframe, state.pdl.tool, state.pdl.home, state.ur5, state.scene]);
function restore(snap) {
  hist.restoring = true;
  const d = JSON.parse(snap);
  const mk = machineKey();
  for (const k of Object.keys(d.state)) state[k] = d.state[k];
  solo = d.solo;
  tcontrols.detach();
  objects.forEach(o => objectsRoot.remove(o.group));
  objects.length = 0;
  for (const s of d.objs) {
    const o = registry.get(s.id);
    if (!o) continue;
    Object.assign(o, { unit: s.unit, rot: s.rot, scale: s.scale || [1, 1, 1], visible: s.visible });
    o.group.position.set(s.x, s.y, 0);
    objectsRoot.add(o.group);
    objects.push(o);
    applyRotation(o);
  }
  selected = null;
  select(objects.find(o => o.id === d.sel) || null);
  renderSettings();
  if (mk !== machineKey()) buildMachine();
  placementChanged();
  applyObjectVisibility();
  if (sliced) updateLegend();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(postSettings, 500);
  scheduleProjectSave();
  hist.restoring = false;
  updateUndoButtons();
}

function parseVecInput(e, n) {
  const parts = e.target.value.split(/[,;\s]+/).filter(Boolean).map(Number);
  if (parts.length !== n || parts.some(x => !Number.isFinite(x))) { e.target.classList.add('bad'); return null; }
  e.target.classList.remove('bad');
  e.target.value = fmtVec(parts);
  return parts;
}

// sidebar sections that fold (click the heading): Material, Printer and the machine panel; the open / closed
// state is kept per viewer in the browser storage
function bindFolds() {
  let st = {};
  try { st = JSON.parse(localStorage.getItem('lama.folds') || '{}'); } catch (e) { st = {}; }
  document.querySelectorAll('.side section.fold').forEach(sec => {
    const k = sec.dataset.fold;
    if (k in st) sec.classList.toggle('closed', !!st[k]);
    sec.querySelector('h3').addEventListener('click', e => {
      if (e.target.closest('button, input, select, a')) return;
      sec.classList.toggle('closed');
      st[k] = sec.classList.contains('closed');
      try { localStorage.setItem('lama.folds', JSON.stringify(st)); } catch (err) { /* storage off: fold for this session only */ }
    });
  });
}
function bindSettings() {
  bindFolds();
  document.querySelectorAll('#machineList button').forEach(b => b.onclick = () => {
    if (state.machine === b.dataset.m) return;
    state.machine = b.dataset.m;
    animStop();
    renderSettings(); buildMachine().then(() => fitView('machine')); markStale(); saveSettings();
    if (sliced) updateLegend();
    scheduleResults(0);                            // the results belong to the machine
    renderTabs();                                  // the tab shows the machine
  });
  document.querySelectorAll('[data-scene]').forEach(i => i.addEventListener('change', e => {
    const v = parseVecInput(e, +i.dataset.n);
    if (!v || v.slice(0, 3).some(x => x < 0 && i.dataset.n !== '1')) { e.target.classList.add('bad'); return; }
    const [mm, k] = i.dataset.scene.split('.');
    state.scene[mm][k] = v; buildMachine(); renderFrame(); saveSettings();
  }));
  $('btnImportToolpath').onclick = () => $('toolpathInput').click();
  $('toolpathInput').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = await api('/api/toolpath_import', { filename: f.name, code: await f.text() });
    if (!r.ok) { log(`Toolpath not imported: ${r.error}`, true); return; }
    CONFIG.toolpaths = r.toolpaths;
    state.toolpath = r.name;
    renderToolpaths(); renderSettings(); markStale(); saveSettings();
    log(`Imported toolpath ${f.name} as "${r.name}"`);
  };
  $('btnRemoveToolpath').onclick = async () => {
    const name = state.toolpath;
    if (!window.confirm(`Remove the imported toolpath "${name}"?`)) return;
    const r = await api('/api/toolpath_delete', { name });
    if (!r.ok) { log(r.error, true); return; }
    CONFIG.toolpaths = r.toolpaths;
    state.toolpath = cfgDefaultToolpath();
    renderToolpaths(); renderSettings(); markStale(); saveSettings();
    log(`Removed toolpath ${name}`);
  };
  P_FIELDS.forEach(k => $('p_' + k).addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (!(v > 0)) { e.target.value = state.params[state.machine][k]; return; }
    state.params[state.machine][k] = v;
    renderSettings();
    if (['nozzle', 'layer_height', 'first_layer_height'].includes(k)) { markStale(); schedulePreview(); }
    if (sliced) { updateLegend(); anim.keys = null; }
    saveSettings();
  }));
  document.querySelectorAll('[data-noz]').forEach(b => b.onclick = () => {   // nozzle + layer heights in proportion
    const d = CONFIG.toolpaths.N2 || {}, n = +b.dataset.noz, r1 = x => Math.max(0.1, Math.round(x * 10) / 10);
    const ref = +d.INFILL_WIDTH || 6, p = state.params[state.machine];
    p.nozzle = n;
    p.layer_height = r1(n * (+d.LAYER_HEIGHT || 3.5) / ref);
    p.first_layer_height = r1(n * (+d.FIRST_LAYER_HEIGHT || 2) / ref);
    renderSettings(); markStale(); schedulePreview();
    if (sliced) { updateLegend(); anim.keys = null; }
    saveSettings();
  });
  PDL_NUM.forEach(k => $('pdl_' + k).addEventListener('change', e => {
    const s = e.target.value.trim();
    if (s === '' && k.endsWith('_mm_s')) state.pdl[k] = '';
    else if (Number.isFinite(parseFloat(s))) state.pdl[k] = parseFloat(s);
    else e.target.value = state.pdl[k];
    pdlStatus(); saveSettings();
  }));
  PDL_TXT.forEach(k => $('pdl_' + k).addEventListener('change', e => { state.pdl[k] = e.target.value.trim(); pdlStatus(); saveSettings(); }));
  Object.entries(PDL_VEC).forEach(([k, n]) => $('pdl_' + k).addEventListener('change', e => {
    const v = parseVecInput(e, n);
    if (!v) return;
    state.pdl[k] = v;
    if (k !== 'home') buildMachine();
    saveSettings();
  }));
  [['ur5_tcp', 'tcp', 6]].forEach(([id, k, n]) => $(id).addEventListener('change', e => {
    const v = parseVecInput(e, n);
    if (!v) return;
    state.ur5[k] = v; buildMachine(); saveSettings();
  }));
  $('out_name').addEventListener('change', e => { state.out_name = e.target.value.trim(); pdlStatus(); saveSettings(); });
  $('out_results').addEventListener('change', e => { state.out_results = e.target.checked; outputHints(); saveSettings(); });
  $('out_preview').addEventListener('change', e => { state.out_preview = e.target.checked; outputHints(); saveSettings(); });
  $('btnOpenFolder').onclick = async () => { const r = await api('/api/open_folder', { path: state.out_dir || CONFIG.out_dir }); if (!r.ok) log(r.error, true); };
  bindFrame();
}

// ------------------------------------------------------------------------------ objects
const clayMat = () => new THREE.MeshStandardMaterial({ color: 0xbfae9c, roughness: 0.85, metalness: 0.0 });

async function loadFiles(files) {
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    try {
      let geom;
      if (ext === 'stl') geom = new STLLoader().parse(await f.arrayBuffer());
      else if (ext === 'obj') {
        geom = groupToGeometry(new OBJLoader().parse(await f.text()));
        geom.rotateX(Math.PI / 2);   // OBJ is Y-up (Rhino "Map Rhino Z to OBJ Y") -> plate Z-up: (x, y, z) -> (x, -z, y)
      }
      else if (ext === '3mf') geom = groupToGeometry(new ThreeMFLoader().parse(await f.arrayBuffer()));
      else if (/^(gcode|gco|nc)$/.test(ext)) { importGcode(f); continue; }
      else { log(`${f.name}: only STL, OBJ and 3MF can be added`, true); continue; }
      addObject(f.name, geom);
    } catch (e) {
      log(`${f.name}: could not be read (${e.message})`, true);
    }
  }
}

function groupToGeometry(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', g.getAttribute('position').clone());
    ng.applyMatrix4(o.matrixWorld);
    parts.push(ng);
  });
  if (!parts.length) throw new Error('no mesh found');
  return parts.length === 1 ? parts[0] : mergeGeometries(parts);
}

function addObject(name, geom) {
  const o = makeObject(name, geom);
  const b = o.mesh.geometry.boundingBox;
  objectsRoot.add(o.group);
  registry.set(o.id, o);
  if (objects.length) {                 // several objects: next to each other
    const last = objects[objects.length - 1];
    o.group.position.x = last.group.position.x + last.size[0] / 2 + 40 + (b.max.x - b.min.x) / 2;
  }
  objects.push(o);
  applyRotation(o);
  if (current && (/^Project \d+$/.test(current.name) || cfgList().some(c => new RegExp(`^${c.label} \\d+$`).test(current.name)))) { current.name = name.replace(/\.[^.]+$/, ''); renderTabs(); }
  select(o);
  placementChanged();
  if (objects.length === 1) fitView('plate');
  log(`Added ${name}: ${o.size.map(v => v.toFixed(1)).join(' × ')} mm`);
}

// ------------------------------------------------------------------------------ copy / paste / multiply
let clipboard = null;            // {name, geom, unit, rot, scale, visible, stl64, x, y} of the copied object
const footprint = o => [o.group.position.x, o.group.position.y, o.size[0], o.size[1]];
function copyName(name) {        // box.stl -> box (2).stl, box (3).stl ...
  const m = name.match(/^(.*?)(?: \((\d+)\))?(\.[^.]+)?$/), base = m[1], ext = m[3] || '';
  let n = 2;
  while (objects.some(o => o.name === `${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}
function cloneInto(src, x, y) {   // a new object with the same shape, units, rotation and scale
  const o = makeObject(copyName(src.name), src.geom.clone());
  Object.assign(o, { unit: src.unit, rot: [...src.rot], scale: [...src.scale], visible: src.visible !== false, stl64: src.stl64 });
  o.group.position.set(x, y, 0);
  o.group.scale.setScalar(o.unit);
  objectsRoot.add(o.group);
  registry.set(o.id, o);
  objects.push(o);
  applyRotation(o);
  return o;
}
function freeSpot(w, d, x, y) {   // first place right of (x, y) where a w x d footprint touches nothing
  const gap = 20, hit = (cx, cy) => objects.some(o => {
    const [ox, oy, ow, od] = footprint(o);
    return Math.abs(cx - ox) < (w + ow) / 2 + gap - 1e-6 && Math.abs(cy - oy) < (d + od) / 2 + gap - 1e-6;
  });
  for (let i = 1; i < 200; i++) {
    const cx = x + i * (w + gap);
    if (!hit(cx, y)) return [cx, y];
  }
  return [x, y];
}
function asClip(o) {
  return { name: o.name, geom: o.mesh.geometry, unit: o.unit, rot: [...o.rot], scale: [...o.scale], visible: o.visible, stl64: o.stl64,
    w: o.size[0], d: o.size[1], x: o.group.position.x, y: o.group.position.y };
}
function copySelected() {
  if (!selected || tMode === 'frame') return;
  clipboard = asClip(selected);
  clipboard.geom = selected.mesh.geometry.clone();      // stays valid if the original is deleted
  log(`Copied ${selected.name} (Ctrl+V pastes it)`);
}
function pasteClipboard() {
  if (!clipboard || mode !== 'prepare') return;
  const [x, y] = freeSpot(clipboard.w, clipboard.d, clipboard.x, clipboard.y);
  const o = cloneInto(clipboard, x, y);
  select(o); placementChanged();
  log(`Pasted ${o.name}`);
}
function duplicateSelected() {
  if (!selected || tMode === 'frame') return;
  const c = asClip(selected);
  const [x, y] = freeSpot(c.w, c.d, c.x, c.y);
  const o = cloneInto(c, x, y);
  select(o); placementChanged();
  log(`Duplicated ${c.name} -> ${o.name}`);
}
// Multiply: the selected object + copies in a grid (columns x rows), centred where the object was
function gridLayout(n, cols, w, d, gap) {
  const rows = Math.ceil(n / cols), out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push([(c - (cols - 1) / 2) * (w + gap), ((rows - 1) / 2 - r) * (d + gap)]);
  }
  return out;
}
function multiplyInfo() {
  const n = Math.max(1, Math.round(+$('mulCount').value || 1)) + 1, gap = Math.max(0, +$('mulGap').value || 0);
  const cols = Math.max(1, Math.min(n, Math.round(+$('mulCols').value || Math.ceil(Math.sqrt(n)))));
  const [w, d] = selected.size, rows = Math.ceil(n / cols);
  return { n, gap, cols, rows, W: cols * w + (cols - 1) * gap, D: rows * d + (rows - 1) * gap };
}
function openMultiply() {
  if (!selected || mode !== 'prepare') return;
  if (tMode === 'frame') setTMode('translate');
  $('mulName').textContent = selected.name;
  if (!$('mulCols').dataset.touched) $('mulCols').value = Math.ceil(Math.sqrt((+$('mulCount').value || 1) + 1));
  const upd = () => {
    const m = multiplyInfo();
    $('mulInfo').textContent = `${m.n} objects in ${m.cols} × ${m.rows}: ${m.W.toFixed(0)} × ${m.D.toFixed(0)} mm, centred where ${selected.name} is now.`;
  };
  $('mulCount').oninput = () => { if (!$('mulCols').dataset.touched) $('mulCols').value = Math.ceil(Math.sqrt((+$('mulCount').value || 1) + 1)); upd(); };
  $('mulCols').oninput = () => { $('mulCols').dataset.touched = '1'; upd(); };
  $('mulGap').oninput = upd;
  upd();
  $('mulDlg').classList.remove('hidden');
  $('mulCount').focus(); $('mulCount').select();
}
function doMultiply() {
  $('mulDlg').classList.add('hidden');
  if (!selected) return;
  const m = multiplyInfo(), src = selected, c = asClip(src);
  const cx = c.x, cy = c.y;
  const pos = gridLayout(m.n, m.cols, c.w, c.d, m.gap);
  src.group.position.set(cx + pos[0][0], cy + pos[0][1], 0);
  for (let i = 1; i < pos.length; i++) cloneInto(c, cx + pos[i][0], cy + pos[i][1]);
  select(src); placementChanged();
  log(`Multiplied ${src.name}: ${m.n} objects (${m.cols} × ${m.rows}, gap ${m.gap} mm)`);
}

function makeObject(name, geom) {
  geom.computeBoundingBox();
  const b = geom.boundingBox;
  geom.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);   // origin = centre of the lower face
  geom.deleteAttribute('normal');
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const mesh = new THREE.Mesh(geom, clayMat());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();      // position on the plate (x, y), scale = model units
  const pivot = new THREE.Group();      // rotation, moved so the rotated part stands on its lower-face centre
  const proxy = new THREE.Object3D();   // handle for the rotate gizmo (at the origin)
  pivot.add(mesh);
  group.add(pivot, proxy);
  void b;
  return { id: ++objId, name, group, pivot, proxy, mesh, unit: 1, rot: [0, 0, 0], scale: [1, 1, 1], size: [0, 0, 0], visible: true };
}

// scale (object axes, first) then rotation X, Y, Z (deg, applied X then Y then Z about the plate axes);
// the part is put back on the plate with its lower-face centre on its position
function applyRotation(o, syncProxy = true) {
  const r = o.rot.map(v => v * D2R);
  if (!o.scale) o.scale = [1, 1, 1];
  o.mesh.scale.set(...o.scale);
  o.mesh.updateMatrix();
  o.pivot.position.set(0, 0, 0);
  o.pivot.rotation.set(r[0], r[1], r[2], 'ZYX');
  if (syncProxy) { o.proxy.quaternion.copy(o.pivot.quaternion); o.proxy.scale.set(...o.scale); }
  o.pivot.updateMatrix();
  const R = o.pivot.matrix.clone().multiply(o.mesh.matrix), p = o.mesh.geometry.attributes.position, v = new THREE.Vector3();
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(R);
    if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
    if (v.z < z0) z0 = v.z;
  }
  o.pivot.position.set(-(x0 + x1) / 2, -(y0 + y1) / 2, -z0);
  updateSize(o);
}

function baseSize(o) {                       // object size at 100 % (model units applied), object axes
  const b = o.mesh.geometry.boundingBox;
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => v * o.unit);
}

function updateSize(o) {
  plate.updateMatrixWorld(true);
  o.group.scale.setScalar(o.unit);
  o.group.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(o.mesh, true);
  bb.applyMatrix4(new THREE.Matrix4().copy(plate.matrixWorld).invert());
  o.size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
}

function renderObjectList() {
  const el = $('objectList');
  $('out_name').placeholder = defaultName();
  pdlStatus();
  if (!objects.length) { el.innerHTML = '<p class="empty">Drop STL / OBJ / 3MF files here or use <b>Add</b>.</p>'; $('objectProps').classList.add('hidden'); return; }
  el.innerHTML = '';
  for (const o of objects) {
    const d = document.createElement('div');
    d.className = 'obj' + (o === selected ? ' active' : '') + (isShown(o) ? '' : ' off');
    d.innerHTML = `<input type="checkbox" title="show / hide in the view and the preview" ${o.visible ? 'checked' : ''} ${solo ? 'disabled' : ''}><span class="nm"></span><span>${o.size.map(v => v.toFixed(0)).join(' × ')} mm</span>`;
    d.querySelector('.nm').textContent = o.name;
    const cb = d.querySelector('input');
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => { o.visible = cb.checked; applyObjectVisibility(); commit(); };
    d.onclick = () => select(o);
    el.append(d);
  }
  $('soloRow').classList.toggle('hidden', objects.length < 2);
  $('soloBox').checked = solo;
  $('objectProps').classList.toggle('hidden', !selected);
}

const isShown = o => solo ? o === selected : o.visible;
function applyObjectVisibility() {
  objects.forEach(o => { o.group.visible = isShown(o); });
  renderObjectList();
  if (sliced && sliced.kind === 'slice' && previewMesh) {
    const n = +$('layerSlider').value;
    buildPreview();
    $('layerSlider').value = n; setPreviewLayer(n);
  }
}

function select(o) {
  if (o && tMode === 'frame') { tMode = 'translate'; setTMode('translate'); }
  const prev = selected;
  selected = o;
  if (solo && prev !== o) { objects.forEach(x => { x.group.visible = isShown(x); }); if (sliced && sliced.kind === 'slice' && previewMesh) applyObjectVisibility(); }
  objects.forEach(x => x.mesh.material.emissive.setHex(x === o ? 0x062a3a : 0x000000));
  attachGizmo();
  renderObjectList();
  showObjectProps();
}
function attachGizmo() {
  if (mode === 'prepare' && tMode === 'frame' && state.machine !== 'wasp') tcontrols.attach(frameHandle);
  else if (selected && mode === 'prepare') tcontrols.attach(tMode === 'rotate' || tMode === 'scale' ? selected.proxy : selected.group);
  else tcontrols.detach();
}

function showObjectProps() {
  if (!selected) return;
  const g = selected.group;
  $('o_x').value = g.position.x.toFixed(1);
  $('o_y').value = g.position.y.toFixed(1);
  $('o_unit').value = String(selected.unit);
  document.querySelectorAll('.rot').forEach(r => {
    const ax = +r.dataset.ax;
    const inp = r.querySelector('input');
    if (document.activeElement !== inp) inp.value = +selected.rot[ax].toFixed(2);
    r.classList.toggle('active', ax === rotAxis);
  });
  updateSize(selected);
  $('o_size').textContent = selected.size.map(v => v.toFixed(1)).join(' × ') + ' mm';
  const bs = baseSize(selected);
  document.querySelectorAll('[data-sc]').forEach(i => { if (document.activeElement !== i) i.value = +(selected.scale[+i.dataset.sc] * 100).toFixed(2); });
  document.querySelectorAll('[data-sz]').forEach(i => { if (document.activeElement !== i) i.value = +(bs[+i.dataset.sz] * selected.scale[+i.dataset.sz]).toFixed(1); });
  document.querySelectorAll('[data-scp]').forEach(b => b.classList.toggle('on', selected.scale.every(v => Math.abs(v * 100 - +b.dataset.scp) < 1e-6)));
  renderPresets();
}

function renderPresets() {
  const el = $('rotPresets');
  const cur = selected ? selected.rot[rotAxis] : null;
  el.innerHTML = `<span class="lbl">${'XYZ'[rotAxis]} =</span>` + ROT_PRESETS.map(a => `<button data-a="${a}" class="${cur !== null && Math.abs(((cur % 360) + 360) % 360 - a) < 1e-6 ? 'on' : ''}">${a}°</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => setRot(rotAxis, +b.dataset.a));
}

function setRot(ax, deg) {
  if (!selected) return;
  rotAxis = ax;
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;                     // keep -180 … 180
  selected.rot[ax] = Math.round(d * 100) / 100;
  applyRotation(selected);
  showObjectProps();
  placementChanged();
}

function placementChanged() {
  objects.forEach(updateSize);
  renderObjectList();
  checkBounds();
  markStale();
  if (mode === 'prepare') poseMachine();
  commit();
}

function plateMatrixOf(o) {                  // mesh -> plate coordinates
  plate.updateMatrixWorld(true);
  o.mesh.updateWorldMatrix(true, false);
  return new THREE.Matrix4().copy(plate.matrixWorld).invert().multiply(o.mesh.matrixWorld);
}

function checkBounds() {
  let msg = null;
  if (state.machine === 'wasp') {
    for (const o of objects) {
      const p = o.mesh.geometry.attributes.position, v = new THREE.Vector3(), M = plateMatrixOf(o);
      let r = 0;
      const step = Math.max(1, Math.floor(p.count / 4000));
      for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(M); r = Math.max(r, Math.hypot(v.x, v.y)); }
      if (r > 200) msg = `${o.name} reaches ${r.toFixed(0)} mm from the bed centre (bed radius 200 mm)`;
      if (o.size[2] > 1000) msg = `${o.name} is taller than the 1000 mm build height`;
    }
  }
  setBadge('bed', msg);
}

function bindObjects() {
  $('btnAdd').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { loadFiles([...e.target.files]); e.target.value = ''; };
  $('btnMove').onclick = () => setTMode('translate');
  $('btnRotate').onclick = () => setTMode('rotate');
  $('btnScale').onclick = () => setTMode('scale');
  // scale: % per object axis (lock = uniform), size in mm, presets
  const setScale = (sc) => {
    if (!selected) return;
    selected.scale = sc.map(v => Math.round(Math.min(100, Math.max(0.01, v)) * 10000) / 10000);
    applyRotation(selected); showObjectProps(); placementChanged();
  };
  document.querySelectorAll('[data-sc]').forEach(inp => inp.addEventListener('change', () => {
    if (!selected) return;
    const k = +inp.dataset.sc, v = parseFloat(inp.value) / 100;
    if (!(v > 0)) { showObjectProps(); return; }
    setScale($('scaleLock').checked ? [v, v, v] : selected.scale.map((x, i) => i === k ? v : x));
  }));
  document.querySelectorAll('[data-sz]').forEach(inp => inp.addEventListener('change', () => {
    if (!selected) return;
    const k = +inp.dataset.sz, want = parseFloat(inp.value), base = baseSize(selected)[k];
    if (!(want > 0) || !(base > 0)) { showObjectProps(); return; }
    const v = want / base;
    setScale($('scaleLock').checked ? [v, v, v] : selected.scale.map((x, i) => i === k ? v : x));
  }));
  document.querySelectorAll('[data-scp]').forEach(b => b.onclick = () => {
    if (!selected) return;
    const v = +b.dataset.scp / 100;
    setScale([v, v, v]);
  });
  $('scaleLock').addEventListener('change', () => {
    if ($('scaleLock').checked && selected) setScale([selected.scale[0], selected.scale[0], selected.scale[0]]);
  });
  $('btnFrame').onclick = () => setTMode(tMode === 'frame' ? 'translate' : 'frame');
  $('btnCenter').onclick = () => { if (!selected) return; if (tMode === 'frame') setTMode('translate'); selected.group.position.set(0, 0, 0); showObjectProps(); placementChanged(); };
  $('btnDelete').onclick = deleteSelected;
  $('btnDuplicate').onclick = duplicateSelected;
  $('btnMultiply').onclick = openMultiply;
  $('btnMultiply2').onclick = openMultiply;
  $('mulCancel').onclick = () => $('mulDlg').classList.add('hidden');
  $('mulOk').onclick = doMultiply;
  $('mulDlg').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doMultiply(); }
    if (e.key === 'Escape') $('mulDlg').classList.add('hidden');
  });
  [['o_x', v => selected.group.position.x = v], ['o_y', v => selected.group.position.y = v]].forEach(([id, f]) =>
    $(id).addEventListener('change', e => { if (!selected) return; const v = parseFloat(e.target.value); if (Number.isFinite(v)) f(v); showObjectProps(); placementChanged(); }));
  $('o_unit').addEventListener('change', e => { if (!selected) return; selected.unit = +e.target.value; showObjectProps(); placementChanged(); });
  // rotation rows: field, - / + by the step, presets for the active axis
  const step = () => +$('rotStep').value;
  document.querySelectorAll('.rot').forEach(r => {
    const ax = +r.dataset.ax, inp = r.querySelector('input');
    inp.addEventListener('focus', () => { rotAxis = ax; showObjectProps(); });
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) setRot(ax, v); });
    r.querySelectorAll('button').forEach(b => b.onclick = () => {
      if (!selected) return;
      const s = step(), cur = selected.rot[ax];
      const next = +b.dataset.d > 0 ? Math.floor(cur / s + 1e-6) * s + s : Math.ceil(cur / s - 1e-6) * s - s;   // to the next multiple of the step
      setRot(ax, next);
    });
    r.querySelector('.ax').onclick = () => { rotAxis = ax; showObjectProps(); };
  });
  $('rotStep').addEventListener('change', () => {
    document.querySelectorAll('.rot input').forEach(i => { i.step = $('rotStep').value; });
    tcontrols.setRotationSnap(step() * D2R);
  });
  $('btnRotReset').onclick = () => { if (!selected) return; selected.rot = [0, 0, 0]; applyRotation(selected); showObjectProps(); placementChanged(); };

  vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drop'); });
  vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
  vp.addEventListener('drop', e => { e.preventDefault(); vp.classList.remove('drop'); loadFiles([...e.dataTransfer.files]); });
  $('side').addEventListener('dragover', e => e.preventDefault());
  $('side').addEventListener('drop', e => { e.preventDefault(); loadFiles([...e.dataTransfer.files]); });

  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = e.button === 0 ? [e.clientX, e.clientY] : null; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || mode !== 'prepare' || tcontrols.dragging) return;
    const r = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObjects(objects.map(o => o.mesh))[0];
    select(hit ? objects.find(o => o.mesh === hit.object) : null);
  });
  window.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); return; }
      if (k === 'c' && mode === 'prepare') { copySelected(); e.preventDefault(); return; }
      if (k === 'v' && mode === 'prepare') { pasteClipboard(); e.preventDefault(); return; }
      if (k === 'd' && mode === 'prepare') { duplicateSelected(); e.preventDefault(); return; }
      if (k === 'y' || k === 'x' || (k === 'z' && e.shiftKey)) { redo(); e.preventDefault(); return; }
    }
    if (mode === 'prepare') {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'w') setTMode('translate');
      if (e.key === 'e') setTMode('rotate');
      if (e.key === 's') setTMode('scale');
    } else if (sliced) {
      const s = $('layerSlider');
      if (e.key === ' ') { animToggle(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { animStop(); s.value = Math.min(+s.max, +s.value + 1); setPreviewLayer(+s.value); e.preventDefault(); }
      if (e.key === 'ArrowDown') { animStop(); s.value = Math.max(1, +s.value - 1); setPreviewLayer(+s.value); e.preventDefault(); }
    }
  });
}

function setTMode(m) {
  if (m === 'frame' && state.machine === 'wasp') m = 'translate';
  tMode = m;
  tcontrols.setMode(m === 'rotate' ? 'rotate' : m === 'scale' ? 'scale' : 'translate');
  tcontrols.setSpace(m === 'scale' ? 'local' : 'world');
  tcontrols.showX = tcontrols.showY = true;
  tcontrols.showZ = m === 'rotate' || m === 'scale';
  tcontrols.setRotationSnap(m === 'rotate' ? +$('rotStep').value * D2R : null);
  $('btnMove').classList.toggle('active', m === 'translate');
  $('btnRotate').classList.toggle('active', m === 'rotate');
  $('btnScale').classList.toggle('active', m === 'scale');
  $('btnFrame').classList.toggle('active', m === 'frame');
  if (CONFIG) renderFrame();
  attachGizmo();
}

function deleteSelected() {
  if (!selected) return;
  tcontrols.detach();
  objectsRoot.remove(selected.group);
  selected.mesh.geometry.dispose();
  objects.splice(objects.indexOf(selected), 1);
  selected = null;
  select(objects[objects.length - 1] || null);
  placementChanged();
}

// ------------------------------------------------------------------------------ STL export
function objectSTL(o) { return stlB64(o.mesh.geometry, plateMatrixOf(o)); }
function stlB64(geometry, M = new THREE.Matrix4()) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position;
  const n = p.count / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), t = new THREE.Vector3();
  const flip = M.determinant() < 0;
  let off = 84;
  for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(p, 3 * i).applyMatrix4(M);
    b.fromBufferAttribute(p, 3 * i + 1).applyMatrix4(M);
    c.fromBufferAttribute(p, 3 * i + 2).applyMatrix4(M);
    if (flip) { t.copy(b); b.copy(c); c.copy(t); }
    nn.subVectors(c, b).cross(t.subVectors(a, b)).normalize();
    for (const v of [nn, a, b, c]) { dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, v.y, true); dv.setFloat32(off + 8, v.z, true); off += 12; }
    off += 2;
  }
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------------------ general settings (G-code writer)
// weave_gcode.py writes the G-code of every toolpath, so its settings apply to all of them, grouped by theme
// (CONFIG.general: speed, material, printer, output). Only changed values are kept in the project (state.gs).
const gsFields = () => (CONFIG.general || []).flatMap(g => g.fields);
// values that belong to the bead (path ends, retract before travel) or to its cross-section (Comau E per mm) follow
// the nozzle and the layer height: shown and sent for the current ones, stored for the 6 mm bead / 3.5 mm layer
const r4 = x => +(+x).toPrecision(4);
const gsRef = () => +(CONFIG.toolpaths.N2 || {}).INFILL_WIDTH || 6;
const gsRefL = () => +(CONFIG.toolpaths.N2 || {}).LAYER_HEIGHT || 3.5;
const gsScale = a => {
  const p = state.params[state.machine];
  return (a.bead_scaled ? (+p.nozzle / gsRef()) ** a.bead_scaled : 1) * (a.layer_scaled ? (+p.layer_height / gsRefL()) ** a.layer_scaled : 1);
};
const gsDefault = a => (a.kind === 'bool' || (!a.bead_scaled && !a.layer_scaled) ? a.default : r4(a.default * gsScale(a)));
const gsGet = a => { const v = (state.gs || {})[a.key]; return v === undefined ? gsDefault(a) : a.kind === 'bool' ? v : r4(v * gsScale(a)); };
const gsSend = () => Object.fromEntries(gsFields().filter(a => (state.gs || {})[a.key] !== undefined).map(a => [a.key, gsGet(a)]));
const gsVal = key => { const a = gsFields().find(x => x.key === key); return a ? gsGet(a) : undefined; };
const gsShown = g => !g.machines || g.machines.includes(state.machine);
function gsSet(a, v) {
  if (a.kind !== 'bool') {
    if (!Number.isFinite(v)) { renderGeneral(); return; }
    v = Math.min(a.max ?? Infinity, Math.max(a.min ?? -Infinity, Math.round(v * 1e4) / 1e4));
  }
  state.gs = { ...(state.gs || {}) };
  if (a.kind === 'bool' ? v === !!gsDefault(a) : Math.abs(v - gsDefault(a)) < 1e-9) delete state.gs[a.key];
  else state.gs[a.key] = a.kind === 'bool' ? v : v / gsScale(a);
  renderGeneral(); saveSettings(); scheduleResults();
  if (sliced) { anim.keys = null; updateLegend(); }
}
function checkField(label, on, onset, tip) {
  const l = document.createElement('label');
  l.className = 'check';
  l.title = tip || '';
  l.innerHTML = `<input type="checkbox"> <span></span>`;
  l.querySelector('span').textContent = label;
  const inp = l.querySelector('input');
  inp.checked = !!on;
  inp.addEventListener('change', () => onset(inp.checked));
  return l;
}
function renderGeneral() {
  document.querySelectorAll('section.fold[data-fold]').forEach(sec => {      // changed values, also when folded
    const nc = sec.querySelector('.nchg');
    if (!nc) return;
    const n = (CONFIG.general || []).filter(g => g.section === sec.dataset.fold && gsShown(g))
      .flatMap(g => g.fields).filter(a => (state.gs || {})[a.key] !== undefined).length;
    nc.textContent = n ? `${n} changed` : '';
  });
  document.querySelectorAll('.gsbox').forEach(box => {
    const groups = (CONFIG.general || []).filter(g => g.section === box.dataset.sec && gsShown(g));
    const open = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.t));
    box.innerHTML = '';
    for (const g of groups) {
      let wrap = box;
      if (g.fold) {
        wrap = document.createElement('details');
        wrap.dataset.t = g.title;
        wrap.open = open.has(g.title);
        const n = g.fields.filter(a => (state.gs || {})[a.key] !== undefined).length;
        wrap.innerHTML = `<summary>${g.title}${n ? ` <small>${n} changed</small>` : ''}</summary>`;
        box.append(wrap);
      } else if (g.title) {
        const h = document.createElement('div'); h.className = 'sub'; h.textContent = g.title; box.append(h);
      }
      const grid = document.createElement('div');
      grid.className = g.cols === 3 ? 'grid3' : 'grid2';
      for (const a of g.fields) {
        const chg = (state.gs || {})[a.key] !== undefined;
        const el = a.kind === 'bool' ? checkField(a.label, gsGet(a), v => gsSet(a, v), a.tip)
          : advField(a.label, a.unit, gsGet(a), a.step, v => gsSet(a, v), a.tip);
        el.classList.toggle('chg', chg);
        grid.append(el);
      }
      wrap.append(grid);
    }
  });
}
// speeds of the selected machine (playback, legend): WASP mm/s, Comau / UR5 feeds in mm/min
function machineSpeeds() {
  return state.machine === 'wasp'
    ? { print: +gsVal('INFILL_SPEED') || 60, travel: +gsVal('TRAVEL_SPEED') || 100, lift: +gsVal('RETRACT_LIFT') || 10 }
    : { print: (+gsVal('COMAU_PRINT_FEED') || 3000) / 60, travel: (+gsVal('COMAU_TRAVEL_FEED') || 6000) / 60, lift: +gsVal('COMAU_LIFT') || 10 };
}

// ------------------------------------------------------------------------------ advanced toolpath settings
// Per toolpath: settings of the toolpath script itself (N1/N2: weave_pattern.py, custom scripts: their
// ADVANCED list) with a top view of one layer of the selected object (first layers only, so it is quick).
let advOpen = false, advLayer = 2, advRes = null, advSeq = 0, advTimer = null;
const advSpec = () => ((CONFIG.toolpaths[state.toolpath] || {}).advanced) || [];
const advStored = () => {                // values changed for this toolpath (keys it no longer offers are left out)
  const keys = new Set(advSpec().map(a => a.key));
  return Object.fromEntries(Object.entries((state.adv || {})[state.toolpath] || {}).filter(([k]) => keys.has(k)));
};
const advVals = () => {                  // the changed values in real mm for the current nozzle (sent for slicing)
  const st = advStored();
  return Object.fromEntries(advSpec().filter(a => st[a.key] !== undefined).map(a => [a.key, advGet(a)]));
};
// sinusoidal settings in mm are made for their reference bead (INFILL_WIDTH); the engine scales them with the nozzle,
// so default and limits are shown for the nozzle in use (ANCHOR 8 mm at 6 mm = 1.3 mm at 1 mm; areas with k * k)
const beadK = () => +state.params[state.machine].nozzle / (+(CONFIG.toolpaths[state.toolpath] || {}).INFILL_WIDTH || 6);
const advScale = a => (a.bead_scaled ? beadK() ** (+a.bead_scaled) : 1);
const advDefault = a => (a.kind === 'bool' ? !!a.default : a.bead_scaled ? r4(a.default * advScale(a)) : a.default);
const advGet = a => { const v = advStored()[a.key]; return v === undefined ? advDefault(a) : a.kind === 'bool' ? v : a.bead_scaled ? r4(v * advScale(a)) : v; };
const clampv = (v, a) => Math.min(a.max != null ? a.max * advScale(a) : Infinity, Math.max(a.min != null ? a.min * advScale(a) : -Infinity, v));
function advSet(key, v) {
  const a = advSpec().find(x => x.key === key);
  if (!a || (a.kind !== 'bool' && !Number.isFinite(v))) { renderAdvanced(); return; }
  if (a.kind !== 'bool') v = clampv(a.int ? Math.round(v) : Math.round(v * 1e4) / 1e4, a);
  state.adv = { ...(state.adv || {}) };
  const cur = advStored();
  if (a.kind === 'bool' ? v === advDefault(a) : Math.abs(v - advDefault(a)) < 1e-9) delete cur[key];
  else cur[key] = a.kind === 'bool' || !a.bead_scaled ? v : v / advScale(a);     // stored for the reference bead
  state.adv[state.toolpath] = cur;
  renderAdvanced(); markStale(); saveSettings(); schedulePreview();
}
function advField(label, unit, value, step, onset, hint) {
  const l = document.createElement('label');
  l.title = hint || '';
  l.innerHTML = `${label}<div class="unit${(unit || '').length > 4 ? ' long' : !unit ? ' none' : ''}"><input type="number" step="${step || 1}"><i>${unit || ''}</i></div>`;
  const inp = l.querySelector('input');
  inp.value = value;
  inp.addEventListener('change', () => onset(parseFloat(inp.value)));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });   // Enter = apply
  return l;
}
function renderAdvanced() {
  const spec = advSpec(), imp = sliced && sliced.kind === 'gcode';
  $('advWrap').classList.toggle('hidden', !spec.length || !!imp);
  $('advToggle').classList.toggle('open', advOpen);
  $('advBox').classList.toggle('hidden', !advOpen);
  const changed = Object.keys(advVals()).length;
  $('advCount').textContent = changed ? `${changed} changed` : '';
  if (!advOpen || !spec.length) return;
  $('advReset').disabled = !changed;
  document.querySelectorAll('#advLayers button').forEach(b => b.classList.toggle('active', +b.dataset.l === advLayer));
  const box = $('advFields'), hints = [];
  const nz = +state.params[state.machine].nozzle;
  const built = JSON.stringify([state.toolpath, nz, advVals()]);
  if (box.dataset.built === built) { drawAdvPreview(); return; }   // nothing changed: keep the fields
  box.dataset.built = built;
  box.innerHTML = '';
  let grp = null;
  for (const a of spec) {
    if (a.group && a.group !== grp) {           // sinusoidal: Perimeters / Infill
      grp = a.group;
      const h = document.createElement('div'); h.className = 'sub'; h.textContent = grp; box.append(h);
    }
    if (a.kind === 'bool') {
      const el = checkField(a.label, advGet(a), v => advSet(a.key, v), a.tip);
      el.classList.toggle('chg', advVals()[a.key] !== undefined);
      box.append(el);
    } else if (a.kind === 'spacing') {                 // stored as a multiple of the bead width
      const sp = advGet(a);
      box.append(advField('Line spacing', 'mm', +(sp * nz).toFixed(2), 0.5, v => advSet(a.key, v / nz), a.hint));
      box.append(advField('Infill density', '%', +(100 / sp).toFixed(1), 5, v => advSet(a.key, 100 / v), a.hint));
    } else {
      const el = advField(a.label, a.unit, advGet(a), a.step, v => advSet(a.key, v), a.hint || a.tip);
      el.classList.toggle('chg', advVals()[a.key] !== undefined);
      box.append(el);
    }
    if (a.hint) hints.push(`<b>${a.kind === 'spacing' ? 'Spacing / density' : a.label}</b> ${a.hint}`);
  }
  $('advHints').innerHTML = hints.join('<br>');
  drawAdvPreview();
}
function schedulePreview(delay = 500) {
  if (!advOpen || !advSpec().length) return;
  clearTimeout(advTimer);
  advTimer = setTimeout(runPreview, delay);
}
async function runPreview() {
  const o = (selected && selected.visible) ? selected : objects.find(x => x.visible);
  const seq = ++advSeq, sig = advSig();
  if (!o) { advRes = { msg: 'Add an object to see the preview.' }; drawAdvPreview(); return; }
  const p = state.params[state.machine], tp = state.toolpath, weave = !CONFIG.toolpaths[tp].custom;
  $('advStatus').textContent = weave ? `computing ${tp} (about 10 s)…` : 'computing…';
  $('advCanvas').classList.add('busy');
  try {
    const r = await api('/api/preview', {
      toolpath: tp, objects: [{ name: o.name, stl: objectSTL(o) }], adv: advVals(),
      params: { nozzle: p.nozzle, layer_height: p.layer_height, first_layer_height: p.first_layer_height },
    });
    if (seq !== advSeq) return;
    advRes = r.ok ? { layers: r.layers, log: r.log || [], obj: o.name, tp, sig } : { msg: `${tp} cannot make this part: ${(r.error || '').replace(/^\w+Error: /, '')}`, err: true };
  } catch (e) {
    if (seq !== advSeq) return;
    advRes = { msg: e.message, err: true };
  }
  $('advCanvas').classList.remove('busy');
  drawAdvPreview();
}
function advInfo() {
  if (!advRes || !advRes.layers) return '';
  const L = advRes.layers[Math.min(advLayer, advRes.layers.length) - 1];
  const out = [`${advRes.obj} · layer ${L.index + 1}, ${L.paths.length} paths`];
  const lg = advRes.log.join('\n');
  const raised = lg.match(/L raised from ([\d.]+) to ([\d.]+) cm/), wl = lg.match(/wavelength ([\d.]+) mm/);
  const kb = /computed at ([\d.]+) x size/.test(lg) ? beadK() : 1;      // the weave was computed at the reference bead
  if (wl) out.push(`wavelength ${(wl[1] * kb).toFixed(1)} mm` + (raised ? ` (raised from ${(raised[1] * 10 * kb).toFixed(1)} so the beads stay clear)` : ''));
  const cy = lg.match(/cycles: corner=(\d+) side=(\d+) blue-arc=(\d+)/);
  if (cy) out.push(`waves: ${cy[2]} per triangle side, ${cy[1]} per corner, ${cy[3]} per arc`);
  const sp = advSpec().find(a => a.kind === 'spacing');
  if (sp) out.push(`infill density ${(100 / advGet(sp)).toFixed(0)} %`);
  return out.join(' · ');
}
function drawAdvPreview() {
  const cv = $('advCanvas');
  if (!cv || !advOpen) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  $('advStatus').textContent = advRes && advRes.layers ? advInfo() : (advRes && advRes.err ? 'No preview: see the message above.' : '');
  if (!advRes || !advRes.layers) {
    g.fillStyle = advRes && advRes.err ? '#c8102e' : '#6b7580';
    g.font = '12px system-ui, sans-serif';
    const words = ((advRes && advRes.msg) || 'Open to compute a preview.').split(' ');
    let line = '', y = 24;
    for (const wd of words) {                    // simple word wrap
      if (g.measureText(line + wd).width > w - 24) { g.fillText(line, 12, y); line = ''; y += 17; }
      line += wd + ' ';
    }
    g.fillText(line, 12, y);
    return;
  }
  paintLayer(g, w, h);
}
function paintLayer(g, w, h) {               // the selected layer of advRes, to scale, into a canvas context
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const L of advRes.layers) for (const p of L.paths) for (const [x, y] of p.pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const L = advRes.layers[Math.min(advLayer, advRes.layers.length) - 1];
  const m = 12, k = Math.min((w - 2 * m) / Math.max(x1 - x0, 1), (h - 2 * m) / Math.max(y1 - y0, 1));
  const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
  const X = x => ox + (x - x0) * k, Y = y => h - (oy + (y - y0) * k);
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const pass of [0, 1]) for (const p of L.paths) {          // beads to scale, then their centre lines
    const st = TYPE_STYLE[p.type] || TYPE_STYLE.other;
    g.beginPath();
    p.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    if (p.closed) g.closePath();
    if (pass === 0) {
      g.strokeStyle = '#' + st.color.toString(16).padStart(6, '0') + '55';
      g.lineWidth = Math.max(1, (p.width || 6) * k);
    } else {
      g.strokeStyle = '#' + st.color.toString(16).padStart(6, '0');
      g.lineWidth = 1;
    }
    g.stroke();
  }
  const fs = Math.max(10, Math.round(w / 40)), bw = Math.max(2, Math.round(fs / 5));
  g.fillStyle = '#6b7580'; g.font = `${fs}px system-ui, sans-serif`;
  const bar = 50 * k > 60 ? 50 : 10;                 // scale bar
  g.fillRect(m, h - m - bw, bar * k, bw);
  g.fillText(`${bar} mm`, m, h - m - bw - 4);
}

// export: the layer shown in the toolpath settings as a .png (computed first if it is missing or out of date)
const advSig = () => { const o = (selected && selected.visible) ? selected : objects.find(x => x.visible), p = state.params[state.machine];
  return JSON.stringify([state.toolpath, p.nozzle, p.layer_height, p.first_layer_height, advVals(), o ? [o.id, o.rot, o.scale, o.unit] : null]); };
async function previewPNG() {
  if (!advSpec().length) return null;
  if (!advRes || !advRes.layers || advRes.sig !== advSig()) await runPreview();
  if (!advRes || !advRes.layers) return null;
  const S = 1600, cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.save(); g.translate(40, 40); paintLayer(g, S - 80, S - 120); g.restore();
  const L = advRes.layers[Math.min(advLayer, advRes.layers.length) - 1], p = state.params[state.machine];
  g.fillStyle = '#0c2340'; g.font = '600 26px system-ui, sans-serif';
  g.fillText(`${advRes.obj} · ${tpTitle(advRes.tp)} · layer ${L.index + 1} · bead ${p.nozzle} mm`, 40, S - 36);
  return cv.toDataURL('image/png');
}
function bindAdvanced() {
  $('advToggle').onclick = () => { advOpen = !advOpen; renderAdvanced(); if (advOpen) schedulePreview(0); };
  $('advReset').onclick = () => {
    state.adv = { ...(state.adv || {}) }; delete state.adv[state.toolpath];
    renderAdvanced(); markStale(); saveSettings(); schedulePreview(0);
  };
  $('advRefresh').onclick = () => schedulePreview(0);
  document.querySelectorAll('#advLayers button').forEach(b => b.onclick = () => { advLayer = +b.dataset.l; renderAdvanced(); outputHints(); });
  new ResizeObserver(() => drawAdvPreview()).observe($('advCanvas'));
}

// ------------------------------------------------------------------------------ slicing
let busyTimer = null;
function busy(on, text) {
  $('busy').classList.toggle('hidden', !on);
  clearInterval(busyTimer);
  if (on) {
    const t0 = Date.now();
    const upd = () => { $('busyText').textContent = `${text}  ${((Date.now() - t0) / 1000).toFixed(0)} s`; };
    upd(); busyTimer = setInterval(upd, 500);
  }
}

async function slicePlate() {
  if (!objects.length) { log('Add an object to the plate first.', true); return; }
  const p = state.params[state.machine];
  const sig = sliceSignature();
  animStop();
  busy(true, `Slicing ${objects.length} object${objects.length > 1 ? 's' : ''} with ${tpTitle(state.toolpath)}…`);
  $('exportCard').classList.add('hidden');
  try {
    const r = await api('/api/slice', {
      toolpath: state.toolpath,
      objects: objects.map(o => ({ name: o.name, stl: objectSTL(o) })),
      params: { nozzle: p.nozzle, layer_height: p.layer_height, first_layer_height: p.first_layer_height },
      adv: advVals(),
    });
    if (r.log) log(r.log);
    if (!r.ok) { log(`Slicing failed: ${r.error}`, true); return; }
    log(`Sliced with ${tpTitle(state.toolpath)} in ${r.seconds} s: ${r.toolpaths.layers.length} layers`);
    sliced = { kind: 'slice', slice_id: r.slice_id, layers: r.toolpaths.layers, toolpath: state.toolpath, signature: sig, objIds: objects.map(o => o.id) };
    stale = false;
    setBadge('stale', null);
    buildPreview();
    setMode('preview');
    $('btnExport').disabled = false;
    scheduleResults(0);
  } catch (e) {
    log(`Slicing failed: ${e.message}`, true);
  } finally {
    busy(false);
  }
}

function sliceSignature() {
  const p = state.params[state.machine];
  return JSON.stringify([state.toolpath, p.nozzle, p.layer_height, p.first_layer_height, advVals(),
    objects.map(o => [o.id, o.unit, o.rot.join(','), o.scale.join(','), o.group.position.x.toFixed(2), o.group.position.y.toFixed(2)])]);
}
function markStale() {
  if (!sliced || sliced.kind !== 'slice') return;
  const was = stale;
  stale = sliceSignature() !== sliced.signature;
  setBadge('stale', stale ? 'Plate or slicing settings changed since slicing: slice again before exporting.' : null);
  if (results && was !== stale) renderResults();
}

// ------------------------------------------------------------------------------ results (shown before export, in the log panel)
// The G-code writer runs in memory for the selected machine with the current general settings (no new slice needed):
// general results for every toolpath, plus the slicer's results of the sinusoidal toolpaths.
let results = null, resSeq = 0, resTimer = null;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function scheduleResults(delay = 400) {
  clearTimeout(resTimer);
  if (!sliced || sliced.kind !== 'slice') { resSeq++; results = null; renderResults(); return; }
  resTimer = setTimeout(fetchResults, delay);
}
async function fetchResults() {
  const seq = ++resSeq, m = state.machine, sl = sliced;
  try {
    const r = await api('/api/results', { slice_id: sl.slice_id, machine: m, gs: gsSend() });
    if (seq !== resSeq) return;
    results = r.ok ? { rows: r.rows, data: r.results, machine: m, slice_id: sl.slice_id, toolpath: sl.toolpath }
      : { error: (r.error || '').replace(/^\w+Error: /, ''), machine: m };
  } catch (e) {
    if (seq !== resSeq) return;
    results = { error: e.message, machine: m };
  }
  renderResults(true);
  if (sliced) updateLegend();
}
const resultsNow = () => results && !results.error && sliced && results.slice_id === sliced.slice_id && results.machine === state.machine ? results : null;
function renderResults(show = false) {
  const box = $('resultsBox');
  $('resToggle').classList.toggle('hidden', !results);
  if (!results) { box.innerHTML = ''; if ($('logBox').classList.contains('res')) setLogView(null); return; }
  if (results.error) {
    box.innerHTML = `<h5>Results</h5><p>${esc(results.error)}</p>`;
  } else {
    const title = tpTitle(results.toolpath), names = { '': 'General', pattern: title };
    let html = `<h5>Results · ${esc(MACHINES[results.machine])}</h5><table>`, last = null;
    for (const [sec, l, v] of results.rows) {
      if (sec !== last) { html += `<tr class="grp"><td colspan="2">${esc(names[sec] || sec)}</td></tr>`; last = sec; }
      html += `<tr class="${/OVER|above/.test(v) ? 'warn' : ''}"><td>${esc(l)}</td><td>${esc(v)}</td></tr>`;
    }
    html += '</table>';
    if (stale) html += '<p>Slicing settings changed since slicing: slice again for current results.</p>';
    box.innerHTML = html;
  }
  if (show) setLogView('res');
}
function setLogView(v) {                     // 'res' | 'log' | null
  const b = $('logBox');
  b.classList.toggle('res', v === 'res');
  b.classList.toggle('open', v === 'log');
  $('resToggle').classList.toggle('on', v === 'res');
  $('logToggle').classList.toggle('on', v === 'log');
  if (v === 'log') { b.classList.remove('unread'); $('logText').scrollTop = $('logText').scrollHeight; }
}

// ------------------------------------------------------------------------------ preview
let previewMesh = null, layerEnds = [], layerLast = [], segs = [], segLayer = [];
const hidden = new Set();

function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (Math.hypot(lx - fx, ly - fy) < 1e-6) {          // closed loop: split at the point farthest from the start
    let far = 1, fd = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - fx, pts[i][1] - fy); if (d > fd) { fd = d; far = i; } }
    if (fd <= 0) return [pts[0]];
    return [...rdp(pts.slice(0, far + 1), tol).slice(0, -1), ...rdp(pts.slice(far), tol)];
  }
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
function segMatrix(i, f = 1) {               // bead i, the first fraction f of it
  const [x0, y0, x1, y1, zc, w, h, , l] = segs[i];
  const xe = x0 + (x1 - x0) * f, ye = y0 + (y1 - y0) * f;
  _p.set((x0 + xe) / 2, (y0 + ye) / 2, zc);
  _q.setFromAxisAngle(_z, Math.atan2(y1 - y0, x1 - x0));
  _s.set(l * f + w * 0.35 * Math.min(1, f * 4), w, h);
  return _m.compose(_p, _q, _s);
}

function buildPreview() {
  animReset();
  previewRoot.clear();
  if (previewMesh) { disposeHighlights(); previewMesh.geometry.dispose(); previewMesh.material.dispose(); previewMesh = null; }
  const layers = sliced.layers;
  segs = []; segLayer = []; layerEnds = []; layerLast = [];
  const shownPaths = [];
  let len = 0;
  const nozzle = state.params[state.machine].nozzle;
  layers.forEach((L, li) => {
    const zc = L.z - L.height / 2;
    let last = null;
    for (const p of L.paths) {
      const type = TYPE_STYLE[p.type] ? p.type : 'other';
      if (hidden.has(type)) continue;
      if (sliced.objIds && p.obj != null) {             // hidden object -> its toolpath is hidden too
        const o = registry.get(sliced.objIds[p.obj]);
        if (o && (!objects.includes(o) || !isShown(o))) continue;
      }
      const pts = previewPts(p);
      const w = p.width || nozzle;
      const first = segs.length, segAt = [0];
      for (let i = 1; i < pts.length; i++) {
        segAt[i] = segs.length;
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const l = Math.hypot(x1 - x0, y1 - y0);
        if (l < 1e-6) continue;
        segs.push([x0, y0, x1, y1, zc, w, L.height, type, l, L.z]);
        segLayer.push(li);
        len += l;
      }
      if (segs.length > first) shownPaths.push({ p, li, pts, w, zc, h: L.height, first, segAt });
      if (pts.length) last = pts[pts.length - 1];
    }
    layerEnds[li] = segs.length;
    layerLast[li] = last ? new THREE.Vector3(last[0], last[1], L.z) : (layerLast[li - 1] || new THREE.Vector3(0, 0, L.z));
  });
  sliced.length = len; sliced.segments = segs.length;
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);   // bead: 6-sided prism along x
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.0 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, segs.length));
  const col = new THREE.Color();
  segs.forEach((s, i) => { mesh.setMatrixAt(i, segMatrix(i)); mesh.setColorAt(i, col.setHex(TYPE_STYLE[s[7]].color)); });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  previewMesh = mesh;
  previewRoot.add(mesh);
  mesh.userData.paths = shownPaths;
  buildHighlights();
  const sl = $('layerSlider');
  sl.max = layers.length;
  sl.value = layers.length;
  setPreviewLayer(layers.length);
  updateLegend();
}

function setPreviewLayer(n) {
  if (!sliced || !previewMesh) return;
  restorePartial();
  n = Math.max(1, Math.min(n, sliced.layers.length));
  previewMesh.count = layerEnds[n - 1] || 0;
  syncHighlights(previewMesh.count);
  showLayerLabel(n);
  if (mode === 'preview') poseMachine(layerLast[n - 1]);
}
function showLayerLabel(n) {
  const L = sliced.layers[n - 1];
  $('layerNow').textContent = `${n} / ${sliced.layers.length}`;
  $('layerZ').textContent = `${L.z.toFixed(1)} mm`;
}

function updateLegend() {
  if (!sliced) return;
  const el = $('legend');
  const p = state.params[state.machine];
  const types = [...new Set(sliced.layers.flatMap(L => L.paths.map(q => TYPE_STYLE[q.type] ? q.type : 'other')))];
  const rn = resultsNow(), t = sliced.length / machineSpeeds().print;
  el.innerHTML = types.map(k => `<div class="row${hidden.has(k) ? ' off' : ''}" data-k="${k}"><span class="sw" style="background:#${TYPE_STYLE[k].color.toString(16).padStart(6, '0')}"></span>${TYPE_STYLE[k].label}</div>`).join('') +
    `<div class="stats"><span>Source</span><span>${sliced.kind === 'gcode' ? 'imported G-code' : tpTitle(sliced.toolpath)}</span>` +
    `<span>Layers</span><span>${sliced.layers.length}</span>` +
    `<span>Height</span><span>${sliced.layers[sliced.layers.length - 1].z.toFixed(1)} mm</span>` +
    `<span>Path</span><span>${(sliced.length / 1000).toFixed(1)} m</span>` +
    `<span>Print time</span><span>${rn ? `${fmtTime(rn.data.time_s[0])} – ${fmtTime(rn.data.time_s[1])}` : `≈ ${fmtTime(t)}`}</span></div>` +
    `<div class="ctl"><label><input type="checkbox" id="showModel" ${showModel ? 'checked' : ''}> Show model</label>` +
    `<div class="mview"><span>Machine</span>${['solid', 'ghost', 'hidden'].map(v => `<button data-v="${v}" class="${machineView === v ? 'on' : ''}">${{ solid: 'Solid', ghost: 'Transparent', hidden: 'Off' }[v]}</button>`).join('')}</div>` +
    `<div class="mview hl"><span>Highlight</span>${Object.entries(HL_STYLE).map(([k, h]) => `<button data-h="${k}" class="${hl.has(k) ? 'on' : ''}" title="${h.title}"><i style="background:#${h.color.toString(16).padStart(6, '0')}"></i>${h.label}</button>`).join('')}</div></div>`;
  el.querySelectorAll('.row').forEach(r => r.onclick = () => {
    const k = r.dataset.k;
    hidden.has(k) ? hidden.delete(k) : hidden.add(k);
    buildPreview();
  });
  $('showModel').onchange = e => { showModel = e.target.checked; applyModeVisibility(); };
  el.querySelectorAll('.mview button[data-v]').forEach(b => b.onclick = () => { machineView = b.dataset.v; applyMachineView(); updateLegend(); });
  el.querySelectorAll('.mview button[data-h]').forEach(b => b.onclick = () => {
    const k = b.dataset.h;
    hl.has(k) ? hl.delete(k) : hl.add(k);
    buildHighlights();
    if (previewMesh) syncHighlights(previewMesh.count);
    updateLegend();
  });
}
let showModel = false;

// ------------------------------------------------------------------------------ highlights: seams, anchors, overlaps
// Seams: start / end point of every closed loop. Anchors: an infill bead touching another infill bead or a far
// part of itself (the shared peak contacts of the sinusoidal weave). Overlaps: an infill bead touching a wall
// (outer / inner wall: the wall-contact plateaus). Contacts are found from the toolpath geometry of each layer:
// centre lines closer than the mean bead width + 10 %. Works for every toolpath and for imported G-code
// (no wall types there: anchors only).
const hl = new Set();
const contactCache = new WeakMap();      // path -> { nozzle, anchors: [[a0, a1], ...], overlaps: [...] } (arc length, mm)

function previewPts(p) {
  let pts = rdp(p.pts, 0.2);
  if (p.closed && pts.length > 2) pts = [...pts, pts[0]];
  return pts;
}
function isLoop(p, pts, w) {
  if (pts.length < 4) return false;
  const a = pts[0], b = pts[pts.length - 1];
  return !!p.closed || Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5 * w;
}
function arcOf(pts) {
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return arc;
}

function layerContacts(L, nozzle) {
  const P = L.paths.map(p => {
    const pts = previewPts(p), w = p.width || nozzle, arc = arcOf(pts);
    return { p, pts, w, arc, len: arc[arc.length - 1] || 0, wall: WALL_TYPES.has(p.type), loop: isLoop(p, pts, w) };
  });
  const wmax = Math.max(nozzle, ...P.map(q => q.w));
  const cs = 2 * wmax, grid = new Map();
  const cell = (i, j) => { const k = i + ',' + j; let c = grid.get(k); if (!c) grid.set(k, c = []); return c; };
  P.forEach((q, pi) => {
    for (let s = 1; s < q.pts.length; s++) {
      const [x0, y0] = q.pts[s - 1], [x1, y1] = q.pts[s];
      for (let i = Math.floor(Math.min(x0, x1) / cs); i <= Math.floor(Math.max(x0, x1) / cs); i++)
        for (let j = Math.floor(Math.min(y0, y1) / cs); j <= Math.floor(Math.max(y0, y1) / cs); j++) cell(i, j).push(pi, s);
    }
  });
  P.forEach((q, pa) => {
    const res = { nozzle, anchors: [], overlaps: [] };
    contactCache.set(q.p, res);
    if (q.wall || q.len <= 0) return;
    const step = q.w / 3, r = (q.w + wmax) / 2 * 1.1;
    const add = (list, a0, a1) => { const t = list[list.length - 1]; if (t && a0 - t[1] < 1e-6) t[1] = a1; else list.push([a0, a1]); };
    for (let s = 1; s < q.pts.length; s++) {
      const [x0, y0] = q.pts[s - 1], [x1, y1] = q.pts[s];
      const l = q.arc[s] - q.arc[s - 1];
      if (l < 1e-6) continue;
      const n = Math.ceil(l / step);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, a = q.arc[s - 1] + l * t;
        let an = false, ov = false;
        for (let i = Math.floor((x - r) / cs); i <= Math.floor((x + r) / cs) && !(an && ov); i++)
          for (let j = Math.floor((y - r) / cs); j <= Math.floor((y + r) / cs); j++) {
            const c = grid.get(i + ',' + j);
            if (!c) continue;
            for (let m = 0; m < c.length; m += 2) {
              const pj = c[m], sj = c[m + 1], o = P[pj];
              if (o.wall ? ov : an) continue;
              const [ax, ay] = o.pts[sj - 1], [bx, by] = o.pts[sj];
              const dx = bx - ax, dy = by - ay, LL = dx * dx + dy * dy;
              const u = LL > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / LL)) : 0;
              const d = Math.hypot(x - ax - dx * u, y - ay - dy * u);
              if (d > (q.w + o.w) / 2 * 1.1) continue;
              if (pj === pa) {                         // own bead: only a part far away along the path counts
                let da = Math.abs(o.arc[sj - 1] + Math.sqrt(LL) * u - a);
                if (q.loop) da = Math.min(da, q.len - da);
                if (da < 3 * q.w) continue;
              }
              if (o.wall) ov = true; else an = true;
            }
          }
        const a0 = q.arc[s - 1] + l * k / n, a1 = q.arc[s - 1] + l * (k + 1) / n;
        if (an) add(res.anchors, a0, a1);
        if (ov) add(res.overlaps, a0, a1);
      }
    }
  });
}
function contactsFor(p, li, nozzle) {
  let c = contactCache.get(p);
  if (!c || c.nozzle !== nozzle) { layerContacts(sliced.layers[li], nozzle); c = contactCache.get(p); }
  return c;
}

function disposeHighlights() {
  if (!previewMesh) return;
  for (const m of previewMesh.children.slice()) { previewMesh.remove(m); m.geometry.dispose(); m.material.dispose(); }
}
function buildHighlights() {
  disposeHighlights();
  if (!previewMesh || !hl.size || !sliced) return;
  const nozzle = +state.params[state.machine].nozzle;
  const seams = [], pieces = { anchors: [], overlaps: [] };
  for (const sp of previewMesh.userData.paths || []) {
    if (hl.has('seams') && isLoop(sp.p, sp.pts, sp.w)) seams.push([sp.pts[0][0], sp.pts[0][1], sp.zc, sp.w, sp.h, sp.first]);
    if (!hl.has('anchors') && !hl.has('overlaps')) continue;
    const c = contactsFor(sp.p, sp.li, nozzle), arc = arcOf(sp.pts);
    for (const kind of ['anchors', 'overlaps']) {
      if (!hl.has(kind)) continue;
      let s = 1;
      for (const [a0, a1] of c[kind]) {               // cut the arc interval along the polyline
        while (s < sp.pts.length - 1 && arc[s] <= a0) s++;
        for (let t = s; t < sp.pts.length && arc[t - 1] < a1; t++) {
          const l = arc[t] - arc[t - 1];
          if (l < 1e-6) continue;
          const f0 = Math.max(0, (a0 - arc[t - 1]) / l), f1 = Math.min(1, (a1 - arc[t - 1]) / l);
          if (f1 - f0 < 1e-6) continue;
          const [x0, y0] = sp.pts[t - 1], [x1, y1] = sp.pts[t];
          pieces[kind].push([x0 + (x1 - x0) * f0, y0 + (y1 - y0) * f0, x0 + (x1 - x0) * f1, y0 + (y1 - y0) * f1, sp.zc, sp.w, sp.h, sp.segAt[t]]);
        }
      }
    }
  }
  const mk = (kind, geo, list, place) => {
    if (!list.length) { geo.dispose(); return; }
    const col = HL_STYLE[kind].color;
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0 });
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const idx = new Int32Array(list.length);
    list.forEach((e, i) => { m.setMatrixAt(i, place(e)); idx[i] = e[e.length - 1]; });
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.userData.idx = idx;
    previewMesh.add(m);
  };
  mk('seams', new THREE.SphereGeometry(0.5, 14, 10), seams, ([x, y, zc, w, h]) => {
    _p.set(x, y, zc); _q.identity(); _s.set(w * 1.2, w * 1.2, Math.max(h * 1.6, w * 0.6));
    return _m.compose(_p, _q, _s);
  });
  for (const kind of ['anchors', 'overlaps']) {
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
    geo.rotateZ(Math.PI / 2);
    mk(kind, geo, pieces[kind], ([x0, y0, x1, y1, zc, w, h]) => {
      _p.set((x0 + x1) / 2, (y0 + y1) / 2, zc);
      _q.setFromAxisAngle(_z, Math.atan2(y1 - y0, x1 - x0));
      _s.set(Math.hypot(x1 - x0, y1 - y0) + w * 0.15, w * 1.12, h * 1.12);
      return _m.compose(_p, _q, _s);
    });
  }
}
function syncHighlights(count) {              // show the highlights of the beads already shown
  if (!previewMesh) return;
  for (const m of previewMesh.children) {
    const idx = m.userData.idx;
    if (!idx) continue;
    let lo = 0, hi = idx.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (idx[mid] < count) lo = mid + 1; else hi = mid; }
    m.count = lo;
  }
}

function applyModeVisibility() {
  applyMachineView();
  const prev = mode === 'preview' && sliced;
  previewRoot.visible = !!prev;
  objectsRoot.visible = !prev || showModel;
  objects.forEach(o => {
    o.mesh.material.transparent = !!prev;
    o.mesh.material.opacity = prev ? 0.18 : 1;
    o.mesh.material.depthWrite = !prev;
  });
}

function setMode(m) {
  mode = m;
  if (m !== 'preview') animStop();
  $('tabPrepare').classList.toggle('active', m === 'prepare');
  $('tabPreview').classList.toggle('active', m === 'preview');
  $('toolbar').classList.toggle('preview', m === 'preview');
  const show = m === 'preview' && !!sliced;
  ['layerbar', 'legend', 'player'].forEach(id => $(id).classList.toggle('hidden', !show));
  if (m === 'preview') {
    tcontrols.detach();
    if (sliced) { if (anim.t > 0) animRender(); else setPreviewLayer(+$('layerSlider').value); }
    else setBadge('nothing', 'Nothing sliced yet: press Slice plate.');
  } else { setBadge('nothing', null); attachGizmo(); poseMachine(); }
  applyModeVisibility();
}

// ------------------------------------------------------------------------------ playback (robot follows the toolpath)
const anim = { playing: false, t: 0, keys: null, total: 0, partial: -1, last: 0 };

function buildTimeline() {
  const p = state.params[state.machine];
  const sp = machineSpeeds(), ps = sp.print, ts = sp.travel, lift = sp.lift;
  const keys = [];
  let t = 0, prev = null;
  const key = (x, y, z, done) => keys.push({ t, x, y, z, done });
  segs.forEach((s, i) => {
    const [x0, y0, x1, y1, , , , , l, z] = s;
    if (!prev) key(x0, y0, z + lift, 0);
    else {
      const d = Math.hypot(x0 - prev[0], y0 - prev[1]);
      if (d > 0.05 || Math.abs(z - prev[2]) > 0.01) {
        if (d < 3 && Math.abs(z - prev[2]) < 0.01) { t += d / ts; }              // short hop: no lift
        else {
          const top = Math.max(z, prev[2]) + lift;
          t += (top - prev[2]) / ts; key(prev[0], prev[1], top, i);
          t += d / ts; key(x0, y0, top, i);
          t += (top - z) / ts;
        }
      }
    }
    key(x0, y0, z, i);
    t += l / ps;
    key(x1, y1, z, i + 1);
    prev = [x1, y1, z];
  });
  anim.keys = keys;
  anim.total = t;
}

function restorePartial() {
  if (anim.partial >= 0 && previewMesh) {
    previewMesh.setMatrixAt(anim.partial, segMatrix(anim.partial));
    previewMesh.instanceMatrix.needsUpdate = true;
  }
  anim.partial = -1;
}

const _pt = new THREE.Vector3();
function animRender() {
  if (!sliced || !previewMesh) return;
  if (!anim.keys) buildTimeline();
  const K = anim.keys;
  if (!K.length) return;
  const t = Math.min(Math.max(anim.t, 0), anim.total);
  let lo = 0, hi = K.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (K[mid].t <= t) lo = mid; else hi = mid; }
  const a = K[lo], b = K[Math.min(lo + 1, K.length - 1)];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  _pt.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
  restorePartial();
  let count = a.done;
  if (b.done > a.done && f > 0 && f < 1) {   // bead being printed: show the part already laid down
    previewMesh.setMatrixAt(a.done, segMatrix(a.done, f));
    previewMesh.instanceMatrix.needsUpdate = true;
    anim.partial = a.done;
    count = a.done + 1;
  } else if (b.done > a.done && f >= 1) count = b.done;
  previewMesh.count = count;
  syncHighlights(count);
  const li = segLayer[Math.max(0, Math.min(count, segs.length) - 1)] ?? 0;
  $('layerSlider').value = li + 1;
  showLayerLabel(li + 1);
  poseMachine(_pt);
  $('animScrub').value = Math.round(t / anim.total * 1000);
  $('animTime').textContent = `${fmtTime(t)} / ${fmtTime(anim.total)}`;
}

function animToggle() {
  if (!sliced) return;
  if (!anim.keys) buildTimeline();
  if (anim.playing) { animStop(); return; }
  if (anim.t >= anim.total) anim.t = 0;
  anim.playing = true;
  anim.last = performance.now();
  $('animPlay').textContent = '❚❚';
}
function animStop() {
  anim.playing = false;
  $('animPlay').textContent = '▶';
}
function animReset() {
  animStop();
  anim.t = 0; anim.keys = null; anim.partial = -1;
  $('animScrub').value = 0;
  $('animTime').textContent = '0:00 / 0:00';
}
function animTick(now) {
  if (!anim.playing) return;
  const dt = Math.min(0.1, (now - anim.last) / 1000);
  anim.last = now;
  anim.t += dt * +$('animSpeed').value;
  if (anim.t >= anim.total) { anim.t = anim.total; animStop(); }
  animRender();
}

function bindPlayer() {
  $('animPlay').onclick = animToggle;
  $('animRestart').onclick = () => { anim.t = 0; animRender(); };
  $('animScrub').addEventListener('input', e => {
    if (!anim.keys) buildTimeline();
    anim.t = +e.target.value / 1000 * anim.total;
    animRender();
  });
  $('layerSlider').addEventListener('input', e => { animStop(); anim.t = 0; setPreviewLayer(+e.target.value); });
}

// ------------------------------------------------------------------------------ import G-code
async function importGcode(file) {
  const text = await file.text();
  const parsed = parseGcode(text);
  if (!parsed.layers.length) { log(`${file.name}: no extruding moves found`, true); return; }
  sliced = { kind: 'gcode', name: file.name, text, layers: parsed.layers };
  scheduleResults();
  stale = false;
  setBadge('stale', null);
  log(`Imported ${file.name}: ${parsed.layers.length} layers, ${parsed.moves} extruding moves${parsed.notes.length ? ' · ' + parsed.notes.join(' · ') : ''}`);
  renderSettings();
  renderObjectList();
  buildPreview();
  setMode('preview');
  fitView('plate');
  $('btnExport').disabled = false;
}

// ------------------------------------------------------------------------------ export
// folder for the export: native dialog in the app window, a small dialog in the browser
async function chooseFolder(name) {
  if (window.lamaBrowser) return 'Browser downloads';
  const start = state.out_dir || CONFIG.out_dir;
  if (desktop()) {
    try { return await window.pywebview.api.pick_folder(start); } catch (e) { log(`Folder dialog: ${e.message}`, true); }
  }
  const e = exportList();
  $('folderFiles').textContent = `into the folder ${e.folder}: ${e.files.join(' + ')}`;
  $('folderPath').value = start;
  $('folderDlg').classList.remove('hidden');
  $('folderPath').focus();
  return new Promise(res => {
    const done = v => { $('folderDlg').classList.add('hidden'); $('folderOk').onclick = $('folderCancel').onclick = null; res(v); };
    $('folderOk').onclick = () => done($('folderPath').value.trim() || null);
    $('folderCancel').onclick = () => done(null);
    $('folderPath').onkeydown = e => { if (e.key === 'Enter') done($('folderPath').value.trim() || null); if (e.key === 'Escape') done(null); };
  });
}

function settingsList() {                   // for the results .txt: bead / layers and every value changed from the defaults
  const p = state.params[state.machine], out = [['Nozzle / bead width', `${p.nozzle} mm`], ['Layer height', `${p.layer_height} mm`],
    ['First layer height', `${p.first_layer_height} mm`]];
  for (const a of advSpec()) if (advVals()[a.key] !== undefined) out.push([`${a.label} (${a.key})`, `${advVals()[a.key]}${a.unit ? ' ' + a.unit : ''}`]);
  for (const g of CONFIG.general || []) if (gsShown(g)) for (const a of g.fields)
    if ((state.gs || {})[a.key] !== undefined) out.push([`${a.label} (${a.key})`, `${gsGet(a)}${a.unit ? ' ' + a.unit : ''}`]);
  return out;
}
async function exportFiles() {
  if (!sliced) return;
  if (stale && sliced.kind === 'slice') { log('Slice again first: the plate or the settings changed.', true); return; }
  const p = state.params[state.machine];
  const name = state.out_name || defaultName();
  const folder = await chooseFolder(name);
  if (!folder) return;
  state.out_dir = folder;
  saveSettings();
  busy(true, `Writing ${state.machine === 'comau' ? 'G-code + PDL' : 'G-code'} for ${MACHINES[state.machine]}…`);
  try {
    const pdl = Object.fromEntries(PDL_EDITABLE.map(k => [k, state.pdl[k]]));
    const body = { machine: state.machine, name, params: p, pdl, out_dir: state.out_dir, gs: gsSend() };
    if (sliced.kind === 'gcode') body.gcode_text = sliced.text;
    else {
      body.slice_id = sliced.slice_id;
      body.results_txt = state.out_results !== false;
      body.changed = settingsList();
      if (state.out_preview && advSpec().length) {
        busy(true, 'Preview image…');
        body.preview_png = await previewPNG();
        body.preview_layer = advLayer;
        if (!body.preview_png) log('No preview image: the toolpath settings preview could not be made (see its message).', true);
        busy(true, `Writing ${state.machine === 'comau' ? 'G-code + PDL' : 'G-code'} for ${MACHINES[state.machine]}…`);
      }
    }
    const r = await api('/api/export', body);
    if (r.log) log(r.log);
    const card = $('exportCard');
    card.classList.remove('hidden');
    if (!r.ok) {
      card.innerHTML = `<h4>Export failed</h4><div class="err"></div><div class="row"><button class="btn small" id="ecClose">Close</button></div>`;
      card.querySelector('.err').textContent = r.error;
      log(`Export failed: ${r.error}`, true);
    } else {
      const sum = (r.rows || []).filter(x => /printing time|wet weight|Maximum part/.test(x[1])).map(x => `${x[1]}: ${x[2]}`).join('\n');
      card.innerHTML = `<h4>Saved for ${MACHINES[state.machine]}</h4>` +
        r.files.map(f => `<div class="f"><code></code><span><a href="#" data-reveal="${encodeURIComponent(f.path)}">Show</a>${desktop() ? '' : ` · <a href="../download?path=${encodeURIComponent(f.path)}">Download</a>`}</span></div>`).join('') +
        `<p class="sum"></p><div class="row"><button class="btn small" id="ecOpen">Open folder</button><button class="btn small" id="ecClose">Close</button></div>`;
      card.querySelectorAll('code').forEach((c, i) => { c.textContent = `${r.files[i].name}  (${(r.files[i].size / 1024).toFixed(0)} kB)`; });
      card.querySelector('.sum').textContent = `${r.out_dir}\n${sum}`;
      $('ecOpen').onclick = () => api('/api/open_folder', { path: r.out_dir });
      card.querySelectorAll('[data-reveal]').forEach(a => a.onclick = e => { e.preventDefault(); api('/api/reveal', { path: decodeURIComponent(a.dataset.reveal) }); });
      log(`Saved ${r.files.map(f => f.name).join(', ')} in ${r.out_dir}`);
    }
    $('ecClose').onclick = () => card.classList.add('hidden');
  } catch (e) {
    log(`Export failed: ${e.message}`, true);
  } finally {
    busy(false);
  }
}

// ------------------------------------------------------------------------------ projects (tabs) and Home
// Every project keeps its own state, objects, slice, preview and undo history. The open one lives in the
// globals above; switching tabs stashes it and restores the other. Projects are saved automatically.
const projects = [];          // open tabs: {id, name, stash, saved}
let current = null;
let homeOpen = false;
let defaults = null;          // settings a new project starts from: the factory settings (+ last export folder)
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
const isBusy = () => !$('busy').classList.contains('hidden');
function b64ToBuf(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

function emptyStash(st) {
  return { state: st, objects: [], registry: new Map(), selected: null, sliced: null, stale: false, solo: false, machineView: 'solid',
    showModel: false, hidden: [], hist: { past: [], future: [], last: null }, mode: 'prepare', layerMax: 1, layer: 1,
    preview: { previewMesh: null, segs: [], segLayer: [], layerEnds: [], layerLast: [] }, anim: { t: 0, keys: null, total: 0 }, cam: null, tMode: 'translate' };
}
function stashCurrent() {
  if (!current) return;
  restorePartial(); animStop();
  current.stash = { state: clone(state), objects: objects.slice(), registry: new Map(registry), selected, sliced, stale, solo, machineView, showModel,
    hidden: [...hidden], hist: { past: hist.past.slice(), future: hist.future.slice(), last: hist.last }, mode,
    layerMax: +$('layerSlider').max, layer: +$('layerSlider').value, preview: { previewMesh, segs, segLayer, layerEnds, layerLast },
    anim: { t: anim.t, keys: anim.keys, total: anim.total }, cam: [camera.position.clone(), orbit.target.clone()], tMode };
  tcontrols.detach();
  objects.forEach(o => objectsRoot.remove(o.group));
  previewRoot.clear();
}
async function applyStash(st) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, st.state);
  if (!state.config) state.config = inferConfig(state);
  applyTheme();
  objects.length = 0; objects.push(...st.objects);
  registry.clear(); st.registry.forEach((v, k) => registry.set(k, v));
  selected = st.selected; sliced = st.sliced; stale = st.stale; solo = st.solo; machineView = st.machineView; showModel = st.showModel;
  hidden.clear(); st.hidden.forEach(h => hidden.add(h));
  hist.past = st.hist.past; hist.future = st.hist.future; hist.last = st.hist.last; hist.restoring = false;
  ({ previewMesh, segs, segLayer, layerEnds, layerLast } = st.preview);
  anim.t = st.anim.t; anim.keys = st.anim.keys; anim.total = st.anim.total; anim.partial = -1;
  objects.forEach(o => { objectsRoot.add(o.group); o.group.visible = isShown(o); });
  if (previewMesh) { previewRoot.add(previewMesh); buildHighlights(); syncHighlights(previewMesh.count); }
  $('layerSlider').max = st.layerMax; $('layerSlider').value = st.layer;
  $('exportCard').classList.add('hidden');
  ['stale', 'nothing', 'reach', 'bed'].forEach(k => setBadge(k, null));
  $('btnExport').disabled = !sliced;
  renderToolpaths(); renderSettings();
  objects.forEach(x => x.mesh.material.emissive.setHex(x === selected ? 0x062a3a : 0x000000));
  tMode = st.tMode || 'translate';
  await buildMachine();
  renderObjectList(); showObjectProps();
  if (st.cam) { camera.position.copy(st.cam[0]); orbit.target.copy(st.cam[1]); orbit.update(); }
  else fitView(objects.length ? 'plate' : 'machine');
  markStale();
  scheduleResults(0);
  if (sliced) updateLegend();
  setTMode(tMode);
  setMode(st.mode);
  if (hist.last == null) hist.last = snapshot();
  updateUndoButtons();
}
function mergeState(st) {                    // a saved project on top of the current defaults (keys added later stay valid)
  const out = defaultsFor(inferConfig(st));
  for (const k of ['machine', 'toolpath', 'out_name', 'out_dir']) if (st[k] != null) out[k] = st[k];
  for (const k of ['params', 'pdl', 'ur5']) if (st[k]) for (const [kk, v] of Object.entries(st[k])) out[k][kk] = typeof v === 'object' && !Array.isArray(v) && v ? { ...out[k][kk], ...v } : v;
  if (st.scene) for (const m of Object.keys(out.scene)) Object.assign(out.scene[m], st.scene[m] || {});
  out.adv = clone(st.adv || {});
  out.gs = clone(st.gs || {});
  if (!st.rel) {                             // before 1.5: changed values were stored in real mm for the nozzle then in use
    const q = (st.params || {})[st.machine || out.machine] || {}, nz = +q.nozzle || gsRef(), lh = +q.layer_height || gsRefL();
    for (const [tp, vals] of Object.entries(out.adv)) {
      const d = CONFIG.toolpaths[tp];
      for (const a of (d && d.advanced) || []) if (a.bead_scaled && typeof vals[a.key] === 'number')
        vals[a.key] /= (nz / (+d.INFILL_WIDTH || 6)) ** a.bead_scaled;
    }
    for (const a of gsFields()) if ((a.bead_scaled || a.layer_scaled) && typeof out.gs[a.key] === 'number')
      out.gs[a.key] /= (nz / gsRef()) ** (a.bead_scaled || 0) * (lh / gsRefL()) ** (a.layer_scaled || 0);
  }
  out.rel = 1;
  if (st.out_results != null) out.out_results = st.out_results;
  if (st.out_preview != null) out.out_preview = st.out_preview;
  if (!st.gs && st.params) {                 // projects before 1.3: one print / travel speed per machine
    const m = st.machine || out.machine, q = st.params[m] || {}, wasp = m === 'wasp';
    const ps = +q.print_speed, ts = +q.travel_speed, d = k => gsDefault(gsFields().find(a => a.key === k));
    if (ps > 0 && Math.abs(ps - (wasp ? d('INFILL_SPEED') : d('COMAU_PRINT_FEED') / 60)) > 1e-6) {
      if (wasp) Object.assign(out.gs, { PERIMETER_SPEED: ps, EXTERNAL_PERIMETER_SPEED: ps, INFILL_SPEED: ps });
      else out.gs.COMAU_PRINT_FEED = ps * 60;
    }
    if (ts > 0 && Math.abs(ts - (wasp ? d('TRAVEL_SPEED') : d('COMAU_TRAVEL_FEED') / 60)) > 1e-6) out.gs[wasp ? 'TRAVEL_SPEED' : 'COMAU_TRAVEL_FEED'] = wasp ? ts : ts * 60;
  }
  for (const m of Object.keys(out.params)) { delete out.params[m].print_speed; delete out.params[m].travel_speed; }
  return out;
}
async function stashFromServer(p) {
  const r = await api('/api/project?id=' + encodeURIComponent(p.id));
  if (!r.ok) throw new Error(r.error);
  const d = r.data, st = emptyStash(mergeState(d.state || {}));
  for (const od of d.objects || []) {
    const o = makeObject(od.name, new STLLoader().parse(b64ToBuf(od.stl)));
    Object.assign(o, { unit: od.unit || 1, rot: od.rot || [0, 0, 0], scale: od.scale || [1, 1, 1], visible: od.visible !== false, stl64: od.stl });
    o.group.position.set(od.x || 0, od.y || 0, 0);
    o.group.scale.setScalar(o.unit);
    applyRotation(o);
    st.objects.push(o); st.registry.set(o.id, o);
  }
  st.solo = !!d.solo;
  st.selected = st.objects[0] || null;
  return st;
}
function projectData() {
  return { v: 1, state: clone(state), solo,
    objects: objects.map(o => ({ name: o.name, unit: o.unit, rot: o.rot, scale: o.scale, x: o.group.position.x, y: o.group.position.y, visible: o.visible,
      stl: o.stl64 || (o.stl64 = stlB64(o.mesh.geometry)) })) };
}
function thumbnail() {
  try {
    const c = document.createElement('canvas'), src = renderer.domElement;
    c.width = 320; c.height = 200;
    const r = Math.max(320 / src.width, 200 / src.height), w = src.width * r, h = src.height * r;
    const g = c.getContext('2d');
    g.fillStyle = '#e9edf0'; g.fillRect(0, 0, 320, 200);
    g.drawImage(src, (320 - w) / 2, (200 - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.75);
  } catch (e) { return null; }
}
let projTimer = null;
function scheduleProjectSave() { clearTimeout(projTimer); projTimer = setTimeout(saveProject, 1200); }
async function saveProject() {
  clearTimeout(projTimer);
  const p = current;
  if (!p || homeOpen || (!p.saved && !objects.length)) return;   // an empty new project is saved once it has an object
  const meta = { name: p.name, config: state.config, machine: MACHINES[state.machine], objects: objects.length, toolpath: state.toolpath, thumb: thumbnail() };
  await api('/api/project_save', { id: p.id, meta, data: projectData() });
  if (!p.saved) { p.saved = true; postSettings(); }
}

function renderTabs() {
  const el = $('ptabs');
  el.innerHTML = '';
  for (const p of projects) {
    const t = document.createElement('div');
    t.className = 'ptab' + (p === current && !homeOpen ? ' active' : '');
    t.title = 'Double-click to rename';
    t.innerHTML = '<span class="nm"></span><span class="m"></span><button class="x" title="Close the tab (the project stays saved)">✕</button>';
    t.querySelector('.nm').textContent = p.name;
    const m = p === current ? state.machine : (p.stash ? p.stash.state.machine : p.machine);
    const cid = p === current ? state.config : (p.stash ? p.stash.state.config : p.config) || 'standard';
    t.dataset.config = cid;
    t.querySelector('.m').textContent = (cid !== 'standard' ? cfgOf(cid).label.toUpperCase() + ' · ' : '') + (m ? { wasp: 'WASP', ur5: 'UR5', comau: 'COMAU' }[m] || m : '');
    t.onclick = () => openTab(p);
    t.ondblclick = () => renameProject(p);
    t.querySelector('.x').onclick = e => { e.stopPropagation(); closeTab(p); };
    el.append(t);
  }
  $('tabHome').classList.toggle('active', homeOpen);
}
async function openTab(p) {
  if (isBusy()) return;
  if (homeOpen) hideHome();
  if (p === current) { renderTabs(); return; }
  if (current) { await saveProject(); stashCurrent(); }
  current = p;
  try {
    const st = p.stash || await stashFromServer(p);
    p.stash = null;
    await applyStash(st);
  } catch (e) {
    log(`Project ${p.name} could not be opened: ${e.message}`, true);
    projects.splice(projects.indexOf(p), 1);
    current = null;
    if (projects.length) return openTab(projects[projects.length - 1]);
    return newProject();
  }
  renderTabs();
  postSettings();
}
function newProject(cid) {                    // cid: configuration; default = the one of the open project
  const c = cfgOf(cid || (current ? state.config : 'standard'));
  const base = c.id === 'standard' ? 'Project' : c.label;
  let n = 1;
  while (projects.some(p => p.name === `${base} ${n}`)) n++;
  const st = defaultsFor(c.id);
  st.out_name = '';
  const p = { id: newId(), name: `${base} ${n}`, config: c.id, stash: emptyStash(st), saved: false };
  projects.push(p);
  return openTab(p);
}
async function closeTab(p) {
  if (isBusy()) return;
  const i = projects.indexOf(p);
  if (p === current) {
    await saveProject();
    stashCurrent();
    current = null;
    projects.splice(i, 1);
    if (projects.length) await openTab(projects[Math.min(i, projects.length - 1)]);
    else await showHome();
  } else projects.splice(i, 1);
  renderTabs();
  postSettings();
}
async function renameProject(p) {
  const name = (window.prompt('Project name', p.name) || '').trim();
  if (!name || name === p.name) return;
  p.name = name;
  renderTabs();
  if (p === current) { if (p.saved || objects.length) saveProject(); }
  else if (p.saved) await api('/api/project_save', { id: p.id, meta: { name } });
}

async function showHome() {
  if (isBusy()) return;
  if (current) await saveProject();
  homeOpen = true;
  document.body.classList.add('home-mode');
  applyTheme(cfgOf('standard'));
  $('home').classList.remove('hidden');
  renderTabs();
  const r = await api('/api/projects');
  const cfgRow = $('homeConfigs');            // one card per configuration mode: start a new project in it
  cfgRow.innerHTML = '';
  for (const c of cfgList()) {
    const k = document.createElement('div');
    k.className = 'ccard';
    k.dataset.config = c.id;
    const pal = (c.theme && c.theme.palette) || ['#0c2340', '#00a6d6', '#ffffff', '#d9dde1', '#6b7580'];
    k.innerHTML = `<div class="pal">${pal.map(h => `<i style="background:${h}"></i>`).join('')}</div><div class="cb"><small></small><b></b><p></p><em></em></div>` +
      `<div class="ac"><button class="btn primary nw">＋ New ${c.id === 'standard' ? '' : c.label + ' '}project</button>${c.code ? '<button class="btn cd">Open code</button>' : ''}</div>`;
    k.querySelector('small').textContent = c.id === 'standard' ? 'STANDARD' : 'PROJECT CONFIGURATION';
    k.querySelector('b').textContent = c.id === 'standard' ? 'LAMA Slicer' : c.title;
    k.querySelector('p').textContent = c.description || '';
    k.querySelector('em').textContent = 'Toolpaths: ' + cfgToolpaths(c).map(tpTitle).join(' · ');
    k.querySelector('.nw').onclick = () => newProject(c.id);
    if (c.code) k.querySelector('.cd').onclick = () => openCode(c.id);
    cfgRow.append(k);
  }
  const grid = $('homeGrid');
  grid.innerHTML = '';
  for (const m of r.projects || []) {
    const c = document.createElement('div');
    const open = projects.some(p => p.id === m.id);
    c.className = 'pcard';
    const mcfg = cfgOf(inferConfig({ config: m.config, toolpath: m.toolpath }));
    c.dataset.config = mcfg.id;
    c.innerHTML = `<div class="th">${open ? '<span class="open">OPEN</span>' : ''}<span class="cfg">${mcfg.id === 'standard' ? 'LAMA SLICER' : mcfg.label.toUpperCase()}</span></div><div class="bd"><b></b><span></span><span></span></div>` +
      '<div class="ac"><button class="op">Open</button><button class="rn">Rename</button><button class="del">Delete</button></div>';
    if (m.thumb) c.querySelector('.th').style.backgroundImage = `url(${m.thumb})`;
    c.querySelector('b').textContent = m.name || 'Untitled';
    const sp = c.querySelectorAll('.bd span');
    sp[0].textContent = `${m.machine || ''} · ${m.objects || 0} object${m.objects === 1 ? '' : 's'}${m.toolpath ? ' · ' + tpTitle(m.toolpath) : ''}`;
    sp[1].textContent = m.modified ? new Date(m.modified * 1000).toLocaleString() : '';
    const openIt = () => {
      let p = projects.find(q => q.id === m.id);
      if (!p) { p = { id: m.id, name: m.name || 'Untitled', config: mcfg.id, machine: Object.keys(MACHINES).find(k => MACHINES[k] === m.machine), stash: null, saved: true }; projects.push(p); }
      openTab(p);
    };
    c.onclick = openIt;
    c.querySelector('.op').onclick = e => { e.stopPropagation(); openIt(); };
    c.querySelector('.rn').onclick = async e => {
      e.stopPropagation();
      const name = (window.prompt('Project name', m.name) || '').trim();
      if (!name) return;
      const p = projects.find(q => q.id === m.id);
      if (p) p.name = name;
      await api('/api/project_save', { id: m.id, meta: { name } });
      showHome();
    };
    c.querySelector('.del').onclick = async e => {
      e.stopPropagation();
      if (!window.confirm(`Delete the project "${m.name}"? This cannot be undone.`)) return;
      const p = projects.find(q => q.id === m.id);
      if (p) { if (p === current) { stashCurrent(); current = null; } projects.splice(projects.indexOf(p), 1); }
      await api('/api/project_delete', { id: m.id });
      postSettings();
      showHome();
    };
    grid.append(c);
  }
  if (!(r.projects || []).length) {
    const e = document.createElement('p');
    e.className = 'empty';
    e.textContent = 'No saved projects yet: a project is saved as soon as it has an object on its plate.';
    grid.append(e);
  }
}
function openCode(cid) {
  return api('/api/open_code', { config: cid }).then(r => { if (!r.ok) log(r.error, true); else log(`Opened the code folder of ${cfgOf(cid).title}`); });
}
function hideHome() {
  homeOpen = false;
  if (current) applyTheme();
  document.body.classList.remove('home-mode');
  $('home').classList.add('hidden');
  renderTabs();
}

// ------------------------------------------------------------------------------ camera
function fitView(kind) {
  rhinoViewMode = (kind === 'top' || kind === 'front') ? 'parallel' : 'perspective';
  const pw = new THREE.Vector3().setFromMatrixPosition(plate.matrix);
  let h = 300;
  for (const o of objects) h = Math.max(h, o.size[2]);
  let target, dist, dir;
  if (kind === 'machine' || kind === 'iso') {
    const box = new THREE.Box3().setFromObject(machineRoot).expandByPoint(pw);
    box.min.z = Math.max(box.min.z, pw.z - 300);         // ignore the table legs / printer base below the plate
    target = box.getCenter(new THREE.Vector3());
    dist = box.getSize(new THREE.Vector3()).length() * (kind === 'iso' ? 1.35 : 1.3);
    dir = kind === 'iso' ? new THREE.Vector3(1, -1, 0.8) : new THREE.Vector3(0.9, -1.25, 0.7);
  } else if (kind === 'top') { target = pw.clone(); dir = new THREE.Vector3(0, -0.001, 1); dist = Math.max(1100, h * 5); }
  else if (kind === 'front') { target = pw.clone().add(new THREE.Vector3(0, 0, h / 2)); dir = new THREE.Vector3(0, -1, 0.12); dist = Math.max(1100, h * 5); }
  else { target = pw.clone().add(new THREE.Vector3(0, 0, h / 2)); dist = Math.max(900, h * 4.2); dir = new THREE.Vector3(0.75, -1.1, 0.85); }
  orbit.target.copy(target);
  camera.position.copy(target).add(dir.normalize().multiplyScalar(dist));
  orbit.update();
}

// ------------------------------------------------------------------------------ main
function resize() {
  const r = vp.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);

function animate(now) {
  requestAnimationFrame(animate);
  animTick(now);
  orbit.update();
  renderer.render(scene, camera);
}

function splash(text, done = false) {        // loading screen (in index.html) until the app is ready
  const el = document.getElementById('splash');
  if (!el) return;
  el.querySelector('.st').textContent = text;
  if (done) { el.classList.add('done'); setTimeout(() => el.remove(), 600); }
}

async function init() {
  splash('Starting the slicer engine');
  CONFIG = await api('/api/config');
  state.pdl = { ...CONFIG.pdl, placement: 'keep' };
  for (const m of Object.keys(MACHINES)) state.params[m] = defaultParams(m);
  state.out_dir = CONFIG.out_dir;
  state.ur5.tcp = [-495.07, 0.01, -40.33, 0, -93.35, 0];     // TCP of the station extruder (ur5_station model)
  const factory = clone(state);               // every new project starts from these known-good settings
  splash('Loading settings');
  const saved = CONFIG.saved;
  if (saved) {
    for (const k of ['machine', 'toolpath', 'out_name', 'out_dir']) if (saved[k] != null) state[k] = saved[k];
    if (saved.pdl) for (const k of PDL_EDITABLE) if (saved.pdl[k] != null) state.pdl[k] = saved.pdl[k];
    if (saved.params) for (const m of Object.keys(MACHINES)) Object.assign(state.params[m], saved.params[m] || {});
    if (saved.ur5 && saved.v === SETTINGS_VERSION) Object.assign(state.ur5, saved.ur5);   // older versions had a placeholder tool
    if (saved.scene) for (const m of ['comau', 'ur5']) {
      const sc = { ...(saved.scene[m] || {}) };
      if (sc.base && sc.base.length < 5) delete sc.base;        // older versions: base plate without offset
      Object.assign(state.scene[m], sc);
    }
  }
  defaults = clone(factory);
  defaults.out_dir = state.out_dir;            // only the export folder carries over to a new project
  renderToolpaths();
  bindSettings();
  bindAdvanced();
  bindObjects();
  bindPlayer();
  renderSettings();
  setTMode('translate');
  resize();
  requestAnimationFrame(animate);
  $('tabHome').onclick = () => showHome();
  $('btnNewProject').onclick = () => newProject();
  $('btnCode').onclick = () => openCode(state.config);
  // reopen the tabs of the last session, or start with a new project
  const sess = saved && saved.session;
  if (sess && sess.open && sess.open.length) {
    splash('Opening your projects');
    const list = (await api('/api/projects')).projects || [];
    for (const id of sess.open) {
      const m = list.find(x => x.id === id);
      if (m) projects.push({ id, name: m.name || 'Untitled', config: inferConfig({ config: m.config, toolpath: m.toolpath }), machine: Object.keys(MACHINES).find(k => MACHINES[k] === m.machine), stash: null, saved: true });
    }
  }
  splash(`Loading the ${MACHINES[state.machine]} model`);
  if (projects.length) await openTab(projects.find(p => p.id === sess.active) || projects[0]);
  else await newProject();
  splash('Ready', true);

  $('tabPrepare').onclick = () => setMode('prepare');
  $('tabPreview').onclick = () => setMode('preview');
  $('btnSlice').onclick = slicePlate;
  $('btnExport').onclick = exportFiles;
  $('btnImportGcode').onclick = () => $('gcodeInput').click();
  $('gcodeInput').onchange = e => { if (e.target.files[0]) importGcode(e.target.files[0]); e.target.value = ''; };
  $('btnClearImport').onclick = () => {
    animReset();
    sliced = null; previewRoot.clear(); previewMesh = null; $('btnExport').disabled = true;
    renderSettings(); setMode('prepare'); log('Imported G-code removed');
  };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => fitView(b.dataset.view));
  $('logToggle').onclick = () => setLogView($('logBox').classList.contains('open') ? null : 'log');
  $('resToggle').onclick = () => setLogView($('logBox').classList.contains('res') ? null : 'res');
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('soloBox').onchange = e => { solo = e.target.checked; applyObjectVisibility(); commit(); };
  if (hist.last == null) hist.last = snapshot();
  updateUndoButtons();
  window.addEventListener('beforeunload', () => { saveProject(); });
  log('LAMA Slicer ready. Add a part (STL / OBJ / 3MF), pick the machine and toolpath, then Slice plate.');
  window.LAMA = { configs: () => CONFIG.configs, applyTheme, get results() { return results; }, previewPNG, setLogView, state, objects, undo, redo, projects, newProject, openTab, closeTab, showHome, get current() { return current; }, get solo() { return solo; }, loadFiles, slicePlate, exportFiles, setMode, fitView, importGcode, setPreviewLayer, setRot, anim, hl, buildHighlights, animRender, animToggle, get sliced() { return sliced; } };
}
init().catch(e => {
  const el = document.getElementById('splash');
  if (el) { el.classList.add('err'); el.querySelector('.ld').textContent = 'Could not start'; el.querySelector('.st').textContent = e.message; }
  console.error(e);
});
