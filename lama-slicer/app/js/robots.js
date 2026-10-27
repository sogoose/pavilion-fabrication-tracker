// LAMA Slicer - simplified machine models (preview only, approximate dimensions).
// Serial arms use standard Denavit-Hartenberg parameters (mm, deg) and a numeric IK
// so the nozzle (TCP) can be placed on the plate; later this drives the simulation.
import * as THREE from 'three';

const D2R = Math.PI / 180;

export function zyz(e1, e2, e3) {          // Comau POS orientation: Rz(e1) Ry(e2) Rz(e3)
  const m = new THREE.Matrix4().makeRotationZ(e1 * D2R);
  m.multiply(new THREE.Matrix4().makeRotationY(e2 * D2R));
  m.multiply(new THREE.Matrix4().makeRotationZ(e3 * D2R));
  return m;
}
export function frameMatrix(v) {           // [x, y, z, e1, e2, e3]  ->  Matrix4
  const m = zyz(v[3] || 0, v[4] || 0, v[5] || 0);
  m.setPosition(v[0] || 0, v[1] || 0, v[2] || 0);
  return m;
}

function staticDH(d, a, alpha) {
  return new THREE.Matrix4().makeTranslation(0, 0, d)
    .multiply(new THREE.Matrix4().makeTranslation(a, 0, 0))
    .multiply(new THREE.Matrix4().makeRotationX(alpha * D2R));
}

function mat(color, metal = 0.25, rough = 0.55) {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
}

// cylinder between two points (in the parent's frame)
function rod(p, q, r, material, sides = 24) {
  const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, Math.max(len, 1e-3), sides);
  const m = new THREE.Mesh(g, material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}
function housing(r, h, material, z = 0) {      // joint housing along the local z axis
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), material);
  m.rotation.x = Math.PI / 2;
  m.position.z = z;
  m.castShadow = true;
  return m;
}

