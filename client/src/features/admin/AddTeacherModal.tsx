import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import {
  X,
  UserPlus,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  Building,
  Mail,
  User,
  Key,
} from 'lucide-react';
import { ProvisionTeacherResponse } from '@linkup/shared';

interface AddTeacherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credentials: {
    fullName: string;
    email: string;
    temporaryPassword?: string;
    department?: string;
  }) => void;
}

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  let pwd = '';
  // Ensure at least 1 uppercase, 1 lowercase, 1 digit, 1 special char
  pwd += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)];
  pwd += 'abcdefghijkmnpqrstuvwxyz'[Math.floor(Math.random() * 24)];
  pwd += '23456789'[Math.floor(Math.random() * 8)];
  pwd += '!@#$%^&*'[Math.floor(Math.random() * 8)];
  for (let i = 4; i < 12; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

export const AddTeacherModal: React.FC<AddTeacherModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [department, setDepartment] = useState('');
  const [preApprove, setPreApprove] = useState(true);

  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Initialize form with auto-generated secure password when modal opens
  useEffect(() => {
    if (isOpen) {
      setFullName('');
      setEmail('');
      setPassword(generateSecurePassword());
      setDepartment('');
      setPreApprove(true);
      setEmailError(null);
      setGeneralError(null);
      setCopied(false);
      setShowPassword(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGeneratePassword = () => {
    const newPwd = generateSecurePassword();
    setPassword(newPwd);
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setGeneralError(null);

    // Validation
    if (!fullName.trim()) {
      setGeneralError('Full Name is required.');
      return;
    }

    if (!email.trim()) {
      setEmailError('Institutional Email is required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setEmailError('Please enter a valid institutional email address.');
      return;
    }

    if (!password || password.length < 8) {
      setGeneralError('Password must be at least 8 characters long.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        department: department.trim() || undefined,
        preApprove,
      };

      // AC 3.3.2: POST /api/admin/teachers/provision
      const res = await api.post<ProvisionTeacherResponse>(
        '/api/admin/teachers/provision',
        payload
      );

      const returnedPassword =
        res?.credentials?.temporaryPassword ||
        res?.teacher?.temporaryPassword ||
        password;

      onSuccess({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        temporaryPassword: returnedPassword,
        department: department.trim() || undefined,
      });

      onClose();
    } catch (err: any) {
      console.warn('[AddTeacherModal] Error provisioning teacher:', err);

      // AC 3.3.3: Inline duplicate email error handling
      const errorMessage =
        err?.data?.error?.message ||
        err?.message ||
        '';

      if (
        err?.status === 409 ||
        err?.code === 'DUPLICATE_EMAIL' ||
        errorMessage.toLowerCase().includes('already exists') ||
        errorMessage.toLowerCase().includes('already registered')
      ) {
        setEmailError('A user with this email address already exists in the system.');
      } else {
        setGeneralError(
          errorMessage || 'Failed to create teacher account. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-teacher-modal-title"
    >
      <div className="glass-panel w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] shadow-2xl overflow-hidden animate-scaleUp">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="add-teacher-modal-title"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-white"
              >
                Direct Teacher Provisioning
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create pre-approved instructor account with instant permissions.
              </p>
            </div>
          </div>
          <button
            id="close-add-teacher-modal-btn"
            data-testid="close-add-teacher-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {generalError && (
            <div
              id="general-provision-error"
              className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 flex items-center gap-2 font-medium"
            >
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span>{generalError}</span>
            </div>
          )}

          {/* Full Name (Required) */}
          <div>
            <label
              htmlFor="teacher-fullname-input"
              className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Full Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="teacher-fullname-input"
                data-testid="teacher-fullname-input"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. Jane Smith"
                className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>

          {/* Institutional Email (Required) */}
          <div>
            <label
              htmlFor="teacher-email-input"
              className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Institutional Email <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="teacher-email-input"
                data-testid="teacher-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                placeholder="teacher.jane@university.edu"
                className={`w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border ${
                  emailError
                    ? 'border-red-500 focus:ring-red-500 text-red-900 dark:text-red-200'
                    : 'border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-indigo-500'
                } placeholder-slate-400 focus:outline-none focus:ring-2 transition-all`}
              />
            </div>
            {/* AC 3.3.3: Inline error for duplicate email */}
            {emailError && (
              <p
                id="email-duplicate-error"
                data-testid="duplicate-email-error"
                className="mt-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 animate-fadeIn"
              >
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{emailError}</span>
              </p>
            )}
          </div>

          {/* Temporary Password with Generate/Copy helper (AC 3.3.1) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="teacher-password-input"
                className="font-semibold text-slate-700 dark:text-slate-300"
              >
                Temporary Password <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="generate-password-btn"
                  data-testid="generate-password-btn"
                  onClick={handleGeneratePassword}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Generate New</span>
                </button>
                <button
                  type="button"
                  id="copy-password-btn"
                  data-testid="copy-password-btn"
                  onClick={handleCopyPassword}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span className="text-emerald-500">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="relative">
              <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="teacher-password-input"
                data-testid="teacher-password-input"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Generated secure temporary password"
                className="w-full pl-9 pr-10 py-2 rounded-xl text-xs font-mono bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Faculty member can reset this password upon initial login.
            </p>
          </div>

          {/* Department / Subject (Optional) */}
          <div>
            <label
              htmlFor="teacher-department-input"
              className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Department / Subject <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="teacher-department-input"
                data-testid="teacher-department-input"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Computer Science & AI"
                className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>

          {/* Checkbox: Pre-approve immediately (AC 3.3.1 - checked by default) */}
          <div className="pt-2">
            <label
              htmlFor="teacher-preapprove-checkbox"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 cursor-pointer hover:border-indigo-500/50 transition-colors"
            >
              <input
                id="teacher-preapprove-checkbox"
                data-testid="teacher-preapprove-checkbox"
                type="checkbox"
                checked={preApprove}
                onChange={(e) => setPreApprove(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
              />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Pre-approve immediately
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Bypasses the teacher verification queue and enables immediate room hosting privileges.
                </p>
              </div>
            </label>
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200/80 dark:border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="submit-add-teacher-btn"
              data-testid="submit-add-teacher-btn"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Provisioning Account...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Create Teacher Account</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
