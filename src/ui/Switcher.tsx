import { useEffect } from 'react'
import { FIXED_ANGLES, laneHotkey, type CameraAngleId } from '../broadcast/cameras'
import { requestOverride } from '../broadcast/directorBus'
import { useStore } from '../state/store'
import { playback, useLiveReadout } from '../state/playback'
import { unlockAudio, isAudioEnabled, setAudioEnabled } from '../audio/sfx'

/**
 * The switcher.
 *
 * One press per angle, no menus mid-race -- the whole mode falls apart if changing
 * shot takes two actions. Every hotkey has a matching button so the same directing is
 * possible with a keyboard or a thumb.
 */

/** How far back an instant replay reaches. */
const REPLAY_WINDOW = 3

export function Switcher() {
  const race = useStore((s) => s.race)
  const activeAngle = useStore((s) => s.activeAngle)
  const autoCam = useStore((s) => s.autoCam)
  const slowMo = useStore((s) => s.slowMo)
  const replay = useStore((s) => s.replay)
  const readout = useLiveReadout()

  const takeAngle = (angle: CameraAngleId) => {
    unlockAudio()
    useStore.getState().setAngle(angle)
    // With auto-cam running, a press steals one shot rather than switching modes.
    if (useStore.getState().autoCam) requestOverride(angle)
  }

  const startInstantReplay = () => {
    const time = playback.time
    useStore.getState().startReplay({
      startTime: Math.max(0, time - REPLAY_WINDOW),
      endTime: time,
      angle: readout.onAir as CameraAngleId,
      rate: 0.5,
      resumeAt: time,
      label: 'REPLAY',
    })
  }

  const markClip = () => {
    const time = playback.time
    useStore.getState().saveClip({
      label: `Heat ${useStore.getState().heat} - ${readout.onAir}`,
      raceSeed: race?.seed ?? 0,
      startTime: Math.max(0, time - REPLAY_WINDOW),
      endTime: time,
      angle: readout.onAir as CameraAngleId,
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /input|textarea|select/i.test(target.tagName)) return

      const fixed = FIXED_ANGLES.find((a) => a.hotkey === event.key)
      if (fixed) {
        takeAngle(fixed.id)
        return
      }
      if (race) {
        const laneMatch = race.entries.find((e) => laneHotkey(e.lane) === event.key)
        if (laneMatch) {
          takeAngle(`lane-${laneMatch.lane}`)
          return
        }
      }

      switch (event.key.toLowerCase()) {
        case 'a':
          useStore.getState().toggleAutoCam()
          break
        case 'r':
          startInstantReplay()
          break
        case 's':
          useStore.getState().toggleSlowMo()
          break
        case 'c':
          markClip()
          break
        case ' ':
          event.preventDefault()
          playback.playing = !playback.playing
          break
        case 'arrowleft':
          playback.time = Math.max(0, playback.time - 0.25)
          break
        case 'arrowright':
          playback.time = Math.min(playback.duration, playback.time + 0.25)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!race) return null

  return (
    <div className="switcher">
      <div className="switcher-row">
        {FIXED_ANGLES.map((angle) => (
          <button
            key={angle.id}
            className={`cambtn ${readout.onAir === angle.id ? 'live' : ''} ${
              activeAngle === angle.id && readout.onAir !== angle.id ? 'preview' : ''
            }`}
            onClick={() => takeAngle(angle.id)}
            title={angle.description}
          >
            <span className="key">{angle.hotkey}</span>
            <span className="name">{angle.short}</span>
          </button>
        ))}
        {race.entries.map((entry) => {
          const id: CameraAngleId = `lane-${entry.lane}`
          return (
            <button
              key={id}
              className={`cambtn ${readout.onAir === id ? 'live' : ''}`}
              onClick={() => takeAngle(id)}
              title={`Chase cam on ${entry.build.name}`}
            >
              <span className="key">{laneHotkey(entry.lane)}</span>
              <span className="name">L{entry.lane + 1}</span>
              <span className="swatch" style={{ background: entry.build.paint.bodyColor }} />
            </button>
          )
        })}
      </div>

      <div className="switcher-row">
        <button
          className={`toolbtn ${autoCam ? 'on' : ''}`}
          onClick={() => useStore.getState().toggleAutoCam()}
        >
          AUTO-CAM <span className="kbd">A</span>
        </button>
        <button className={`toolbtn ${replay ? 'hot' : ''}`} onClick={startInstantReplay}>
          REPLAY <span className="kbd">R</span>
        </button>
        <button className={`toolbtn ${slowMo ? 'on' : ''}`} onClick={() => useStore.getState().toggleSlowMo()}>
          SLO-MO <span className="kbd">S</span>
        </button>
        <button className="toolbtn" onClick={markClip}>
          CLIP <span className="kbd">C</span>
        </button>
        <button
          className="toolbtn ghost"
          onClick={() => {
            playback.playing = !playback.playing
          }}
        >
          {playback.playing ? 'PAUSE' : 'PLAY'} <span className="kbd">SPACE</span>
        </button>
        <Scrubber />
        <button
          className="toolbtn ghost"
          onClick={() => {
            unlockAudio()
            setAudioEnabled(!isAudioEnabled())
          }}
        >
          {isAudioEnabled() ? 'SOUND ON' : 'SOUND OFF'}
        </button>
      </div>
    </div>
  )
}

/** Timeline scrub. Works with a mouse or a thumb, which is why it is a range input. */
function Scrubber() {
  const readout = useLiveReadout()
  const duration = Math.max(0.1, playback.duration)
  return (
    <input
      type="range"
      min={0}
      max={duration}
      step={0.01}
      value={Math.min(readout.time, duration)}
      onPointerDown={() => {
        playback.scrubbing = true
      }}
      onPointerUp={() => {
        playback.scrubbing = false
      }}
      onChange={(event) => {
        playback.time = Number(event.target.value)
      }}
      style={{ flex: '1 1 120px', minWidth: 110, accentColor: '#ffb703' }}
      aria-label="Scrub the race timeline"
    />
  )
}