// --------------------------------------------------------------------------- 6-axis arm
export class SerialArm {
  constructor(spec) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = spec.name;
    this.q = spec.seed.map(v => v * D2R);
    this.statics = spec.dh.map(j => staticDH(j.d, j.a, j.alpha));
    this.offsets = spec.dh.map(j => (j.offset || 0) * D2R);
    this.limits = spec.dh.map(j => [j.min * D2R, j.max * D2R]);
    this.jointGroups = [];
    const cMain = mat(spec.color), cDark = mat(spec.dark, 0.3, 0.6), cMetal = mat(0x9aa0a6, 0.7, 0.35);
    spec.buildBase(this.root, cMain, cDark);
    let parent = this.root;
    spec.dh.forEach((j, i) => {
      const jg = new THREE.Group();
      parent.add(jg);
      spec.buildLink(i, j, jg, cMain, cDark, cMetal);
      const sg = new THREE.Group();
      sg.matrixAutoUpdate = false;
      sg.matrix.copy(this.statics[i]);
      jg.add(sg);
      this.jointGroups.push(jg);
      parent = sg;
    });
    this.flange = parent;
    this.toolGroup = new THREE.Group();
    this.flange.add(this.toolGroup);
    this.toolMatrix = new THREE.Matrix4();
    this.setQ(this.q);
  }

  setTool(tcp, buildTool) {                  // tcp = [x, y, z, e1, e2, e3] on the flange
    this.toolMatrix = frameMatrix(tcp);
    this.toolGroup.clear();
    buildTool(this.toolGroup, tcp);
  }

  setQ(q) {
    this.q = q.slice();
    q.forEach((v, i) => { this.jointGroups[i].rotation.z = v + this.offsets[i]; });
  }

  fk(q) {                                    // TCP in the robot base frame
    const m = new THREE.Matrix4(), r = new THREE.Matrix4();
    for (let i = 0; i < q.length; i++) {
      m.multiply(r.makeRotationZ(q[i] + this.offsets[i])).multiply(this.statics[i]);
    }
    return m.multiply(this.toolMatrix);
  }

  // damped least squares on position + orientation; target in the robot base frame
  solve(target, seeds) {
    const tp = new THREE.Vector3().setFromMatrixPosition(target);
    const tq = new THREE.Quaternion().setFromRotationMatrix(target);
    const W = 400;                           // mm per radian of orientation error
    const err = (q) => {
      const F = this.fk(q);
      const p = new THREE.Vector3().setFromMatrixPosition(F);
      const fq = new THREE.Quaternion().setFromRotationMatrix(F);
      const d = tq.clone().multiply(fq.invert());
      if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
      const s = Math.sqrt(1 - Math.min(1, d.w * d.w));
      const ang = 2 * Math.acos(Math.min(1, d.w));
      const ax = s < 1e-9 ? [0, 0, 0] : [d.x / s * ang, d.y / s * ang, d.z / s * ang];
      return [tp.x - p.x, tp.y - p.y, tp.z - p.z, ax[0] * W, ax[1] * W, ax[2] * W];
    };
    const norm = e => Math.hypot(...e);
    let best = null;
    for (const seed of [this.q, ...seeds.map(s => s.map(v => v * D2R))]) {
      let q = seed.slice(), e = err(q), lam = 20;
      for (let it = 0; it < 160 && norm(e) > 0.05; it++) {
        const J = [];
        for (let j = 0; j < 6; j++) {
          const q2 = q.slice(); q2[j] += 1e-4;
          const e2 = err(q2);
          J.push(e.map((v, k) => (v - e2[k]) / 1e-4));   // column j (d position / d q)
        }
        // dq = J^T (J J^T + lam^2 I)^-1 e
        const A = [...Array(6)].map((_, r) => [...Array(6)].map((_, c) => {
          let s = 0; for (let k = 0; k < 6; k++) s += J[k][r] * J[k][c];
          return s + (r === c ? lam * lam : 0);
        }));
        const y = gauss(A, e.slice());
        if (!y) break;
        let dq = [...Array(6)].map((_, k) => J[k].reduce((s, v, r) => s + v * y[r], 0));
        const mx = Math.max(...dq.map(Math.abs));
        if (mx > 0.25) dq = dq.map(v => v * 0.25 / mx);
        const qn = q.map((v, k) => Math.min(this.limits[k][1], Math.max(this.limits[k][0], v + dq[k])));
        const en = err(qn);
        if (norm(en) < norm(e)) { q = qn; e = en; lam = Math.max(lam * 0.6, 0.5); }
        else lam = Math.min(lam * 3, 5000);
      }
      const pe = Math.hypot(e[0], e[1], e[2]), re = Math.hypot(e[3], e[4], e[5]) / W / D2R;
      if (!best || pe + re < best.pe + best.re) best = { q, pe, re };
      if (pe < 0.5 && re < 0.5) break;
    }
    this.setQ(best.q);
    return { ok: best.pe < 1 && best.re < 1, posErr: best.pe, rotErr: best.re };
  }
}

