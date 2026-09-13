import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { placeCar } from '../Car'
import { buildTrackGeometry } from '../../sim/track'
import { cloneProfile, presetById } from '../../sim/presets'
import { DEFAULT_TRACK, STOCK_WHEELBASE, type CarBuild } from '../../sim/types'
import { RULES, WHEEL } from '../../sim/units'
import type { CarFrame } from '../../sim/race'

const build: CarBuild = {
  id: 'placement',
  name: 'Placement',
  tag: 'PL',
  profile: cloneProfile(presetById('wedge').profile),
  woodDensity: 400,
  weights: [],
  wheels: { massEach: WHEEL.stockMass, trueness: 0.9, polish: 0.8, lubrication: 0.8, raisedFrontWheel: false },
  axles: { steerDeg: 0, alignmentErrorDeg: 0, polish: 0.8 },
  wheelbase: { ...STOCK_WHEELBASE },
  paint: { bodyColor: '#f00', accentColor: '#fff', finish: 'gloss', stripe: 'none', number: '1' },
}

const frameAt = (s: number, yaw = 0): CarFrame => ({
  s,
  v: 3,
  y: 0,
  yaw,
  pitch: 0,
  wheelAngle: 0,
  position: 1,
  wheelie: false,
})

const track = buildTrackGeometry(DEFAULT_TRACK)

/** World position of a point in the car's local space, after placement. */
function worldPoint(object: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyEuler(object.rotation).add(object.position)
}

describe('car placement', () => {
  it('puts the nose ahead of the tail, down-track', () => {
    const object = new THREE.Object3D()
    placeCar(track, build, frameAt(6), 0, object)
    const nose = worldPoint(object, new THREE.Vector3(0, WHEEL.radius, 0))
    const tail = worldPoint(object, new THREE.Vector3(RULES.maxLength, WHEEL.radius, 0))
    // The track runs toward +x, so a car facing the right way has its nose at greater x.
    expect(nose.x).toBeGreaterThan(tail.x)
  })

  it('stands the car upright rather than flipping it', () => {
    const object = new THREE.Object3D()
    placeCar(track, build, frameAt(6), 0, object)
    const up = new THREE.Vector3(0, 1, 0).applyEuler(object.rotation)
    expect(up.y).toBeGreaterThan(0.9)
  })

  it('puts the nose at the arc length the simulation reports', () => {
    const object = new THREE.Object3D()
    const s = 7
    placeCar(track, build, frameAt(s), 0, object)
    const nose = worldPoint(object, new THREE.Vector3(0, WHEEL.radius, 0))
    // Past the transition the track is flat, so arc length and world x coincide.
    expect(nose.x).toBeCloseTo(track.pointAt(s).x, 2)
  })

  it('sits the wheels on the track surface on the ramp', () => {
    const object = new THREE.Object3D()
    placeCar(track, build, frameAt(1.2), 0, object)
    const rearHub = worldPoint(object, new THREE.Vector3(build.wheelbase.rearX, WHEEL.radius, 0))
    const sRear = 1.2 - build.wheelbase.rearX
    const surface = track.pointAt(sRear)
    const slope = track.slopeAt(sRear)
    expect(rearHub.x).toBeCloseTo(surface.x + Math.sin(slope) * WHEEL.radius, 4)
    expect(rearHub.y).toBeCloseTo(surface.y + Math.cos(slope) * WHEEL.radius, 4)
  })

  it('points the nose the same way the car is drifting', () => {
    const object = new THREE.Object3D()
    placeCar(track, build, frameAt(6, 0.2), 0, object)
    const nose = worldPoint(object, new THREE.Vector3(0, WHEEL.radius, 0))
    const tail = worldPoint(object, new THREE.Vector3(RULES.maxLength, WHEEL.radius, 0))
    // Positive yaw moves the car toward +z, so the nose must lead toward +z too.
    expect(nose.z).toBeGreaterThan(tail.z)
  })
})
