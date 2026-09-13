import * as THREE from 'three'
import type { PaintJob } from '../sim/types'

/**
 * Paint is drawn to a canvas and used as the body texture. Zero mechanical effect --
 * this exists purely so a car looks like somebody's car.
 *
 * The texture is split: the lower band carries the side-view artwork (stripes, race
 * number), the upper band is plain body colour and is what the deck and underside
 * sample, so the number never smears across the top of the car.
 */

const WIDTH = 512
const HEIGHT = 384
/** Must match the UV bands in geometry.ts. */
const RIGHT_BASE = 0
const LEFT_BASE = 0.44
const FLANK_BAND = 0.42

const cache = new Map<string, THREE.CanvasTexture>()

const keyOf = (paint: PaintJob) =>
  `${paint.bodyColor}|${paint.accentColor}|${paint.finish}|${paint.stripe}|${paint.number}`

export function createLiveryTexture(paint: PaintJob): THREE.CanvasTexture {
  const key = keyOf(paint)
  const cached = cache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = paint.bodyColor
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // The same artwork twice: once for each flank, the second one pre-mirrored. A car
  // is yawed a half turn to face down-track, so without this the race number reads
  // backwards on whichever side the trackside cameras are on.
  drawFlank(ctx, paint, RIGHT_BASE, false)
  drawFlank(ctx, paint, LEFT_BASE, true)

  applyFinish(ctx, paint)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cache.set(key, texture)
  return texture
}

/**
 * Draws one flank's artwork into its UV band. Canvas y grows downward while UV v
 * grows upward, so a band at v = base occupies the lower part of its slice.
 *
 * Both bands use the same u mapping (u = distance from the nose), so layout
 * positions stay identical -- the roundel sits over the rear wheel on both sides.
 * Only the *directional* artwork is pre-flipped for the flank whose projection the
 * viewer sees reversed: the digits and the flames. Flipping the whole band would
 * move the roundel to the wrong end of the car.
 */
function drawFlank(ctx: CanvasRenderingContext2D, paint: PaintJob, base: number, mirror: boolean): void {
  const bandHeight = FLANK_BAND * HEIGHT
  const bandTop = HEIGHT - (base + FLANK_BAND) * HEIGHT

  const flipAround = (x: number, y: number) => {
    ctx.translate(x, y)
    ctx.scale(-1, 1)
    ctx.translate(-x, -y)
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, bandTop, WIDTH, bandHeight)
  ctx.clip()
  ctx.translate(0, bandTop)

  ctx.fillStyle = paint.bodyColor
  ctx.fillRect(0, 0, WIDTH, bandHeight)

  ctx.fillStyle = paint.accentColor
  switch (paint.stripe) {
    case 'centre':
      ctx.fillRect(0, bandHeight * 0.42, WIDTH, bandHeight * 0.16)
      break
    case 'twin':
      ctx.fillRect(0, bandHeight * 0.3, WIDTH, bandHeight * 0.08)
      ctx.fillRect(0, bandHeight * 0.58, WIDTH, bandHeight * 0.08)
      break
    case 'flames': {
      ctx.save()
      if (mirror) flipAround(WIDTH / 2, bandHeight / 2)
      ctx.beginPath()
      ctx.moveTo(0, bandHeight)
      ctx.lineTo(0, bandHeight * 0.2)
      for (let i = 0; i < 7; i++) {
        const x = (i / 7) * WIDTH * 0.75
        const next = ((i + 1) / 7) * WIDTH * 0.75
        ctx.quadraticCurveTo(
          x + (next - x) * 0.5,
          bandHeight * (i % 2 === 0 ? 0 : 0.55),
          next,
          bandHeight * (0.2 + i * 0.09),
        )
      }
      ctx.lineTo(WIDTH * 0.75, bandHeight)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      break
    }
    default:
      break
  }

  // Race number on a roundel, sitting back over the rear wheel like a real derby car.
  const cx = WIDTH * 0.68
  const cy = bandHeight * 0.5
  const r = Math.min(bandHeight * 0.36, 52)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fdfdfb'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(20,20,24,0.55)'
  ctx.stroke()

  // Pre-flip the digits on this flank so the viewer's reversed projection turns
  // them back the right way round.
  if (mirror) flipAround(cx, cy)
  ctx.fillStyle = '#15151a'
  ctx.font = `bold ${Math.round(r * 1.15)}px "Arial Black", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(paint.number.slice(0, 2), cx, cy + 2)

  ctx.restore()
}

function applyFinish(ctx: CanvasRenderingContext2D, paint: PaintJob) {
  if (paint.finish === 'glitter') {
    // Deterministic sparkle: same paint job, same flecks, every time you load it.
    let seed = 1337
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < 700; i++) {
      const x = rand() * WIDTH
      const y = rand() * HEIGHT
      const size = 1 + rand() * 2
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(255,235,150,0.8)'
      ctx.fillRect(x, y, size, size)
    }
  }
  if (paint.finish === 'metallic') {
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    grad.addColorStop(0, 'rgba(255,255,255,0.32)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0.02)')
    grad.addColorStop(1, 'rgba(0,0,0,0.22)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
  }
}

/** Material parameters that go with each finish. */
export function finishMaterialProps(paint: PaintJob): { roughness: number; metalness: number } {
  switch (paint.finish) {
    case 'gloss':
      return { roughness: 0.22, metalness: 0.05 }
    case 'metallic':
      return { roughness: 0.3, metalness: 0.65 }
    case 'glitter':
      return { roughness: 0.35, metalness: 0.4 }
    default:
      return { roughness: 0.82, metalness: 0.0 }
  }
}