// --------------------------------------------------------------------------- robot from a RoboDK file (modified DH)
// joint i: Rx(alpha) Tx(a) Rz(theta + sense * q) Tz(d); body i+1 is drawn in the frame after joint i.
// q are the controller joint values (Comau J1..J6), so the PDL home pose can be used directly.
export const COMAU_PAINT = { paint: 0xd2381e };
export const UR_COLOURS = {};
export class ModelArm {
  constructor(model, colours = COMAU_PAINT) {
    const M = model.meta;
    this.root = new THREE.Group();
    this.pre = M.dhm.map(([al, a]) => new THREE.Matrix4().makeRotationX(al).multiply(new THREE.Matrix4().makeTranslation(a, 0, 0)));
    this.post = M.dhm.map(([, , , d]) => new THREE.Matrix4().makeTranslation(0, 0, d));
    this.theta = M.dhm.map(r => r[2]);
    this.sense = M.sense;
    this.limits = M.lo.map((lo, i) => [lo * D2R, M.hi[i] * D2R]);
    const mats = {};
    const matFor = role => {              // 'paint' = robot body colour; 'cRRGGBB' = colour from the RoboDK file
      if (!mats[role]) {
        const c = colours[role] ?? (role.startsWith('c') ? parseInt(role.slice(1), 16) : 0x888888);
        mats[role] = new THREE.MeshStandardMaterial({ color: c, roughness: role === 'paint' ? 0.45 : 0.55, metalness: 0.15, flatShading: true });
      }
      return mats[role];
    };
    const bodyMeshes = b => Object.entries(model.parts).filter(([n]) => n.startsWith(`b${b}_`)).map(([n, g]) => {
      const m = new THREE.Mesh(g, matFor(n.split('_')[1]));
      m.castShadow = true; m.receiveShadow = true;
      return m;
    });
    bodyMeshes(0).forEach(m => this.root.add(m));
    this.jointGroups = [];
    let parent = this.root;
    M.dhm.forEach((_, i) => {
      const pre = new THREE.Group(); pre.matrixAutoUpdate = false; pre.matrix.copy(this.pre[i]);
      const jg = new THREE.Group();
      const post = new THREE.Group(); post.matrixAutoUpdate = false; post.matrix.copy(this.post[i]);
      parent.add(pre); pre.add(jg); jg.add(post);
      bodyMeshes(i + 1).forEach(m => post.add(m));
      this.jointGroups.push(jg);
      parent = post;
    });
    this.flange = parent;
    this.toolGroup = new THREE.Group();
    this.flange.add(this.toolGroup);
    this.toolMatrix = new THREE.Matrix4();
    this.setQ(M.dhm.map(() => 0));
  }
  setTool(tcp, buildTool) { this.toolMatrix = frameMatrix(tcp); this.toolGroup.clear(); buildTool(this.toolGroup, tcp); }
  setQ(q) {
    this.q = q.slice();
    q.forEach((v, i) => { this.jointGroups[i].rotation.z = this.theta[i] + this.sense[i] * v; });
  }
  fk(q) {
    const m = new THREE.Matrix4(), r = new THREE.Matrix4();
    for (let i = 0; i < q.length; i++) m.multiply(this.pre[i]).multiply(r.makeRotationZ(this.theta[i] + this.sense[i] * q[i])).multiply(this.post[i]);
    return m.multiply(this.toolMatrix);
  }
  jointsDeg() { return this.q.map(v => v / D2R); }
}
ModelArm.prototype.solve = SerialArm.prototype.solve;

