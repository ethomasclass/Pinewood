/**
 * Synthesised sound. No asset files: everything here is made out of oscillators and
 * noise at runtime, which keeps the whole game a single download and means the gate
 * clack can be tuned by changing a number rather than re-recording anything.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = enabled ? 0.5 : 0
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Browsers require a gesture before audio starts; call this from the first tap. */
export const unlockAudio = () => {
  ensureContext()
}

export const setAudioEnabled = (value: boolean) => {
  enabled = value
  if (master) master.gain.value = value ? 0.5 : 0
}

export const isAudioEnabled = () => enabled

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** The mechanical clack of the starting gate letting go. */
export function playGate(): void {
  const context = ensureContext()
  if (!context || !master) return
  const now = context.currentTime

  const click = context.createOscillator()
  const clickGain = context.createGain()
  click.type = 'square'
  click.frequency.setValueAtTime(180, now)
  click.frequency.exponentialRampToValueAtTime(60, now + 0.08)
  clickGain.gain.setValueAtTime(0.35, now)
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
  click.connect(clickGain).connect(master)
  click.start(now)
  click.stop(now + 0.16)

  const snap = context.createBufferSource()
  snap.buffer = noiseBuffer(context, 0.08)
  const snapFilter = context.createBiquadFilter()
  snapFilter.type = 'bandpass'
  snapFilter.frequency.value = 2600
  const snapGain = context.createGain()
  snapGain.gain.setValueAtTime(0.4, now)
  snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
  snap.connect(snapFilter).connect(snapGain).connect(master)
  snap.start(now)
}

/** A short countdown blip for the start lights. */
export function playBlip(pitch = 660): void {
  const context = ensureContext()
  if (!context || !master) return
  const now = context.currentTime
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.type = 'sine'
  osc.frequency.value = pitch
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  osc.connect(gain).connect(master)
  osc.start(now)
  osc.stop(now + 0.2)
}

/** Wheel flange catching the guide rail. */
export function playRail(severity: number): void {
  const context = ensureContext()
  if (!context || !master) return
  const now = context.currentTime
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context, 0.12)
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1400 + severity * 2200
  filter.Q.value = 3
  const gain = context.createGain()
  const peak = Math.min(0.32, 0.05 + severity * 0.3)
  gain.gain.setValueAtTime(peak, now)
  gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.1 + severity * 0.12)
  source.connect(filter).connect(gain).connect(master)
  source.start(now)
}

/** The finish beam. */
export function playFinish(): void {
  const context = ensureContext()
  if (!context || !master) return
  const now = context.currentTime
  const tones = [880, 1320]
  for (let i = 0; i < tones.length; i++) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'triangle'
    osc.frequency.value = tones[i]
    const at = now + i * 0.06
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
    osc.connect(gain).connect(master)
    osc.start(at)
    osc.stop(at + 0.32)
  }
}

/** Crowd noise that swells with the drama. */
let crowdGain: GainNode | null = null
let crowdSource: AudioBufferSourceNode | null = null

export function startCrowd(): void {
  const context = ensureContext()
  if (!context || !master || crowdSource) return
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context, 2)
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 700
  const gain = context.createGain()
  gain.gain.value = 0.02
  source.connect(filter).connect(gain).connect(master)
  source.start()
  crowdSource = source
  crowdGain = gain
}

export function setCrowdLevel(level: number): void {
  const context = ensureContext()
  if (!context || !crowdGain) return
  crowdGain.gain.setTargetAtTime(Math.max(0, Math.min(0.16, level)), context.currentTime, 0.35)
}

/** Rolling rumble that tracks the speed of whatever is on air. */
let rollGain: GainNode | null = null
let rollFilter: BiquadFilterNode | null = null
let rollSource: AudioBufferSourceNode | null = null

export function startRoll(): void {
  const context = ensureContext()
  if (!context || !master || rollSource) return
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context, 2)
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 300
  filter.Q.value = 0.8
  const gain = context.createGain()
  gain.gain.value = 0
  source.connect(filter).connect(gain).connect(master)
  source.start()
  rollSource = source
  rollGain = gain
  rollFilter = filter
}

export function setRoll(speed: number): void {
  const context = ensureContext()
  if (!context || !rollGain || !rollFilter) return
  rollGain.gain.setTargetAtTime(Math.min(0.14, speed * 0.03), context.currentTime, 0.06)
  rollFilter.frequency.setTargetAtTime(180 + speed * 90, context.currentTime, 0.06)
}

export function stopAmbience(): void {
  crowdSource?.stop()
  rollSource?.stop()
  crowdSource = null
  crowdGain = null
  rollSource = null
  rollGain = null
  rollFilter = null
}
