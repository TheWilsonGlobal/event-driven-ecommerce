import type { UserRecord } from '../types'

interface Props {
  isOpen: boolean
  editingUser: UserRecord | null
  onClose: () => void
  onSave: (e: React.FormEvent<HTMLFormElement>) => void
}

export default function UserModal({ isOpen, editingUser, onClose, onSave }: Props) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editingUser ? 'Edit User Account' : 'Create New User Account'}</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={onSave} className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input
                name="firstName"
                defaultValue={editingUser?.firstName ?? ''}
                required
                className="input-field"
                placeholder="Alex"
              />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input
                name="lastName"
                defaultValue={editingUser?.lastName ?? ''}
                required
                className="input-field"
                placeholder="Morgan"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Email Address</label>
            <input
              name="email"
              type="email"
              defaultValue={editingUser?.email ?? ''}
              required
              className="input-field"
              placeholder="alex@ecommerce.com"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Role</label>
              <select
                name="role"
                defaultValue={editingUser?.role ?? 'CUSTOMER'}
                className="input-field"
              >
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="VENDOR">VENDOR</option>
              </select>
            </div>
            <div className="form-group" style={{ justifyContent: 'center', paddingTop: 18 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  name="isActive"
                  type="checkbox"
                  defaultChecked={editingUser ? editingUser.isActive : true}
                  style={{ width: 16, height: 16, accentColor: 'var(--blue)' }}
                />
                <span style={{ fontSize: 12, textTransform: 'none', color: 'var(--text-bright)' }}>
                  Active Account
                </span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label>Street Address</label>
            <input
              name="addressLine1"
              defaultValue={editingUser?.addresses[0]?.addressLine1 ?? '100 Silicon Valley Way'}
              className="input-field"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>City</label>
              <input
                name="city"
                defaultValue={editingUser?.addresses[0]?.city ?? 'San Francisco'}
                className="input-field"
              />
            </div>
            <div className="form-group">
              <label>State & Postal Code</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6 }}>
                <input
                  name="state"
                  defaultValue={editingUser?.addresses[0]?.state ?? 'CA'}
                  className="input-field"
                />
                <input
                  name="postalCode"
                  defaultValue={editingUser?.addresses[0]?.postalCode ?? '94105'}
                  className="input-field mono"
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {editingUser ? 'Save User' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
