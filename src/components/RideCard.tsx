interface Props {
  title: string
  subtitle: string
  onCancel?: () => void
  cancelLabel?: string
}

export default function RideCard({ title, subtitle, onCancel, cancelLabel }: Props) {
  return (
    <div
      style={{
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '10px 12px',
        marginBottom: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--surface-2)'
      }}
    >
      <div>
        <p style={{ fontSize: 13, margin: 0 }}>{title}</p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{subtitle}</p>
      </div>
      {onCancel && (
        <button
          className="ghost"
          onClick={onCancel}
          aria-label={cancelLabel ?? 'Cancel ride'}
          style={{ height: 'auto', padding: 4, color: 'var(--text-muted)' }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
