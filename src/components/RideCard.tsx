import { Car, Calendar, Clock, X } from 'lucide-react'

interface Props {
  title: string
  date: string
  time: string
  meta?: string
  onCancel?: () => void
}

export default function RideCard({ title, date, time, meta, onCancel }: Props) {
  return (
    <div className="ride-card">
      <div className="ride-card-icon">
        <Car size={18} />
      </div>
      <div className="ride-card-body">
        <p className="ride-card-title">{title}</p>
        <div className="ride-card-meta">
          <span>
            <Calendar size={12} /> {date}
          </span>
          <span>
            <Clock size={12} /> {time}
          </span>
        </div>
        {meta && (
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {meta}
          </p>
        )}
      </div>
      {onCancel && (
        <button className="ghost ride-card-cancel" onClick={onCancel} aria-label="Cancel ride">
          <X size={16} />
        </button>
      )}
    </div>
  )
}
