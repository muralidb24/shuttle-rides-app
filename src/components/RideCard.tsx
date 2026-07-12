import { Car, Calendar, Clock, Mail, X } from 'lucide-react'

interface Contact {
  name: string
  email: string
}

interface Props {
  title: string
  date: string
  time: string
  meta?: string
  contact?: Contact
  onCancel?: () => void
  cancelLabel?: string
}

export default function RideCard({ title, date, time, meta, contact, onCancel, cancelLabel }: Props) {
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
        {contact && (
          <a
            href={`mailto:${contact.email}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-accent)', marginTop: 4 }}
          >
            <Mail size={12} /> Contact {contact.name.split(' ')[0]}
          </a>
        )}
      </div>
      {onCancel && (
        <button className="ghost ride-card-cancel" onClick={onCancel} aria-label={cancelLabel ?? 'Cancel ride'}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}
