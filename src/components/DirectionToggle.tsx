import type { Direction } from '../types'

interface Props {
  value: Direction
  onChange: (value: Direction) => void
}

export default function DirectionToggle({ value, onChange }: Props) {
  return (
    <div style={{ display: 'flex', border: '0.5px solid var(--border-strong)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {(['to_shuttle', 'from_shuttle'] as Direction[]).map((option) => {
        const active = value === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            style={{
              flex: 1,
              borderRadius: 0,
              border: 'none',
              background: active ? 'var(--bg-accent)' : 'transparent',
              color: active ? 'var(--text-accent)' : 'var(--text-secondary)'
            }}
          >
            {option === 'to_shuttle' ? 'To shuttle' : 'From shuttle'}
          </button>
        )
      })}
    </div>
  )
}
