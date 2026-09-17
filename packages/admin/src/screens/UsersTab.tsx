import { useState } from 'react'
import type { UserRecord } from '../types'
import { StatusBadge, Pagination } from '../components/ui'

interface Props {
  filteredUsers: UserRecord[]
  userSearch: string
  onUserSearch: (val: string) => void
  userRoleFilter: string
  onRoleFilter: (val: string) => void
  onSelectUser: (user: UserRecord) => void
  onEditUser: (user: UserRecord) => void
  onDeleteUser: (id: string) => void
  onAddUser: () => void
  onToggleStatus: (user: UserRecord) => void
}

export default function UsersTab({
  filteredUsers,
  userSearch,
  onUserSearch,
  userRoleFilter,
  onRoleFilter,
  onEditUser,
  onDeleteUser,
  onAddUser,
  onToggleStatus,
}: Props) {
  const [page, setPage] = useState<number>(1)
  const pageSize = 10
  const paginated = filteredUsers.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          Users & Access Control <span className="tag">{filteredUsers.length} Accounts</span>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onAddUser}>
            + Add New User
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Search name or email..."
            value={userSearch}
            onChange={(e) => {
              onUserSearch(e.target.value)
              setPage(1)
            }}
          />
          <div className="filter-tabs">
            {['ALL', 'ADMIN', 'CUSTOMER', 'VENDOR'].map((role) => (
              <button
                key={role}
                className={`filter-tab${userRoleFilter === role ? ' active' : ''}`}
                onClick={() => {
                  onRoleFilter(role)
                  setPage(1)
                }}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Email Status</th>
              <th>Primary Address</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: 'center', padding: 32, color: 'var(--text-faint)' }}
                >
                  No users found matching filter criteria.
                </td>
              </tr>
            ) : (
              paginated.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'var(--blue-bg)',
                          border: '1px solid var(--blue-border)',
                          color: 'var(--blue-light)',
                          fontWeight: 700,
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {u.firstName[0]}
                      </div>
                      <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
                        {u.firstName} {u.lastName}
                      </span>
                    </div>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>
                    {u.email}
                  </td>
                  <td>
                    <span
                      className={`chip ${u.role === 'ADMIN' ? 'chip-purple' : u.role === 'VENDOR' ? 'chip-amber' : 'chip-blue'}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => onToggleStatus(u)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <StatusBadge status={u.isActive ? 'Active' : 'Inactive'} />
                    </button>
                  </td>
                  <td>
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: u.isEmailVerified ? 'var(--green-light)' : 'var(--amber-light)',
                      }}
                    >
                      {u.isEmailVerified ? '✓ Verified' : 'Pending'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    {u.addresses[0]?.city}, {u.addresses[0]?.state}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => onEditUser(u)}>
                        Edit
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => onDeleteUser(u.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pagination
          page={page}
          pageSize={pageSize}
          total={filteredUsers.length}
          onPage={setPage}
          noun="users"
        />
      </div>
    </>
  )
}
