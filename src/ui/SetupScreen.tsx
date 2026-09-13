import { useEffect } from 'react'
import { useStore } from '../state/store'
import { ALL_ARCHETYPES, ARCHETYPE_INFO } from '../sim/archetypes'
import { analyzeBuild } from '../sim/build'
import { toInches, toOunces } from '../sim/units'
import { unlockAudio } from '../audio/sfx'
import type { BotArchetype } from '../sim/types'

/**
 * Broadcast setup: pick the field, pick the format, go. Everything is available from
 * the start -- no unlocks, no tiers. Variety comes from the cars, not from gates.
 */
export function SetupScreen() {
  const fieldSize = useStore((s) => s.fieldSize)
  const archetypeMix = useStore((s) => s.archetypeMix)
  const format = useStore((s) => s.format)
  const field = useStore((s) => s.field)
  const clips = useStore((s) => s.clips)

  useEffect(() => {
    if (field.length !== fieldSize) useStore.getState().rerollField()
  }, [field.length, fieldSize])

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="brand">
          <h1>Pinewood Derby Broadcast</h1>
          <div className="sub">Pick the field. Call the race. Catch the photo finish.</div>
        </div>

        <div className="card">
          <h2>DIRECTING</h2>
          <p className="hint">
            You are not driving, you are cutting the broadcast. Auto-cam directs by default;
            pressing an angle steals one shot and hands control back a moment later.
          </p>
          <div className="keygrid">
            {[
              ['1', 'Starting gate'],
              ['2', 'Ramp'],
              ['3', 'Finish line'],
              ['4', 'Overhead'],
              ['5', 'Free cam'],
              ['6+', 'Lane chase'],
              ['A', 'Auto-cam'],
              ['R', 'Replay'],
              ['S', 'Slow motion'],
              ['C', 'Mark clip'],
            ].map(([key, label]) => (
              <span className="keyrow" key={key}>
                <kbd>{key}</kbd>
                {label}
              </span>
            ))}
          </div>
          <p className="hint" style={{ margin: '10px 0 0' }}>
            Every key has a button along the bottom, so a thumb works as well as a keyboard.
          </p>
        </div>

        <div className="card">
          <h2>FIELD SIZE</h2>
          <p className="hint">Lanes on the track. Bigger fields mean more to watch and harder cuts.</p>
          <div className="chiprow">
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button
                key={n}
                className={`chip ${fieldSize === n ? 'on' : ''}`}
                onClick={() => useStore.getState().setFieldSize(n)}
              >
                {n} lanes
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>FORMAT</h2>
          <p className="hint">
            A single heat is one run. Best of three keeps the same cars and re-races them, so the
            day-of variance decides something.
          </p>
          <div className="chiprow">
            <button
              className={`chip ${format === 'single' ? 'on' : ''}`}
              onClick={() => useStore.getState().setFormat('single')}
            >
              Single heat
            </button>
            <button
              className={`chip ${format === 'bo3' ? 'on' : ''}`}
              onClick={() => useStore.getState().setFormat('bo3')}
            >
              Best of three
            </button>
          </div>
        </div>

        <div className="card">
          <h2>THE FIELD</h2>
          <p className="hint">
            Archetypes differ in how they are built, never in how they are scored. A Speed Demon is
            fast because its axles are polished and its mass sits low and rearward. A Wildcard
            wobbles because its wheels really are out of round.
          </p>
          <div className="lanegrid">
            {Array.from({ length: fieldSize }, (_, lane) => {
              const build = field[lane]
              const analysis = build ? analyzeBuild(build) : null
              return (
                <div className="lanecard" key={lane}>
                  <span className="lane-no">LANE {lane + 1}</span>
                  <span className="car-name">
                    <span
                      className="car-swatch"
                      style={{ background: build?.paint.bodyColor ?? '#444' }}
                    />
                    {build?.name ?? 'Generating...'}
                  </span>
                  <span className="car-blurb">
                    {analysis
                      ? `${toOunces(analysis.totalMass).toFixed(2)} oz - mass ${toInches(
                          analysis.comAheadOfRearAxle,
                        ).toFixed(2)}" ahead of the rear axle, ${toInches(analysis.com.comY).toFixed(2)}" up`
                      : ARCHETYPE_INFO[archetypeMix[lane]].blurb}
                  </span>
                  <select
                    value={archetypeMix[lane]}
                    onChange={(event) => {
                      useStore.getState().setArchetype(lane, event.target.value as BotArchetype)
                      useStore.getState().rerollField()
                    }}
                  >
                    {ALL_ARCHETYPES.map((a) => (
                      <option key={a} value={a}>
                        {ARCHETYPE_INFO[a].name}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>

        {clips.length > 0 && (
          <div className="card">
            <h2>SAVED CLIPS</h2>
            <p className="hint">Moments you marked during a broadcast. They survive a reload.</p>
            <div className="clipstrip">
              {clips
                .slice()
                .reverse()
                .map((clip) => (
                  <button key={clip.id} className="clipcard" onClick={() => useStore.getState().deleteClip(clip.id)}>
                    <div className="clip-title">{clip.label}</div>
                    <div className="clip-meta">
                      {(clip.endTime - clip.startTime).toFixed(1)}s - tap to delete
                    </div>
                  </button>
                ))}
            </div>
          </div>
        )}

        <div className="actionrow">
          <button
            className="bigbtn secondary"
            onClick={() => {
              unlockAudio()
              useStore.getState().rerollField()
            }}
          >
            Reroll field
          </button>
          <button
            className="bigbtn"
            onClick={() => {
              unlockAudio()
              useStore.getState().startBroadcast()
            }}
          >
            Go live
          </button>
        </div>
      </div>
    </div>
  )
}
