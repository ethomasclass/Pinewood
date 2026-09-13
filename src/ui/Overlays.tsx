import { useLiveReadout } from '../state/playback'
import { useStore } from '../state/store'
import { useFeed } from '../state/feed'
import { FIXED_ANGLES, type CameraAngleId } from '../broadcast/cameras'
import { formatBroadcastTime, formatScaleMph } from '../sim/units'
import type { RaceResult } from '../sim/race'

/**
 * The on-screen overlay kit. Every element here is driven by the race-state event
 * stream or the live readout -- nothing invents its own idea of what is happening,
 * so the ticker, the announcer and the camera always agree.
 */

export function angleLabel(angle: CameraAngleId, race: RaceResult | null): string {
  const fixed = FIXED_ANGLES.find((a) => a.id === angle)
  if (fixed) return fixed.label
  if (angle.startsWith('lane-')) {
    const lane = Number(angle.slice(5))
    const entry = race?.entries.find((e) => e.lane === lane)
    return entry ? `Lane ${lane + 1} - ${entry.build.name}` : `Lane ${lane + 1}`
  }
  return angle
}

export function OnAirBadge() {
  const readout = useLiveReadout()
  const race = useStore((s) => s.race)
  const autoCam = useStore((s) => s.autoCam)
  return (
    <div className="onair">
      <span className="onair-dot" />
      <div>
        <div className="onair-label">{angleLabel(readout.onAir as CameraAngleId, race).toUpperCase()}</div>
        <div className="onair-reason">{readout.directorReason}</div>
      </div>
      <span className={`onair-auto ${autoCam ? 'on' : 'off'}`}>{autoCam ? 'AUTO' : 'MANUAL'}</span>
    </div>
  )
}

export function HeatCard() {
  const readout = useLiveReadout()
  const heat = useStore((s) => s.heat)
  const format = useStore((s) => s.format)
  const race = useStore((s) => s.race)
  const shown = Math.min(readout.time, race?.recording.duration ?? readout.time)
  return (
    <div className="heatcard">
      <div className="title">{format === 'bo3' ? `HEAT ${heat} OF 3` : 'SINGLE HEAT'}</div>
      <div className="clock">{formatBroadcastTime(shown)}</div>
    </div>
  )
}

export function LaneTicker() {
  const readout = useLiveReadout()
  const race = useStore((s) => s.race)
  if (!race) return null

  const rows = readout.frames
    .map((frame, index) => ({ frame, entry: race.entries[index], index }))
    .sort((a, b) => a.frame.position - b.frame.position)

  const leaderS = rows[0]?.frame.s ?? 0

  return (
    <div className="ticker">
      <div className="ticker-head">RUNNING ORDER</div>
      {rows.map(({ frame, entry }) => {
        const behind = leaderS - frame.s
        const gapSeconds = behind / Math.max(1.2, frame.v)
        return (
          <div key={entry.lane} className={`ticker-row ${frame.position === 1 ? 'leader' : ''}`}>
            <span className="ticker-pos">{frame.position}</span>
            <span className="ticker-chip" style={{ background: entry.build.paint.bodyColor }} />
            <span className="ticker-name">{entry.build.name}</span>
            <span className={behind > 0.001 ? 'ticker-gap' : 'ticker-speed'}>
              {behind > 0.001 ? `+${gapSeconds.toFixed(2)}` : `${formatScaleMph(frame.v)} mph`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function CommentaryFeed() {
  const lines = useFeed((s) => s.lines)
  const recent = lines.slice(-3)
  return (
    <div className="commentary">
      {recent.map((line, i) => (
        <div key={`${line.t}-${i}`} className={`commentary-line ${line.tone}`}>
          {line.text}
        </div>
      ))}
    </div>
  )
}

export function LowerThird() {
  const readout = useLiveReadout()
  const race = useStore((s) => s.race)
  if (!race || readout.frames.length === 0) return null

  const leader = race.entries[readout.leaderIndex]
  const frame = readout.frames[readout.leaderIndex]
  if (!leader || !frame) return null

  const finished = frame.s >= race.track.length
  const result = race.results.find((r) => r.lane === leader.lane)

  return (
    <div className="lowerthird">
      <div className="bar" style={{ background: leader.build.paint.bodyColor }} />
      <div className="body">
        <div className="kicker">{finished ? 'WINNER' : 'LEADING'}</div>
        <div className="headline">{leader.build.name}</div>
        <div className="sub">
          Lane {leader.lane + 1}
          {finished && result
            ? ` - ${formatBroadcastTime(result.elapsed)}s`
            : ` - ${formatScaleMph(frame.v)} scale mph`}
        </div>
      </div>
    </div>
  )
}

export function StartLights() {
  const lights = useFeed((s) => s.startLights)
  const readout = useLiveReadout()
  // The lights clear themselves a beat after the gate drops.
  if (lights < 0 || readout.time > 0.9) return null
  return (
    <div className="startlights">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`startlight ${lights >= 4 ? 'go' : lights > i ? 'lit' : ''}`} />
      ))}
    </div>
  )
}

export function PhotoBanner() {
  const photo = useFeed((s) => s.photoFinish)
  const race = useStore((s) => s.race)
  if (!photo) return null
  const names = photo.lanes
    .slice(0, 2)
    .map((lane) => race?.entries.find((e) => e.lane === lane)?.build.name ?? `Lane ${lane + 1}`)
  return (
    <div className="photobanner">
      PHOTO FINISH
      <small>
        {names.join(' vs ')} - {(photo.margin * 1000).toFixed(0)} thousandths
      </small>
    </div>
  )
}

export function ReplayBadge() {
  const replay = useStore((s) => s.replay)
  if (!replay) return null
  return (
    <div className="replaybadge">
      <span className="onair-dot" />
      {replay.label} - {replay.rate < 0.5 ? 'SLOW MOTION' : 'REPLAY'}
    </div>
  )
}
