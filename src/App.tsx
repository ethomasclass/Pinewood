import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { useMemo } from 'react'
import { RaceScene } from './render/RaceScene'
import { useFreeCam } from './render/FreeCam'
import { SetupScreen } from './ui/SetupScreen'
import { Switcher } from './ui/Switcher'
import { ResultsBoard } from './ui/ResultsBoard'
import {
  CommentaryFeed,
  HeatCard,
  LaneTicker,
  LowerThird,
  OnAirBadge,
  PhotoBanner,
  ReplayBadge,
  StartLights,
} from './ui/Overlays'
import { useStore } from './state/store'
import { unlockAudio } from './audio/sfx'

export default function App() {
  const phase = useStore((s) => s.phase)
  const track = useStore((s) => s.track)
  const overlays = useStore((s) => s.overlays)
  const freeCam = useFreeCam(track.length)

  const glSettings = useMemo(
    () => ({ antialias: true, powerPreference: 'high-performance' as const }),
    [],
  )

  if (phase === 'setup') return <SetupScreen />

  return (
    <div className="app" onPointerDown={unlockAudio}>
      <div className="stage" {...freeCam.bind}>
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={glSettings}
          camera={{ fov: 40, near: 0.02, far: 200, position: [1, 1, 2] }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.05
            scene.background = new THREE.Color('#2b2a33')
            scene.fog = new THREE.Fog('#2b2a33', 16, 40)
          }}
        >
          <RaceScene orbit={freeCam.orbit} />
        </Canvas>

        <div className="overlay-root">
          <div className="overlay-row">
            <OnAirBadge />
            <HeatCard />
          </div>
          <div className="overlay-mid">
            {overlays.ticker ? <LaneTicker /> : <span />}
            {overlays.commentary ? <CommentaryFeed /> : <span />}
          </div>
          <div className="overlay-row">{overlays.lowerThird ? <LowerThird /> : <span />}</div>
        </div>

        {overlays.startLights && <StartLights />}
        <PhotoBanner />
        <ReplayBadge />

        {phase === 'results' && <ResultsBoard />}
      </div>

      <Switcher />
    </div>
  )
}
