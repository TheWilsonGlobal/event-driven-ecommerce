import React from 'react';
import type { UserRecord } from '../types';

interface Props {
  isOpen: boolean;
  editingUser: UserRecord | null;
  onClose: () => void;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
}

export default function UserFormModal({ isOpen, editingUser, onClose, onSave }: Props) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
          <h3 className="font-bold text-base text-white">
            {editingUser ? 'Edit User Account' : 'Create New User Account'}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">First Name</label>
              <input
                name="firstName"
                defaultValue={editingUser?.firstName || ''}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Last Name</label>
              <input
                name="lastName"
                defaultValue={editingUser?.lastName || ''}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Email Address</label>
            <input
              name="email"
              type="email"
              defaultValue={editingUser?.email || ''}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">Role</label>
              <select
                name="role"
                defaultValue={editingUser?.role || 'CUSTOMER'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
              >
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="VENDOR">VENDOR</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked={editingUser ? editingUser.isActive : true}
                id="isActive"
                className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700"
              />
              <label htmlFor="isActive" className="text-slate-300 font-semibold cursor-pointer">
                Active Account
              </label>
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Street Address</label>
            <input
              name="addressLine1"
              defaultValue={editingUser?.addresses[0]?.addressLine1 || '100 Silicon Way'}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">City</label>
              <input
                name="city"
                defaultValue={editingUser?.addresses[0]?.city || 'San Francisco'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">State</label>
              <input
                name="state"
                defaultValue={editingUser?.addresses[0]?.state || 'CA'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Postal Code</label>
              <input
                name="postalCode"
                defaultValue={editingUser?.addresses[0]?.postalCode || '94105'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3 rounded-xl shadow-lg transition mt-4"
          >
            {editingUser ? 'Save Changes' : 'Create User'}
          </button>
        </form>
      </div>
    </div>
  );
}
