import * as THREE from 'three'
import { sampleStations } from '../sim/build'
import type { ChassisProfile } from '../sim/types'
import type { TrackGeometry } from '../sim/track'

/**
 * Mesh builders. The chassis mesh is lofted from the exact same station samples the
 * mass integrator uses, so the car you look at is the car that races -- carve the
 * nose down and both the silhouette and the centre of mass move together.
 */

type Face = 'right' | 'left' | 'cap' | 'deck'

/**
 * UV bands inside the livery texture. The two flanks get their own band because a
 * car is yawed a half turn to face down-track: sharing one band makes the race
 * number read mirrored on whichever side the cameras are on. The second band holds
 * the same artwork pre-mirrored. The top and bottom sample a plain strip so nothing
 * is smeared across the deck.
 */
export const UV_RIGHT_BASE = 0
export const UV_LEFT_BASE = 0.44
export const UV_FLANK_BAND = 0.42
const UV_PLAIN = 0.95

class MeshBuilder {
  positions: number[] = []
  uvs: number[] = []

  private pushVertex(v: THREE.Vector3, u: number, w: number) {
    this.positions.push(v.x, v.y, v.z)
    this.uvs.push(u, w)
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv: number[][]) {
    this.pushVertex(a, uv[0][0], uv[0][1])
    this.pushVertex(b, uv[1][0], uv[1][1])
    this.pushVertex(c, uv[2][0], uv[2][1])
    this.pushVertex(a, uv[0][0], uv[0][1])
    this.pushVertex(c, uv[2][0], uv[2][1])
    this.pushVertex(d, uv[3][0], uv[3][1])
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return geometry
  }
}

const uvFor = (face: Face, u: number, heightFraction: number): [number, number] => {
  if (face === 'left') return [u, UV_LEFT_BASE + heightFraction * UV_FLANK_BAND]
  if (face === 'right' || face === 'cap') return [u, UV_RIGHT_BASE + heightFraction * UV_FLANK_BAND]
  return [u, UV_PLAIN]
}

/**
 * Lofts the chassis from its two profile curves. Local space: x runs from the nose
 * at 0 to the tail, y is up from the underside, z is lateral.
 */
export function buildChassisGeometry(profile: ChassisProfile, stationCount = 56): THREE.BufferGeometry {
  const stations = sampleStations(profile, stationCount)
  const builder = new MeshBuilder()
  const length = stations[stations.length - 1].x || 1
  const maxHeight = Math.max(...stations.map((s) => s.top), 0.001)

  const corner = (i: number, which: 0 | 1 | 2 | 3) => {
    const st = stations[i]
    const hw = Math.max(st.halfWidth, 0.00001)
    switch (which) {
      case 0:
        return new THREE.Vector3(st.x, st.bottom, -hw)
      case 1:
        return new THREE.Vector3(st.x, st.bottom, hw)
      case 2:
        return new THREE.Vector3(st.x, st.top, hw)
      default:
        return new THREE.Vector3(st.x, st.top, -hw)
    }
  }

  for (let i = 0; i < stations.length - 1; i++) {
    const u0 = stations[i].x / length
    const u1 = stations[i + 1].x / length
    const h0b = stations[i].bottom / maxHeight
    const h0t = stations[i].top / maxHeight
    const h1b = stations[i + 1].bottom / maxHeight
    const h1t = stations[i + 1].top / maxHeight

    // Right flank (local +Z, which faces away from the trackside cameras)
    builder.quad(corner(i, 1), corner(i + 1, 1), corner(i + 1, 2), corner(i, 2), [
      uvFor('right', u0, h0b),
      uvFor('right', u1, h1b),
      uvFor('right', u1, h1t),
      uvFor('right', u0, h0t),
    ])
    // Left flank (local -Z, the side the trackside cameras actually see)
    builder.quad(corner(i + 1, 0), corner(i, 0), corner(i, 3), corner(i + 1, 3), [
      uvFor('left', u1, h1b),
      uvFor('left', u0, h0b),
      uvFor('left', u0, h0t),
      uvFor('left', u1, h1t),
    ])
    // Deck
    builder.quad(corner(i, 3), corner(i, 2), corner(i + 1, 2), corner(i + 1, 3), [
      uvFor('deck', u0, 1),
      uvFor('deck', u0, 1),
      uvFor('deck', u1, 1),
      uvFor('deck', u1, 1),
    ])
    // Underside
    builder.quad(corner(i + 1, 0), corner(i + 1, 1), corner(i, 1), corner(i, 0), [
      uvFor('deck', u1, 0),
      uvFor('deck', u1, 0),
      uvFor('deck', u0, 0),
      uvFor('deck', u0, 0),
    ])
  }

  // End caps.
  const first = 0
  const last = stations.length - 1
  builder.quad(corner(first, 0), corner(first, 1), corner(first, 2), corner(first, 3), [
    uvFor('cap', 0, 0),
    uvFor('cap', 0, 0),
    uvFor('cap', 0, 1),
    uvFor('cap', 0, 1),
  ])
  builder.quad(corner(last, 1), corner(last, 0), corner(last, 3), corner(last, 2), [
    uvFor('cap', 1, 0),
    uvFor('cap', 1, 0),
    uvFor('cap', 1, 1),
    uvFor('cap', 1, 1),
  ])

  return builder.toGeometry()
}