function gauss(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// --------------------------------------------------------------------------- Comau NJ 60-2.2
// approximate: reach ~2.26 m, shoulder 830 mm high with 350 mm offset
export const COMAU_SPEC = {
  name: 'Comau NJ60-2.2', color: 0xd8442a, dark: 0x2a2a2a,
  dh: [
    { d: 830, a: 350, alpha: -90, min: -180, max: 180 },
    { d: 0, a: 1000, alpha: 0, offset: -90, min: -100, max: 100 },
    { d: 0, a: 175, alpha: -90, min: -180, max: 180 },
    { d: 900, a: 0, alpha: 90, min: -360, max: 360 },
    { d: 0, a: 0, alpha: -90, min: -130, max: 130 },
    { d: 160, a: 0, alpha: 0, min: -360, max: 360 },
  ],
  seed: [25, 20, 45, 30, -75, 180],
  seeds: [[25, 20, 45, 30, -75, 180], [25, 0, 30, -150, 75, 0], [0, 40, 60, 30, -75, 180], [-25, 20, 45, 30, -75, 180]],
  buildBase(root, c, dark) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1100, 1100, 30), mat(0x34373b, 0.4, 0.7));
    plate.position.z = 15; plate.receiveShadow = true; root.add(plate);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(330, 380, 260, 40), c);
    base.rotation.x = Math.PI / 2; base.position.z = 160; base.castShadow = true; root.add(base);
  },
  buildLink(i, j, g, c, dark, metal) {
    if (i === 0) {           // turret: column + shoulder housing
      g.add(rod([0, 0, 280], [0, 0, 620], 260, c, 32));
      g.add(rod([0, 0, 600], [j.a, 0, j.d], 170, c));
      const sh = housing(190, 340, dark); sh.rotation.x = 0; sh.position.set(j.a, -60, j.d); sh.rotation.x = Math.PI / 2;
      g.add(sh);
      const motor = new THREE.Mesh(new THREE.BoxGeometry(230, 230, 300), dark);
      motor.position.set(-120, 220, 520); g.add(motor);
    } else if (i === 1) {    // upper arm
      g.add(housing(185, 300, c, 60));
      g.add(rod([0, 0, 60], [j.a, 0, 60], 125, c));
      g.add(housing(165, 280, c, 60).translateX(0)); // shoulder cap
      const elbow = housing(160, 300, c, 60); elbow.position.x = j.a; g.add(elbow);
    } else if (i === 2) {    // elbow + forearm start
      g.add(rod([0, 0, 0], [j.a, 0, 0], 150, c));
      const m = new THREE.Mesh(new THREE.BoxGeometry(260, 260, 360), dark); m.position.set(-120, 0, 0); g.add(m);
    } else if (i === 3) {    // forearm
      g.add(rod([0, 0, 0], [0, 0, j.d - 110], 120, c));
      g.add(rod([0, 0, 0], [0, 0, 260], 145, c));
    } else if (i === 4) {    // wrist
      g.add(housing(95, 220, c));
    } else if (i === 5) {    // flange
      g.add(rod([0, 0, 0], [0, 0, j.d], 80, c));
      g.add(rod([0, 0, j.d - 12], [0, 0, j.d], 95, metal));
    }
  },
};

// --------------------------------------------------------------------------- UR5 (standard DH)
export const UR5_SPEC = {
  name: 'UR5', color: 0xd9dde2, dark: 0x3b7bbd,
  dh: [
    { d: 89.159, a: 0, alpha: 90, min: -360, max: 360 },
    { d: 0, a: -425, alpha: 0, min: -360, max: 360 },
    { d: 0, a: -392.25, alpha: 0, min: -360, max: 360 },
    { d: 109.15, a: 0, alpha: 90, min: -360, max: 360 },
    { d: 94.65, a: 0, alpha: -90, min: -360, max: 360 },
    { d: 82.3, a: 0, alpha: 0, min: -360, max: 360 },
  ],
  seed: [0, -100, 100, -90, -90, 0],
  seeds: [[0, -100, 100, -90, -90, 0], [180, -80, -100, -90, 90, 0], [0, -60, 90, -120, -90, 0]],
  buildBase(root, c, dark) {
    root.add(rod([0, 0, 0], [0, 0, 60], 75, c));
    root.add(rod([0, 0, 0], [0, 0, 8], 90, mat(0x888c90, 0.6, 0.4)));
  },
  buildLink(i, j, g, c, dark, metal) {
    const cap = (z) => { const h = housing(46, 20, dark, z); return h; };
    if (i === 0) { g.add(rod([0, 0, 50], [0, 0, j.d + 40], 60, c)); }
    if (i === 1) { g.add(housing(62, 140, c, 0)); g.add(rod([0, 0, 135], [j.a, 0, 135], 45, c)); g.add(housing(55, 120, c, 135).translateX(j.a)); }
    if (i === 2) { g.add(rod([0, 0, 15], [j.a, 0, 15], 38, c)); g.add(housing(46, 100, c, 15).translateX(j.a)); }
    if (i === 3) { g.add(rod([0, 0, 0], [0, 0, j.d], 42, c)); g.add(cap(j.d - 10)); }
    if (i === 4) { g.add(rod([0, 0, 0], [0, 0, j.d], 42, c)); }
    if (i === 5) { g.add(rod([0, 0, 0], [0, 0, j.d], 40, c)); g.add(rod([0, 0, j.d - 8], [0, 0, j.d], 32, metal)); }
  },
};

