import { useState, useMemo, useEffect, useCallback } from 'react'
import type { UserRecord } from '../../types'
import { USER_SERVICE_URL } from '../../data/serviceUrls'
import { FETCH_ALL_LIMIT, mapUser } from './mappers'

export function useUsers(showToast: (msg: string) => void) {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [usersLoading, setUsersLoading] = useState<boolean>(true)
  const [usersError, setUsersError] = useState<string | null>(null)

  // Modal & selection state
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)

  // Filters
  const [userSearch, setUserSearch] = useState<string>('')
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL')

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/v1/users?page=1&limit=${FETCH_ALL_LIMIT}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setUsers((data.users ?? []).map(mapUser))
    } catch (err) {
      setUsersError(
        err instanceof Error ? err.message : 'Failed to load users — is ms-user (5463) running?'
      )
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  const handleSaveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const firstName = formData.get('firstName') as string
    const lastName = formData.get('lastName') as string
    const email = formData.get('email') as string
    const role = formData.get('role') as 'ADMIN' | 'CUSTOMER' | 'VENDOR'
    const isActive = formData.get('isActive') === 'on'
    const addressLine1 = formData.get('addressLine1') as string
    const city = formData.get('city') as string
    const state = formData.get('state') as string
    const postalCode = formData.get('postalCode') as string

    // Close immediately (fire-and-forget) — the list re-fetch below updates
    // the table a moment later once the request resolves. Matches the modal's
    // existing behavior of closing on submit rather than gating on a result.
    setIsUserModalOpen(false)
    setEditingUser(null)

    try {
      if (editingUser) {
        const res = await fetch(`${USER_SERVICE_URL}/api/v1/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName, lastName, role, isActive }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message ?? `HTTP ${res.status}`)
        }
        showToast(`User ${firstName} updated!`)
      } else {
        const res = await fetch(`${USER_SERVICE_URL}/api/v1/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            firstName,
            lastName,
            role,
            isActive,
            addressLine1,
            city,
            state,
            postalCode,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message ?? `HTTP ${res.status}`)
        }
        showToast(`User ${firstName} created!`)
      }
      await fetchUsers()
    } catch (err) {
      showToast(`Failed to save user: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/v1/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      showToast('User deleted')
      await fetchUsers()
    } catch (err) {
      showToast(`Failed to delete user: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleToggleUserStatus = async (user: UserRecord) => {
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/v1/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      showToast(`User ${user.firstName} status toggled`)
      await fetchUsers()
    } catch (err) {
      showToast(
        `Failed to toggle user status: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matches =
        u.firstName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.lastName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase())
      const roleMatch = userRoleFilter === 'ALL' || u.role === userRoleFilter
      return matches && roleMatch
    })
  }, [users, userSearch, userRoleFilter])

  return {
    users,
    usersLoading,
    usersError,
    fetchUsers,
    selectedUser,
    setSelectedUser,
    isUserModalOpen,
    setIsUserModalOpen,
    editingUser,
    setEditingUser,
    userSearch,
    setUserSearch,
    userRoleFilter,
    setUserRoleFilter,
    filteredUsers,
    handleSaveUser,
    handleDeleteUser,
    handleToggleUserStatus,
  }
}
