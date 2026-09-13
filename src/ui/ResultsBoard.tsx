import { nextHeat, useStore } from '../state/store'
import { playback } from '../state/playback'
import { formatBroadcastTime, formatScaleMph, toInches } from '../sim/units'
import { bestReplayAngle } from '../broadcast/autocam'
import type { CarResult } from '../sim/race'

/**
 * The results board. It shows the finishing order, and then it shows *why* -- where
 * each car's energy went. A director who can see that the Wildcard lost a tenth to
 * the rail has something to talk about next heat.
 */
export function ResultsBoard() {
  const race = useStore((s) => s.race)
  const format = useStore((s) => s.format)
  const heat = useStore((s) => s.heat)
  const seriesWins = useStore((s) => s.seriesWins)
  const seriesComplete = useStore((s) => s.seriesComplete)
  if (!race) return null

  const ordered = [...race.results].sort((a, b) => a.position - b.position)
  const winner = ordered[0]
  const seriesOver = format === 'single' || seriesComplete

  const watchAgain = () => {
    useStore.setState({ phase: 'live' })
    playback.time = 0
    playback.playing = true
    useStore.getState().startReplay({
      startTime: 0,
      endTime: race.recording.duration,
      angle: bestReplayAngle(race.events, race.entries),
      rate: 1,
      resumeAt: race.recording.duration,
      label: 'FULL REPLAY',
    })
  }

  return (
    <div className="results">
      <div className="results-panel">
        <h2>{format === 'bo3' ? `HEAT ${heat} RESULT` : 'RESULT'}</h2>
        <div className="winner">
          {winner.build.name} - {formatBroadcastTime(winner.elapsed)}s
        </div>

        <table className="results-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Car</th>
              <th>Time</th>
              <th>Gap</th>
              <th>Trap</th>
              <th>Rail</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((result) => (
              <tr key={result.lane}>
                <td>{result.position}</td>
                <td className="name">
                  <span className="swatch" style={{ background: result.build.paint.bodyColor }} />
                  {result.build.name}
                </td>
                <td>{Number.isFinite(result.elapsed) ? formatBroadcastTime(result.elapsed) : 'DNF'}</td>
                <td>{result.position === 1 ? '-' : `+${result.gap.toFixed(3)}`}</td>
                <td>{formatScaleMph(result.topSpeed)}</td>
                <td>{result.railHits > 0 ? `${(result.energyLostToRail * 1000).toFixed(0)} mJ` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="results-note">
          {explainWinner(winner, ordered[1])}
          {race.photoFinish && ` Margin of ${(race.margin * 1000).toFixed(0)} thousandths at the line.`}
        </p>

        {format === 'bo3' && (
          <p className="results-note">
            Series:{' '}
            {race.entries
              .map((entry) => `${entry.build.name} ${seriesWins[entry.lane] ?? 0}`)
              .join('  -  ')}
          </p>
        )}

        <div className="actionrow">
          <button className="bigbtn secondary" onClick={watchAgain}>
            Watch it again
          </button>
          {!seriesOver && (
            <button className="bigbtn" onClick={nextHeat}>
              Next heat
            </button>
          )}
          <button
            className="bigbtn"
            onClick={() => {
              useStore.getState().rerollField()
              useStore.getState().startBroadcast()
            }}
          >
            New field
          </button>
          <button className="bigbtn secondary" onClick={() => useStore.getState().backToSetup()}>
            Setup
          </button>
        </div>
      </div>
    </div>
  )
}

/** A plain-language read of why the winner won, taken from its own build analysis. */
function explainWinner(winner: CarResult, runnerUp?: CarResult): string {
  const bits: string[] = []
  bits.push(
    `${winner.build.name} carried its mass ${toInches(winner.analysis.comAheadOfRearAxle).toFixed(
      2,
    )}" ahead of the rear axle and ${toInches(winner.analysis.com.comY).toFixed(2)}" off the deck.`,
  )
  if (runnerUp && winner.analysis.rollingResistance < runnerUp.analysis.rollingResistance * 0.92) {
    bits.push(`Better axle prep than ${runnerUp.build.name}, and that is where the race was won.`)
  }
  if (winner.energyLostToRail > 0.02) {
    bits.push('It still gave time back to the guide rail, so there is more in it.')
  }
  return bits.join(' ')
}
