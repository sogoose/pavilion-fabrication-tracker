// G-code reader for the preview of imported files (G0/G1, absolute/relative XYZ and E, G92, inch/mm).
// Extruding moves are grouped into layers by Z; consecutive extruding moves form one path.
export function parseGcode(text) {
  let x = null, y = null, z = 0, e = 0;
  let absXYZ = true, absE = true, scale = 1;
  const byZ = new Map();
  let path = null, moves = 0, zMoves = 0;
  const notes = [];
  const word = /([A-Z])\s*([-+]?\d*\.?\d+)/g;
  for (const raw of text.split(/\r?\n/)) {
    const code = raw.split(';')[0].split('(')[0].trim().toUpperCase();
    if (!code) continue;
    const w = {};
    let m;
    word.lastIndex = 0;
    while ((m = word.exec(code))) if (!(m[1] in w)) w[m[1]] = parseFloat(m[2]);
    const g = w.G, mc = w.M;
    if (mc === 82) absE = true;
    if (mc === 83) absE = false;
    if (g === 20) scale = 25.4;
    if (g === 21) scale = 1;
    if (g === 90) absXYZ = true;
    if (g === 91) absXYZ = false;
    if (g === 92) { if ('E' in w) e = w.E; continue; }
    if (g !== 0 && g !== 1) continue;
    const nx = 'X' in w ? (absXYZ || x === null ? w.X * scale : x + w.X * scale) : x;
    const ny = 'Y' in w ? (absXYZ || y === null ? w.Y * scale : y + w.Y * scale) : y;
    const nz = 'Z' in w ? (absXYZ ? w.Z * scale : z + w.Z * scale) : z;
    let ext = false;
    if ('E' in w) {
      const ne = absE ? w.E : e + w.E;
      ext = g === 1 && ne > e + 1e-9;
      e = ne;
    }
    const moved = nx !== x || ny !== y || nz !== z;
    if (ext && moved && x !== null && y !== null) {
      if (nz !== z) zMoves++;
      const key = Math.round(nz * 1000) / 1000;
      if (!byZ.has(key)) byZ.set(key, []);
      const list = byZ.get(key);
      if (!path || path.z !== key || path.end[0] !== x || path.end[1] !== y) {
        path = { z: key, pts: [[x, y]], end: [x, y] };
        list.push(path);
      }
      path.pts.push([nx, ny]);
      path.end = [nx, ny];
      moves++;
    } else if (moved) {
      path = null;
    }
    x = nx; y = ny; z = nz;
  }
  const zs = [...byZ.keys()].sort((a, b) => a - b);
  let prev = 0;
  const layers = zs.map((zz, i) => {
    const h = Math.max(0.2, zz - prev);
    prev = zz;
    return {
      index: i, z: zz, height: h,
      paths: byZ.get(zz).map(p => ({ type: 'custom', closed: false, pts: p.pts })),
    };
  });
  if (zMoves > moves * 0.3) notes.push('many extruding moves change Z (non-planar / spiral): shown grouped by Z');
  return { layers, moves, notes };
}