// --------------------------------------------------------------------------- tools
// Comau extruder drawn like the WASP one (same module + tank, from wasp.json) so both setups read the same.
// Only the picture: the TCP / data are unchanged. Nozzle tip at the TCP, module along the nozzle axis.
export function moduleExtruder(wasp) {
  return (g, tcp) => {
    const T = frameMatrix(tcp);
    const tip = new THREE.Vector3().setFromMatrixPosition(T);
    const axis = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(T)).normalize();   // clay flows along +axis
    const mod = new THREE.Group();
    mod.position.copy(tip);
    mod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().negate());   // module "up" = against the flow
    const P = wasp.parts;
    mod.add(meshOf(P.mod_alu, MAT.alu()), meshOf(P.eff_blue, mat(0x1f4fc8, 0.25, 0.4)), meshOf(P.tank, MAT.alu()));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(10, 18, 20), MAT.brass());
    cone.rotation.x = -Math.PI / 2; cone.position.z = 9;
    mod.add(cone);
    g.add(mod);
    // bracket from the flange to the module (black, as on the robot)
    const black = mat(0x1d1d1d, 0.1, 0.8);
    g.add(rod([0, 0, 0], [0, 0, 40], 110, black));
    const near = new THREE.Vector3(0, 0, 40);
    const onAxis = tip.clone().addScaledVector(axis, near.clone().sub(tip).dot(axis));
    g.add(rod(near.toArray(), onAxis.toArray(), 50, black, 6));
  };
}

// --------------------------------------------------------------------------- models from the .3dm files
const modelCache = {};
function b64bytes(s) {                         // fast base64 -> bytes (large models)
  const bin = atob(s), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export async function loadModel(name) {
  if (!modelCache[name]) modelCache[name] = fetch(`models/${name}.json`).then(r => r.json()).then(d => {
    const parts = {};
    for (const p of d.parts) {
      const pos = new Float32Array(b64bytes(p.pos).buffer);
      const idx = new Uint32Array(b64bytes(p.idx).buffer);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      parts[p.name] = g;
    }
    return { parts, meta: d.meta };
  });
  return modelCache[name];
}
function meshOf(geom, material) {
  const m = new THREE.Mesh(geom, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export const MAT = {
  white: () => mat(0xf2f2ef, 0.05, 0.55),
  alu: () => mat(0xd3d7db, 0.35, 0.38),            // satin aluminium (no environment map, so low metalness)
  dark: () => mat(0x26292c, 0.35, 0.55),
  blue: () => mat(0x1f4fa0, 0.2, 0.45),
  brass: () => mat(0xb48a4a, 0.75, 0.3),
};

// UR5 extruder from the station file: holder + front piece + tank (flange frame = Ø50 bolt circle),
// auger, nozzle and hose added; the nozzle tip is the TCP point of the file
export function stationExtruder(model) {
  return (g, tcp) => {
    const P = model.parts, M = model.meta;
    g.add(meshOf(P.holder, MAT.white()));
    g.add(meshOf(P.front, MAT.white()));
    g.add(meshOf(P.tank, MAT.alu()));
    const T = frameMatrix(tcp);
    const tip = new THREE.Vector3().setFromMatrixPosition(T);
    const axis = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(T)).normalize();
    const mount = new THREE.Vector3(...M.mount);
    const at = d => mount.clone().addScaledVector(axis, d).toArray();      // along the nozzle axis from the front plate
    const len = tip.distanceTo(mount);
    g.add(rod(at(-45), at(0), 24, MAT.dark(), 20));                          // motor behind the plate
    g.add(rod(at(0), at(len - 50), 21, MAT.blue(), 24));                     // auger body
    g.add(rod(at(len - 50), at(len - 42), 23, MAT.dark(), 24));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(14, 42, 24), MAT.brass());
    cone.position.set(...at(len - 21));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);  // tip towards the print
    g.add(cone);
    const a = new THREE.Vector3(...M.tank_front), b = new THREE.Vector3(...at(-50));
    const hose = new THREE.CatmullRomCurve3([a, a.clone().add(new THREE.Vector3(-60, 0, -5)), b.clone().add(new THREE.Vector3(90, 0, 40)), b]);
    g.add(meshOf(new THREE.TubeGeometry(hose, 40, 10, 12), mat(0xd6dade, 0.6, 0.35)));
  };
}

