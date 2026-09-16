import type { UserRecord } from '../types';

interface Props {
  user: UserRecord | null;
  onClose: () => void;
}

export default function UserViewModal({ user, onClose }: Props) {
  if (!user) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
          <h3 className="font-bold text-base text-white">User Profile &amp; Addresses</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div>
              <h4 className="font-bold text-sm text-white">{user.firstName} {user.lastName}</h4>
              <p className="text-slate-400">{user.email}</p>
            </div>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">User ID:</span>
              <span className="font-mono text-slate-300">{user.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Role:</span>
              <span className="font-bold text-purple-400">{user.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email Status:</span>
              <span className="font-bold text-emerald-400">{user.isEmailVerified ? 'Verified ✓' : 'Pending'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Primary Address:</span>
              <span className="text-right text-slate-300">
                {user.addresses[0]?.addressLine1}, {user.addresses[0]?.city} {user.addresses[0]?.state}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
