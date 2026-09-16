import type { ServiceItem } from '../types'

interface Props {
  service: ServiceItem | null
  onClose: () => void
}

export default function ServiceModal({ service, onClose }: Props) {
  if (!service) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {service.name} <span className="chip chip-blue mono">:{service.port}</span>
          </h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Service Role & Ingress</label>
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{service.role}</div>
          </div>
          <div className="form-group">
            <label>Raw Health Response Payload</label>
            <pre
              style={{
                background: 'var(--bg)',
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'var(--green-light)',
                overflowX: 'auto',
                maxHeight: 280,
              }}
            >
              {JSON.stringify(
                service.details ?? { status: service.status, port: service.port },
                null,
                2
              )}
            </pre>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Close Inspector
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
