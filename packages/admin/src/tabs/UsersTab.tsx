import type { UserRecord } from '../types';

interface Props {
  filteredUsers: UserRecord[];
  userSearch: string;
  onUserSearch: (v: string) => void;
  userRoleFilter: string;
  onRoleFilter: (v: string) => void;
  onSelectUser: (u: UserRecord) => void;
  onEditUser: (u: UserRecord) => void;
  onDeleteUser: (id: string) => void;
  onAddUser: () => void;
  onToggleStatus: (u: UserRecord) => void;
}

export default function UsersTab({
  filteredUsers,
  userSearch,
  onUserSearch,
  userRoleFilter,
  onRoleFilter,
  onSelectUser,
  onEditUser,
  onDeleteUser,
  onAddUser,
  onToggleStatus,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search user name or email..."
            value={userSearch}
            onChange={(e) => onUserSearch(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-indigo-500 w-64"
          />
          <select
            value={userRoleFilter}
            onChange={(e) => onRoleFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">Admin</option>
            <option value="CUSTOMER">Customer</option>
            <option value="VENDOR">Vendor</option>
          </select>
        </div>

        <button
          onClick={onAddUser}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md transition flex items-center gap-1.5"
        >
          <span>+ Add New User</span>
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/90 text-slate-400 uppercase font-bold border-b border-slate-700">
            <tr>
              <th className="p-4">User</th>
              <th className="p-4">Role</th>
              <th className="p-4">Shipping City</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60 font-medium">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">No users found matching query.</td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-800 transition">
                  <td className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-700 to-indigo-900 flex items-center justify-center text-white font-bold">
                      {user.firstName[0]}{user.lastName[0]}
                    </div>
                    <div>
                      <span className="font-bold text-white block">{user.firstName} {user.lastName}</span>
                      <span className="text-slate-400 text-[11px]">{user.email}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                      user.role === 'ADMIN'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                        : user.role === 'VENDOR'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="p-4 text-slate-300">
                    {user.addresses[0]?.city || 'N/A'}, {user.addresses[0]?.state || 'N/A'}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => onToggleStatus(user)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition ${
                        user.isActive
                          ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                      }`}
                    >
                      {user.isActive ? '● Active' : '○ Suspended'}
                    </button>
                  </td>
                  <td className="p-4 text-right space-x-2">
                    <button
                      onClick={() => onSelectUser(user)}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2.5 py-1 rounded-lg"
                    >
                      View
                    </button>
                    <button
                      onClick={() => onEditUser(user)}
                      className="text-xs bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 px-2.5 py-1 rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDeleteUser(user.id)}
                      className="text-xs bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 px-2.5 py-1 rounded-lg"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