export function stationTable(model) {
  const g = new THREE.Group();
  g.add(meshOf(model.parts.table, MAT.white()));
  g.add(meshOf(model.parts.legs, MAT.alu()));
  return g;
}

// --------------------------------------------------------------------------- WASP 40100 (delta) from wasp.3dm
export class DeltaPrinter {
  constructor(model) {
    const P = model.parts, M = model.meta;
    this.meta = M;
    this.root = new THREE.Group();
    // factory finish: aluminium columns / arms / tank, white sheet-metal panels, dark print plate, blue extruder
    this.root.add(meshOf(P.columns, MAT.alu()));
    this.root.add(meshOf(P.panels, MAT.white()));
    this.effector = new THREE.Group();
    this.effector.add(meshOf(P.tank, MAT.alu()));            // the tank sits on the extruder module and moves with it
    this.rope = rod([0, 0, 0], [0, 0, 1], 2.5, mat(0xeeeeee, 0, 0.8), 6);   // it hangs on a rope from the top frame
    this.root.add(this.rope);
    this.effector.add(meshOf(P.eff_alu, MAT.alu()));
    this.effector.add(meshOf(P.eff_blue, mat(0x1f4fc8, 0.25, 0.4)));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(10, 18, 20), MAT.brass());
    cone.rotation.x = -Math.PI / 2; cone.position.z = 9;                    // nozzle tip at the origin, pointing down
    this.effector.add(cone);
    this.root.add(this.effector);
    const armMat = MAT.alu(), carMat = MAT.white();
    this.arms = M.arms.map(a => {
      const m = rod([0, 0, 0], [0, 0, 1], 6, armMat, 10);
      const c = new THREE.Mesh(new THREE.BoxGeometry(46, 46, 70), carMat);
      c.castShadow = true;
      this.root.add(m, c);
      return { eff: a.eff, xy: a.car, L: a.L, mesh: m, carMesh: c };
    });
    this.place(new THREE.Vector3(...M.tip_home));
  }
  place(tip) {                               // nozzle tip in the printer frame (bed centre = 0,0,0)
    this.effector.position.copy(tip);
    const top = tip.z + this.meta.tank_top, anchor = this.meta.rope_anchor_z;
    this.rope.visible = anchor - top > 5;
    if (this.rope.visible) {
      this.rope.position.set(tip.x / 2, tip.y / 2, (top + anchor) / 2);
      this.rope.scale.set(1, anchor - top, 1);
      this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-tip.x, -tip.y, anchor - top).normalize());
      this.rope.scale.set(1, Math.hypot(tip.x, tip.y, anchor - top), 1);
    }
    let ok = Math.hypot(tip.x, tip.y) <= this.meta.bed_radius + 1e-6 && tip.z >= -1 && tip.z <= this.meta.build_height;
    for (const a of this.arms) {
      const e = new THREE.Vector3(tip.x + a.eff[0], tip.y + a.eff[1], tip.z + a.eff[2]);
      const h2 = a.L * a.L - ((a.xy[0] - e.x) ** 2 + (a.xy[1] - e.y) ** 2);
      if (h2 <= 0) ok = false;
      const c = new THREE.Vector3(a.xy[0], a.xy[1], e.z + Math.sqrt(Math.max(h2, 0)));
      a.mesh.position.copy(c).add(e).multiplyScalar(0.5);
      a.mesh.scale.set(1, c.distanceTo(e), 1);
      a.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(e).normalize());
      const out = Math.hypot(a.xy[0], a.xy[1]);
      a.carMesh.position.set(a.xy[0] * (out + 18) / out, a.xy[1] * (out + 18) / out, c.z);
    }
    return { ok, posErr: 0, rotErr: 0 };
  }
}
