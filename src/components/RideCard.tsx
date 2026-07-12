import { Car, Calendar, CheckCircle2, Clock, Mail, X } from 'lucide-react'

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
  confirmedContact?: Contact
  onCancel?: () => void
  cancelLabel?: string
}

export default function RideCard({ title, date, time, meta, contact, confirmedContact, onCancel, cancelLabel }: Props) {
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
        {confirmedContact ? (
          <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success, #1a9e5c)', margin: '2px 0 0' }}>
            <CheckCircle2 size={13} />
            <span style={{ color: 'var(--text-secondary)' }}>
              {confirmedContact.name} ({confirmedContact.email})
            </span>
          </p>
        ) : (
          meta && (
            <p className="hint" style={{ margin: '2px 0 0' }}>
              {meta}
            </p>
          )
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
