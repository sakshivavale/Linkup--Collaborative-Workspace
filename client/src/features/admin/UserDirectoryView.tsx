import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { socket } from '../../lib/socket';
import { PlatformUserItem } from '@linkup/shared';
import {
  Search,
  Users,
  GraduationCap,
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  UserX,
  UserCheck,
  Edit2,
  X,
  ChevronDown,
} from 'lucide-react';

interface UserDirectoryViewProps {
  onNotify?: (notification: { type: 'success' | 'info' | 'error'; message: string }) => void;
  onRefreshAnalytics?: () => void;
}

export const UserDirectoryView: React.FC<UserDirectoryViewProps> = ({
  onNotify,
  onRefreshAnalytics,
}) => {
  const [users, setUsers] = useState<PlatformUserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter States (AC 3.4.1)
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'STUDENT' | 'TEACHER' | 'ADMIN'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'APPROVED' | 'PENDING' | 'SUSPENDED'>('ALL');

  // Modal States for Role & Suspension (AC 3.4.2, AC 3.4.3)
  const [roleModalUser, setRoleModalUser] = useState<PlatformUserItem | null>(null);
  const [targetRole, setTargetRole] = useState<'STUDENT' | 'TEACHER' | 'ADMIN'>('STUDENT');
  const [suspendModalUser, setSuspendModalUser] = useState<PlatformUserItem | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Debounce search query at 300ms (AC 3.4.1)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Fetch users with active criteria (AC 3.4.1)
  const fetchUsers = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (roleFilter !== 'ALL') params.role = roleFilter;
      if (statusFilter !== 'ALL') params.status = statusFilter;

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/api/admin/users${queryString ? `?${queryString}` : ''}`;
      const data = await api.get<{ users: PlatformUserItem[]; total: number }>(endpoint);

      if (data && Array.isArray(data.users)) {
        setUsers(data.users);
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      console.error('[UserDirectory] Failed to load users:', err);
      setError(err?.message || 'Failed to load user directory.');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Real-time synchronization
  useEffect(() => {
    const handleUserUpdated = () => {
      fetchUsers(true);
    };

    socket.on('user_updated', handleUserUpdated);
    socket.on('teacher_created', handleUserUpdated);
    socket.on('teacher_provisioned', handleUserUpdated);
    socket.on('teacher_verified', handleUserUpdated);

    return () => {
      socket.off('user_updated', handleUserUpdated);
      socket.off('teacher_created', handleUserUpdated);
      socket.off('teacher_provisioned', handleUserUpdated);
      socket.off('teacher_verified', handleUserUpdated);
    };
  }, [fetchUsers]);

  // AC 3.4.2: Submit Role Modification
  const handleConfirmRoleChange = async () => {
    if (!roleModalUser) return;
    setIsProcessingAction(true);
    try {
      await api.patch<{ user: PlatformUserItem }>(
        `/api/admin/users/${roleModalUser.id}/role`,
        { role: targetRole }
      );

      // Optimistic update
      setUsers((prev) =>
        prev.map((u) =>
          u.id === roleModalUser.id
            ? { ...u, role: targetRole, isApproved: true, status: u.status === 'SUSPENDED' ? 'SUSPENDED' : 'APPROVED' }
            : u
        )
      );

      onNotify?.({
        type: 'success',
        message: `Successfully updated ${roleModalUser.fullName}'s role to ${targetRole}.`,
      });
      onRefreshAnalytics?.();
      setRoleModalUser(null);
    } catch (err: any) {
      console.error('[UserDirectory] Role change failed:', err);
      onNotify?.({
        type: 'error',
        message: err?.message || 'Failed to update user role.',
      });
    } finally {
      setIsProcessingAction(false);
    }
  };

  // AC 3.4.3: Submit Account Suspension or Restoration
  const handleConfirmSuspension = async () => {
    if (!suspendModalUser) return;
    setIsProcessingAction(true);
    const targetSuspended = !suspendModalUser.isSuspended;

    try {
      await api.patch<{ user: PlatformUserItem }>(
        `/api/admin/users/${suspendModalUser.id}/status`,
        {
          isSuspended: targetSuspended,
          status: targetSuspended ? 'SUSPENDED' : 'APPROVED',
          action: targetSuspended ? 'suspend' : 'unsuspend',
        }
      );

      // Optimistic update
      setUsers((prev) =>
        prev.map((u) =>
          u.id === suspendModalUser.id
            ? {
                ...u,
                isSuspended: targetSuspended,
                status: targetSuspended ? 'SUSPENDED' : u.isApproved ? 'APPROVED' : 'PENDING',
              }
            : u
        )
      );

      onNotify?.({
        type: targetSuspended ? 'info' : 'success',
        message: targetSuspended
          ? `Account for ${suspendModalUser.fullName} has been suspended.`
          : `Account for ${suspendModalUser.fullName} has been restored.`,
      });
      onRefreshAnalytics?.();
      setSuspendModalUser(null);
    } catch (err: any) {
      console.error('[UserDirectory] Suspension toggle failed:', err);
      onNotify?.({
        type: 'error',
        message: err?.message || 'Failed to update account status.',
      });
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div id="user-directory-section" data-testid="user-directory-section" className="space-y-6">
      {/* Header & Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Platform User Directory
            </h2>
            <span
              id="directory-count-badge"
              data-testid="directory-count-badge"
              className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30"
            >
              {users.length} {users.length === 1 ? 'User' : 'Users'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Search, inspect roles, modify privileges, and manage account statuses across all registered profiles.
          </p>
        </div>

        <button
          onClick={() => fetchUsers(false)}
          disabled={isLoading}
          className="self-start md:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* AC 3.4.1: Search & Multi-Criteria Filtering Controls */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/60 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Debounced Search Box (300ms) */}
          <div className="md:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="user-search-input"
              data-testid="user-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, institutional email, or department..."
              className="w-full pl-10 pr-4 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Role Filter Dropdown */}
          <div className="md:col-span-3">
            <div className="relative">
              <select
                id="role-filter-select"
                data-testid="role-filter-select"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="w-full pl-3 pr-8 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-medium cursor-pointer"
              >
                <option value="ALL">All Roles</option>
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
                <option value="ADMIN">Administrator</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Status Filter Dropdown */}
          <div className="md:col-span-3">
            <div className="relative">
              <select
                id="status-filter-select"
                data-testid="status-filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full pl-3 pr-8 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-medium cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="APPROVED">Approved</option>
                <option value="PENDING">Pending Review</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Active Filter Chips / Reset */}
        {(debouncedSearch || roleFilter !== 'ALL' || statusFilter !== 'ALL') && (
          <div className="flex items-center gap-2 pt-1 flex-wrap text-[11px]">
            <span className="text-slate-400">Active Filters:</span>
            {debouncedSearch && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">
                Query: "{debouncedSearch}"
                <button onClick={() => setSearchQuery('')} className="hover:opacity-75">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {roleFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">
                Role: {roleFilter}
                <button onClick={() => setRoleFilter('ALL')} className="hover:opacity-75">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {statusFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">
                Status: {statusFilter}
                <button onClick={() => setStatusFilter('ALL')} className="hover:opacity-75">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('ALL');
                setStatusFilter('ALL');
              }}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium ml-1"
            >
              Reset All
            </button>
          </div>
        )}
      </div>

      {/* Directory Table View */}
      <div className="glass-panel rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/60 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Loading user directory...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-xs text-slate-600 dark:text-slate-300">{error}</p>
            <button
              onClick={() => fetchUsers(false)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white"
            >
              Try Again
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              No matching users found
            </p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Try adjusting your search criteria or resetting filters to see more profiles.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" id="user-directory-table" data-testid="user-directory-table">
              <thead className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Account Status</th>
                  <th className="py-3.5 px-4">Registered</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                {users.map((user) => {
                  const roleUpper = (user.role || 'STUDENT').toUpperCase();
                  const isSuspended = user.isSuspended || user.status === 'SUSPENDED';

                  return (
                    <tr
                      key={user.id}
                      id={`user-row-${user.id}`}
                      data-testid={`user-row-${user.id}`}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* User Info Column */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                              roleUpper === 'ADMIN'
                                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                : roleUpper === 'TEACHER'
                                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            }`}
                          >
                            {user.fullName?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{user.fullName}</span>
                              {roleUpper === 'ADMIN' && (
                                <span title="Administrator">
                                  <Shield className="w-3 h-3 text-purple-500" />
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 select-all">
                              {user.email}
                            </div>
                            {user.department && (
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {user.department}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* AC 3.4.2: Role Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          id={`user-role-badge-${user.id}`}
                          data-testid={`user-role-badge-${user.id}`}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            roleUpper === 'ADMIN'
                              ? 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30'
                              : roleUpper === 'TEACHER'
                              ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'
                              : 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30'
                          }`}
                        >
                          {roleUpper === 'ADMIN' ? (
                            <Shield className="w-3 h-3" />
                          ) : roleUpper === 'TEACHER' ? (
                            <GraduationCap className="w-3 h-3" />
                          ) : (
                            <Users className="w-3 h-3" />
                          )}
                          <span>{roleUpper}</span>
                        </span>
                      </td>

                      {/* AC 3.4.3: Status Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          id={`user-status-badge-${user.id}`}
                          data-testid={`user-status-badge-${user.id}`}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            isSuspended
                              ? 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30'
                              : user.status === 'PENDING' || !user.isApproved
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                          }`}
                        >
                          {isSuspended ? (
                            <>
                              <ShieldAlert className="w-3 h-3 text-red-500" />
                              <span>Suspended</span>
                            </>
                          ) : user.status === 'PENDING' || !user.isApproved ? (
                            <>
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                              <span>Pending Review</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              <span>Approved</span>
                            </>
                          )}
                        </span>
                      </td>

                      {/* Registered Date */}
                      <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {user.createdAt
                          ? new Date(user.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>

                      {/* Action Controls */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* AC 3.4.2: Change Role Trigger */}
                          <button
                            id={`change-role-btn-${user.id}`}
                            data-testid={`change-role-btn-${user.id}`}
                            onClick={() => {
                              setRoleModalUser(user);
                              setTargetRole(
                                roleUpper === 'STUDENT'
                                  ? 'TEACHER'
                                  : roleUpper === 'TEACHER'
                                  ? 'STUDENT'
                                  : 'TEACHER'
                              );
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                            title="Modify user role"
                          >
                            <Edit2 className="w-3 h-3 text-slate-500" />
                            <span>Change Role</span>
                          </button>

                          {/* AC 3.4.3: Suspend / Unsuspend Trigger */}
                          <button
                            id={`suspend-btn-${user.id}`}
                            data-testid={`suspend-btn-${user.id}`}
                            onClick={() => setSuspendModalUser(user)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              isSuspended
                                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                : 'bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300'
                            }`}
                            title={isSuspended ? 'Restore account access' : 'Suspend user account'}
                          >
                            {isSuspended ? (
                              <>
                                <UserCheck className="w-3 h-3 text-emerald-600" />
                                <span>Restore</span>
                              </>
                            ) : (
                              <>
                                <UserX className="w-3 h-3 text-red-600" />
                                <span>Suspend</span>
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AC 3.4.2: Change Role Confirmation Dialog Modal */}
      {roleModalUser && (
        <div
          id="change-role-modal"
          data-testid="change-role-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-panel w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] shadow-2xl overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Edit2 className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Change User Role
                </h3>
              </div>
              <button
                onClick={() => setRoleModalUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-1">Target Account</span>
                <p className="font-bold text-slate-900 dark:text-white text-sm">
                  {roleModalUser.fullName}
                </p>
                <p className="text-slate-500 dark:text-slate-400">{roleModalUser.email}</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Select New Role:
                </label>
                <div className="space-y-2">
                  {(['STUDENT', 'TEACHER', 'ADMIN'] as const).map((r) => (
                    <label
                      key={r}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                        targetRole === r
                          ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-200'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name="roleSelection"
                          value={r}
                          checked={targetRole === r}
                          onChange={() => setTargetRole(r)}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-bold">{r}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {r === 'TEACHER'
                          ? 'Hosts live rooms & whiteboard'
                          : r === 'ADMIN'
                          ? 'Full administrative control'
                          : 'Attends live classrooms'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {targetRole === 'TEACHER' && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-[11px]">
                  <span className="font-bold block">Instant Privilege Grant:</span>
                  Assigning role <strong>TEACHER</strong> automatically sets status to Approved and unlocks room creation privileges (/create-room) immediately.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200/80 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-900/30">
              <button
                type="button"
                onClick={() => setRoleModalUser(null)}
                disabled={isProcessingAction}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                id="confirm-change-role-btn"
                data-testid="confirm-change-role-btn"
                onClick={handleConfirmRoleChange}
                disabled={isProcessingAction}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {isProcessingAction ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Updating...</span>
                  </>
                ) : (
                  <span>Update Role</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AC 3.4.3: Suspend / Unsuspend Confirmation Dialog Modal */}
      {suspendModalUser && (
        <div
          id="suspend-account-modal"
          data-testid="suspend-account-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-panel w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] shadow-2xl overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-xl ${
                    suspendModalUser.isSuspended
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-red-500/10 text-red-600'
                  }`}
                >
                  {suspendModalUser.isSuspended ? (
                    <UserCheck className="w-4 h-4" />
                  ) : (
                    <ShieldAlert className="w-4 h-4" />
                  )}
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {suspendModalUser.isSuspended ? 'Restore Account' : 'Suspend Account'}
                </h3>
              </div>
              <button
                onClick={() => setSuspendModalUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-3 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                Are you sure you want to {suspendModalUser.isSuspended ? 'restore' : 'suspend'}{' '}
                <strong>{suspendModalUser.fullName}</strong> ({suspendModalUser.email})?
              </p>

              {!suspendModalUser.isSuspended ? (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-800 dark:text-red-200 text-[11px] space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" />
                    <span>Consequences of Suspension (AC 3.4.3):</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li>Active sessions will be immediately terminated.</li>
                    <li>Subsequent requests will be blocked with HTTP 403 (ACCOUNT_SUSPENDED).</li>
                    <li>The user will be barred from joining or hosting rooms.</li>
                  </ul>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-[11px]">
                  Restoring this account will unlock platform access and allow the user to log in and participate normally.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200/80 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-900/30">
              <button
                type="button"
                onClick={() => setSuspendModalUser(null)}
                disabled={isProcessingAction}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                id="confirm-suspend-btn"
                data-testid="confirm-suspend-btn"
                onClick={handleConfirmSuspension}
                disabled={isProcessingAction}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 ${
                  suspendModalUser.isSuspended
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {isProcessingAction ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <span>{suspendModalUser.isSuspended ? 'Restore Account' : 'Suspend Account'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
