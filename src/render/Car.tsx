import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildChassisGeometry } from './geometry'
import { createLiveryTexture, finishMaterialProps } from './livery'
import { AXLE_HALF_TRACK } from '../sim/build'
import { WHEEL } from '../sim/units'
import type { TrackGeometry } from '../sim/track'
import type { CarBuild } from '../sim/types'
import type { CarFrame } from '../sim/race'

/**
 * Places a car on the track by its wheels rather than by a single point, so it
 * pivots over the transition the way a real car does instead of clipping its tail
 * into the ramp.
 */
export function placeCar(
  track: TrackGeometry,
  build: CarBuild,
  frame: CarFrame,
  laneOffset: number,
  target: THREE.Object3D,
): void {
  const sFront = frame.s - build.wheelbase.frontX
  const sRear = frame.s - build.wheelbase.rearX

  const surfacePoint = (s: number) => {
    const p = track.pointAt(s)
    const slope = track.slopeAt(s)
    return new THREE.Vector2(p.x + Math.sin(slope) * WHEEL.radius, p.y + Math.cos(slope) * WHEEL.radius)
  }

  const front = surfacePoint(sFront)
  const rear = surfacePoint(sRear)
  const axis = front.clone().sub(rear)
  /** Angle of the down-track direction. Negative on a descent. */
  const pitch = Math.atan2(axis.y, axis.x)

  // Chassis local space runs nose-at-zero toward the tail, so local +X points UP the
  // track: the car is yawed a half turn to face the way it is going. Getting this
  // backwards renders every car tail-first, which is subtle enough to miss and
  // makes every wedge look like it is running the wrong way.
  target.rotation.order = 'YZX'
  target.rotation.set(0, Math.PI - frame.yaw, -pitch)

  // Pin the car by its rear axle: map the local rear-axle point onto the track's.
  const offset = new THREE.Vector3(build.wheelbase.rearX, WHEEL.radius, 0).applyEuler(target.rotation)
  target.position.set(rear.x - offset.x, rear.y - offset.y, laneOffset + frame.y - offset.z)
}

/**
 * Playback pushes frames in imperatively rather than through React state: at 120
 * frames a second, reconciling eight cars per frame is a waste of everybody's time.
 */
export function useCarHandle(build: CarBuild, laneOffset: number, track: TrackGeometry) {
  const groupRef = useRef<THREE.Group>(null)
  const wheelRefs = useRef<THREE.Mesh[]>([])

  const apply = (frame: CarFrame) => {
    const group = groupRef.current
    if (!group) return
    placeCar(track, build, frame, laneOffset, group)
    for (const wheel of wheelRefs.current) {
      if (wheel) wheel.rotation.y = frame.wheelAngle
    }
  }

  return { groupRef, wheelRefs, apply }
}

export function CarMesh({
  build,
  groupRef,
  wheelRefs,
}: {
  build: CarBuild
  groupRef: React.RefObject<THREE.Group | null>
  wheelRefs: React.RefObject<THREE.Mesh[]>
}) {
  const geometry = useMemo(() => buildChassisGeometry(build.profile), [build.profile])
  const texture = useMemo(() => createLiveryTexture(build.paint), [build.paint])
  const finish = useMemo(() => finishMaterialProps(build.paint), [build.paint])

  const wheelGeometry = useMemo(
    () => new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 18),
    [],
  )
  const hubGeometry = useMemo(
    () => new THREE.CylinderGeometry(WHEEL.radius * 0.38, WHEEL.radius * 0.38, WHEEL.width * 1.15, 10),
    [],
  )

  const wheels = useMemo(() => {
    const lift = build.wheels.raisedFrontWheel ? 0.0022 : 0
    return [
      { x: build.wheelbase.frontX, z: -AXLE_HALF_TRACK, y: WHEEL.radius + lift },
      { x: build.wheelbase.frontX, z: AXLE_HALF_TRACK, y: WHEEL.radius },
      { x: build.wheelbase.rearX, z: -AXLE_HALF_TRACK, y: WHEEL.radius },
      { x: build.wheelbase.rearX, z: AXLE_HALF_TRACK, y: WHEEL.radius },
    ]
  }, [build.wheelbase, build.wheels.raisedFrontWheel])

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial map={texture} roughness={finish.roughness} metalness={finish.metalness} />
      </mesh>
      {wheels.map((w, i) => (
        <group key={i} position={[w.x, w.y, w.z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh
            ref={(m) => {
              if (m) wheelRefs.current[i] = m
            }}
            geometry={wheelGeometry}
            castShadow
          >
            <meshStandardMaterial color="#1c1c20" roughness={0.75} />
          </mesh>
          <mesh geometry={hubGeometry}>
            <meshStandardMaterial color="#c9ccd4" roughness={0.35} metalness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