/** A point on an extrusion cross-section: `z` is lateral, `n` is along the surface normal. */
export interface CrossSectionPoint {
  z: number
  n: number
}

/**
 * Sweeps a closed cross-section along the track path. Everything on the track --
 * the deck, the guide rails, the side skirts -- is one of these, which keeps the
 * visible track glued to the same curve the physics integrates along.
 */
export function extrudeAlongTrack(
  geometry: TrackGeometry,
  section: CrossSectionPoint[],
  sStart: number,
  sEnd: number,
  step = 0.08,
): THREE.BufferGeometry {
  const builder = new MeshBuilder()
  const samples: number[] = []
  for (let s = sStart; s < sEnd; s += step) samples.push(s)
  samples.push(sEnd)

  const pointAt = (s: number, p: CrossSectionPoint) => {
    const base = geometry.pointAt(s)
    const slope = geometry.slopeAt(s)
    // Surface normal for a path descending in +x.
    const nx = Math.sin(slope)
    const ny = Math.cos(slope)
    return new THREE.Vector3(base.x + nx * p.n, base.y + ny * p.n, p.z)
  }

  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i]
    const s1 = samples[i + 1]
    const u0 = (s0 - sStart) / Math.max(0.001, sEnd - sStart)
    const u1 = (s1 - sStart) / Math.max(0.001, sEnd - sStart)
    for (let j = 0; j < section.length; j++) {
      const a = section[j]
      const b = section[(j + 1) % section.length]
      const v0 = j / section.length
      const v1 = (j + 1) / section.length
      builder.quad(pointAt(s0, a), pointAt(s1, a), pointAt(s1, b), pointAt(s0, b), [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ])
    }
  }

  // Caps so the ends are not hollow when seen from the gate cam.
  const capAt = (s: number, flip: boolean) => {
    const centre = section.reduce(
      (acc, p) => ({ z: acc.z + p.z / section.length, n: acc.n + p.n / section.length }),
      { z: 0, n: 0 },
    )
    const c = pointAt(s, centre)
    for (let j = 0; j < section.length; j++) {
      const a = pointAt(s, section[j])
      const b = pointAt(s, section[(j + 1) % section.length])
      const tri = flip ? [c, b, a] : [c, a, b]
      builder.quad(tri[0], tri[1], tri[2], tri[2], [
        [0.5, 0.5],
        [0, 0],
        [1, 0],
        [1, 0],
      ])
    }
  }
  capAt(sStart, true)
  capAt(sEnd, false)

  return builder.toGeometry()
}

/** Rectangular cross-section helper, centred on `z` and sitting `n0..n1` off the surface. */
export const rectSection = (zCentre: number, width: number, n0: number, n1: number): CrossSectionPoint[] => [
  { z: zCentre - width / 2, n: n0 },
  { z: zCentre + width / 2, n: n0 },
  { z: zCentre + width / 2, n: n1 },
  { z: zCentre - width / 2, n: n1 },
]
