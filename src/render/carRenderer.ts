import type { CarParams } from '../core/physics/car'

/**
 * Draws a top-down single-seater at a world pose. The context transform must
 * already be in world metres.
 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  params: CarParams,
  color: string,
  steer = 0,
): void {
  const L = params.length
  const W = params.width
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(heading)

  // Wheels.
  ctx.fillStyle = '#0a0b0e'
  const wheelL = L * 0.16
  const wheelW = W * 0.24
  const frontX = L * 0.3
  const rearX = -L * 0.32
  for (const side of [-1, 1]) {
    ctx.fillRect(rearX - wheelL / 2, side * (W / 2) - wheelW / 2, wheelL, wheelW)
    ctx.save()
    ctx.translate(frontX, side * (W / 2 - wheelW * 0.1))
    ctx.rotate(steer)
    ctx.fillRect(-wheelL / 2, -wheelW / 2, wheelL, wheelW)
    ctx.restore()
  }

  // Body: nose, cockpit taper, engine cover.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(L / 2, -W * 0.08)
  ctx.lineTo(L / 2, W * 0.08)
  ctx.lineTo(L * 0.12, W * 0.26)
  ctx.lineTo(-L * 0.42, W * 0.3)
  ctx.lineTo(-L * 0.42, -W * 0.3)
  ctx.lineTo(L * 0.12, -W * 0.26)
  ctx.closePath()
  ctx.fill()

  // Wings.
  ctx.fillRect(L * 0.42, -W * 0.48, L * 0.08, W * 0.96)
  ctx.fillRect(-L * 0.5, -W * 0.4, L * 0.08, W * 0.8)

  // Cockpit.
  ctx.fillStyle = '#0a0b0e'
  ctx.beginPath()
  ctx.ellipse(-L * 0.02, 0, L * 0.09, W * 0.13, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}
