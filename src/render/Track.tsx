import { useMemo } from 'react'
import * as THREE from 'three'
import { extrudeAlongTrack, rectSection } from './geometry'
import type { TrackGeometry } from '../sim/track'
import { WHEEL, inches } from '../sim/units'
import { AXLE_HALF_TRACK, RIDE_HEIGHT } from '../sim/build'

/**
 * The track, swept along the exact curve the physics integrates. Rendering and
 * simulation share one definition of where the surface is.
 */
export function Track({
  track,
  gateRef,
}: {
  track: TrackGeometry
  gateRef?: React.RefObject<THREE.Group | null>
}) {
  const { spec } = track
  const halfWidth = (spec.laneCount * spec.laneSpacing) / 2
  const sStart = -0.9
  const sEnd = spec.length + spec.runoutLength

  const deck = useMemo(
    () => extrudeAlongTrack(track, rectSection(0, halfWidth * 2, -0.075, 0), sStart, sEnd, 0.06),
    [track, halfWidth, sEnd],
  )

  // The centre guide rail the cars straddle. Its width is derived, not picked: the
  // edge lands exactly where the simulation says the inside of a wheel touches it,
  // so what you see a car do and what the physics charges it for are the same event.
  // Its height stays under the ride height, so the block clears it.
  const railWidth = 2 * (AXLE_HALF_TRACK - WHEEL.width / 2 - spec.railClearance)
  const railHeight = Math.min(inches(0.26), RIDE_HEIGHT * 0.72)

  const rails = useMemo(() => {
    const out: THREE.BufferGeometry[] = []
    for (let lane = 0; lane < spec.laneCount; lane++) {
      out.push(
        extrudeAlongTrack(track, rectSection(track.laneOffset(lane), railWidth, 0, railHeight), sStart, sEnd, 0.06),
      )
    }
    return out
  }, [track, spec.laneCount, sEnd, railWidth, railHeight])

  const dividers = useMemo(() => {
    const out: THREE.BufferGeometry[] = []
    for (let lane = 0; lane <= spec.laneCount; lane++) {
      const z = track.laneOffset(lane) - spec.laneSpacing / 2
      out.push(extrudeAlongTrack(track, rectSection(z, 0.008, 0.0005, 0.0025), sStart, sEnd, 0.12))
    }
    return out
  }, [track, spec.laneCount, spec.laneSpacing, sEnd])

  // Carpet and foam past the finish line: this is what actually stops the cars, and
  // seeing it makes the run-out read as part of the track rather than empty deck.
  const catchPad = useMemo(
    () =>
      extrudeAlongTrack(
        track,
        rectSection(0, halfWidth * 2 - 0.01, 0.0008, 0.004),
        spec.length + spec.brakeStart,
        sEnd - 0.06,
        0.12,
      ),
    [track, halfWidth, spec.length, spec.brakeStart, sEnd],
  )

  const legs = useMemo(() => {
    const out: Array<{ position: [number, number, number]; height: number }> = []
    for (let s = 0.2; s < sEnd; s += 1.5) {
      const p = track.pointAt(s)
      const height = p.y + 0.42
      out.push({ position: [p.x, p.y - 0.075 - height / 2, 0], height })
    }
    return out
  }, [track, sEnd])

  const finishPoint = track.pointAt(spec.length)
  const endPoint = track.pointAt(sEnd)
  const startPoint = track.pointAt(0)
  const startSlope = track.slopeAt(0)

  return (
    <group>
      <mesh geometry={deck} receiveShadow castShadow>
        <meshStandardMaterial color="#d9dde4" roughness={0.55} metalness={0.15} />
      </mesh>
      {rails.map((g, i) => (
        <mesh key={`rail-${i}`} geometry={g} receiveShadow castShadow>
          <meshStandardMaterial color="#aeb4bf" roughness={0.45} metalness={0.35} />
        </mesh>
      ))}
      {dividers.map((g, i) => (
        <mesh key={`div-${i}`} geometry={g}>
          <meshStandardMaterial color="#5c6472" roughness={0.9} />
        </mesh>
      ))}

      <mesh geometry={catchPad} receiveShadow>
        <meshStandardMaterial color="#3f4654" roughness={0.98} />
      </mesh>

      {/* Backstop at the end of the run-out. */}
      <group position={[endPoint.x, endPoint.y, 0]}>
        <mesh position={[0.04, 0.05, 0]} castShadow>
          <boxGeometry args={[0.07, 0.1, halfWidth * 2]} />
          <meshStandardMaterial color="#c1553f" roughness={0.95} />
        </mesh>
      </group>

      {/* Trestle legs. Somebody's dad built these. */}
      {legs.map((leg, i) => (
        <mesh key={`leg-${i}`} position={leg.position} castShadow>
          <boxGeometry args={[0.07, leg.height, (spec.laneCount * spec.laneSpacing) * 0.82]} />
          <meshStandardMaterial color="#9a7448" roughness={0.85} />
        </mesh>
      ))}

      {/* Starting gate. The mechanism lives under the deck the way a real one does,
          with only the pins through the slots -- so the gate cam sees the cars and
          the pins dropping, not a slab of plywood. */}
      <group position={[startPoint.x, startPoint.y, 0]} rotation={[0, 0, -startSlope]}>
        <mesh position={[0.02, -0.1, 0]} castShadow>
          <boxGeometry args={[0.09, 0.09, halfWidth * 2 + 0.06]} />
          <meshStandardMaterial color="#2f3542" roughness={0.6} metalness={0.3} />
        </mesh>
        <group ref={gateRef} position={[-0.004, -0.055, 0]}>
          <mesh position={[0, 0.022, 0]} castShadow>
            <boxGeometry args={[0.016, 0.044, halfWidth * 2]} />
            <meshStandardMaterial color="#c98a2e" roughness={0.45} metalness={0.35} />
          </mesh>
          {Array.from({ length: spec.laneCount }, (_, lane) => (
            <mesh key={lane} position={[0, 0.075, track.laneOffset(lane)]} castShadow>
              <boxGeometry args={[0.014, 0.075, 0.02]} />
              <meshStandardMaterial color="#f2b950" roughness={0.4} metalness={0.45} />
            </mesh>
          ))}
        </group>
      </group>

      {/* Finish gantry with the timing eye. */}
      <group position={[finishPoint.x, finishPoint.y, 0]}>
        {/* Posts stand well outboard so the finish camera can sit inside the gantry,
            which is where a real finish-line camera lives. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 0.16, side * (halfWidth + 0.46)]} castShadow>
            <boxGeometry args={[0.05, 0.32, 0.05]} />
            <meshStandardMaterial color="#2f3542" roughness={0.5} metalness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 0.31, 0]} castShadow>
          <boxGeometry args={[0.06, 0.05, halfWidth * 2 + 0.92]} />
          <meshStandardMaterial color="#2f3542" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.0035, 0]}>
          <boxGeometry args={[0.012, 0.004, halfWidth * 2]} />
          <meshStandardMaterial color="#ff3b3b" emissive="#ff2020" emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  )
}

/** Hand-lettered banner, folding tables, and a crowd. The little league of racing. */
export function Venue({ track }: { track: TrackGeometry }) {
  const { spec } = track
  const halfWidth = (spec.laneCount * spec.laneSpacing) / 2
  const finish = track.pointAt(spec.length)
  const end = track.pointAt(spec.length + spec.runoutLength)

  const bannerTexture = useMemo(() => makeBannerTexture(), [])
  const floorTexture = useMemo(() => makeFloorTexture(), [])

  const crowd = useMemo(() => {
    const people: Array<{ position: [number, number, number]; color: string; height: number }> = []
    const colors = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#ffbe0b', '#06d6a0']
    let seed = 4242
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < 46; i++) {
      const side = i % 2 === 0 ? 1 : -1
      const along = 0.4 + rand() * (spec.length + 2.5)
      // Well back from the rails: close enough to be the room, far enough that a
      // track-level camera still sees the track.
      const out = halfWidth + 5.5 + rand() * 5.5
      const height = 0.95 + rand() * 0.7
      people.push({
        position: [along, height / 2, side * out],
        color: colors[Math.floor(rand() * colors.length)],
        height,
      })
    }
    return people
  }, [spec.length, halfWidth])

  return (
    <group>
      {/* Gym floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[spec.length / 2, -0.9, 0]} receiveShadow>
        <planeGeometry args={[40, 26]} />
        <meshStandardMaterial map={floorTexture} roughness={0.75} />
      </mesh>

      {/* Banner over the finish, hung across the track facing the oncoming cars so
          the chase cams run straight at it. */}
      <group position={[finish.x - 0.3, 1.05, 0]}>
        <mesh rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[1.7, 0.42]} />
          <meshStandardMaterial map={bannerTexture} transparent side={THREE.DoubleSide} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, -0.7, side * 0.87]}>
            <cylinderGeometry args={[0.03, 0.03, 1.5, 8]} />
            <meshStandardMaterial color="#6b7280" roughness={0.6} metalness={0.3} />
          </mesh>
        ))}
      </group>

      {/* Folding tables along the run-out, where the trophies sit. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[end.x - 1.4, -0.42, side * (halfWidth + 1.5)]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.8, 0.04, 0.75]} />
            <meshStandardMaterial color="#d8d3c6" roughness={0.85} />
          </mesh>
          {[-0.8, 0.8].map((dx) =>
            [-0.3, 0.3].map((dz) => (
              <mesh key={`${dx}-${dz}`} position={[dx, -0.24, dz]}>
                <cylinderGeometry args={[0.02, 0.02, 0.48, 6]} />
                <meshStandardMaterial color="#8d939c" roughness={0.6} metalness={0.4} />
              </mesh>
            )),
          )}
        </group>
      ))}

      {/* The crowd: parents, siblings, and one very bored dog. */}
      {crowd.map((person, i) => (
        <group key={i} position={[person.position[0], person.position[1] - 0.9, person.position[2]]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.15, Math.max(0.1, person.height - 0.42), 4, 8]} />
            <meshStandardMaterial color={person.color} roughness={0.9} />
          </mesh>
          <mesh position={[0, person.height * 0.5 - 0.04, 0]} castShadow>
            <sphereGeometry args={[0.1, 10, 8]} />
            <meshStandardMaterial color="#d9a877" roughness={0.85} />
          </mesh>
        </group>
      ))}

      {/* The gym itself: a warm back wall so the room does not read as the void. */}
      {[-18, 18].map((z) => (
        <mesh key={z} position={[spec.length / 2, 3.2, z]} rotation={[0, z > 0 ? Math.PI : 0, 0]} receiveShadow>
          <planeGeometry args={[56, 13]} />
          <meshStandardMaterial color="#9c8468" roughness={0.95} />
        </mesh>
      ))}
      {[-16, spec.length + 14].map((x) => (
        <mesh key={x} position={[x, 3.2, 0]} rotation={[0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[40, 13]} />
          <meshStandardMaterial color="#8e7a60" roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function makeBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fdf6e3'
  ctx.fillRect(0, 0, 1024, 256)
  ctx.strokeStyle = '#c1121f'
  ctx.lineWidth = 12
  ctx.strokeRect(16, 16, 1024 - 32, 256 - 32)
  ctx.fillStyle = '#1d3557'
  ctx.font = 'bold 88px Georgia, "Times New Roman", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('PACK 42 DERBY', 512, 104)
  ctx.fillStyle = '#c1121f'
  ctx.font = 'italic 46px Georgia, serif'
  ctx.fillText('gym doors open at six', 512, 182)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c99a5b'
  ctx.fillRect(0, 0, 512, 512)
  // Gym floor planking plus the ghost of a basketball key.
  ctx.strokeStyle = 'rgba(120,80,40,0.28)'
  ctx.lineWidth = 2
  for (let y = 0; y < 512; y += 26) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(512, y)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(250,250,250,0.5)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(256, 256, 150, 0, Math.PI * 2)
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(6, 4)
  return texture
}
