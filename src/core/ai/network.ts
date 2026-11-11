/**
 * Small fully connected feed-forward network with tanh-like activations.
 *
 * A network is just a slice of a flat Float32Array ("genome"): for every layer,
 * each output neuron stores its bias followed by one weight per input. Keeping
 * whole populations in one typed array makes them cheap to evolve and to hand
 * to a Web Worker.
 */
export interface NetworkLayout {
  /** Neurons per layer, from inputs to outputs. */
  sizes: readonly number[]
  /** Number of floats one network occupies. */
  weightCount: number
  /** Widest layer, used to size scratch buffers. */
  maxWidth: number
}

export function createLayout(sizes: readonly number[]): NetworkLayout {
  let weightCount = 0
  for (let l = 0; l < sizes.length - 1; l++) weightCount += (sizes[l] + 1) * sizes[l + 1]
  return { sizes, weightCount, maxWidth: Math.max(...sizes) }
}

/**
 * Activation function: a rational approximation of tanh (within about 2%).
 * Pure arithmetic is several times faster than Math.tanh, and it removes one
 * place where JavaScript engines are allowed to round differently.
 */
export function squash(x: number): number {
  if (x >= 3) return 1
  if (x <= -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

export interface NetworkScratch {
  a: Float32Array
  b: Float32Array
}

export function createScratch(layout: NetworkLayout): NetworkScratch {
  return { a: new Float32Array(layout.maxWidth), b: new Float32Array(layout.maxWidth) }
}

/**
 * Runs the network stored at `weights[offset ...]` on `input` and writes the
 * activations of the last layer to `output`. Allocation-free.
 */
export function forward(
  layout: NetworkLayout,
  weights: Float32Array,
  offset: number,
  input: Float32Array,
  scratch: NetworkScratch,
  output: Float32Array,
): void {
  const { sizes } = layout
  let current = input
  let next = scratch.a
  let p = offset
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l]
    const nOut = sizes[l + 1]
    for (let j = 0; j < nOut; j++) {
      let sum = weights[p++]
      for (let i = 0; i < nIn; i++) sum += weights[p++] * current[i]
      next[j] = squash(sum)
    }
    current = next
    next = current === scratch.a ? scratch.b : scratch.a
  }
  const nOut = sizes[sizes.length - 1]
  for (let j = 0; j < nOut; j++) output[j] = current[j]
}
