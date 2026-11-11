import type { TrainingSpeed } from '../../workers/trainingProtocol'

export interface SpeedOption {
  value: TrainingSpeed
  label: string
  title: string
}

export const TRAINING_SPEEDS: SpeedOption[] = [
  { value: 1, label: '1×', title: 'Real time' },
  { value: 8, label: '8×', title: 'Eight times real time' },
  { value: 'turbo', label: 'Turbo', title: 'As fast as possible, with minimal drawing' },
]

export const RACE_SPEEDS: SpeedOption[] = [
  { value: 1, label: '1×', title: 'Real time' },
  { value: 3, label: '3×', title: 'Three times real time' },
  { value: 10, label: '10×', title: 'Ten times real time' },
]

interface Props {
  options: SpeedOption[]
  value: TrainingSpeed
  onChange: (value: TrainingSpeed) => void
}

export function SpeedPicker({ options, value, onChange }: Props) {
  return (
    <div className="segmented" role="group" aria-label="Simulation speed">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          title={option.title}
          className={value === option.value ? 'is-active' : undefined}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
