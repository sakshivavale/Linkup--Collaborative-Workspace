import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  X, 
  User, 
  Mail, 
  GraduationCap, 
  BookOpen, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Lock,
  Sparkles
} from 'lucide-react';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({ isOpen, onClose }) => {
  const { user, fullName, role, updateProfileName } = useAuth();
  
  const [name, setName] = useState(fullName);
  const [touched, setTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isTeacher = (role || '').toLowerCase() === 'teacher';

  // Synchronize initial value when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(fullName);
      setTouched(false);
      setServerError(null);
      setSuccessMessage(null);
      // Auto-focus input
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, fullName]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Validation logic (US-AUTH-06 Criterion 4)
  const trimmed = name.trim();
  let inlineError: string | null = null;

  if (touched || name !== fullName) {
    if (trimmed.length === 0) {
      inlineError = 'Full name cannot be empty or whitespace only';
    } else if (trimmed.length > 100) {
      inlineError = 'Full name cannot exceed 100 characters';
    }
  }

  const isChanged = trimmed !== fullName && trimmed.length > 0;
  const canSave = isChanged && !inlineError && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (trimmed.length === 0) {
      return;
    }

    if (trimmed.length > 100) {
      return;
    }

    if (!isChanged) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    setServerError(null);
    setSuccessMessage(null);

    const result = await updateProfileName(trimmed);

    setIsSubmitting(false);

    if (result.success) {
      setSuccessMessage('Profile name updated successfully!');
      setTimeout(() => {
        onClose();
      }, 900);
    } else {
      setServerError(result.error || 'Failed to update profile name');
    }
  };

  // Avatar Initials
  const getInitials = (val: string) => {
    const parts = val.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return val.slice(0, 2).toUpperCase() || 'U';
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div 
      id="profile-settings-portal"
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
    >
      {/* Full-viewport Backdrop overlay (z-40) sitting directly below modal content */}
      <div 
        id="profile-settings-backdrop"
        className="fixed inset-0 z-40 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm transition-opacity duration-200 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Centering Wrapper & Modal Dialog (z-50) */}
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        {/* Modal Card */}
        <div 
          className="relative w-full max-w-lg glass-panel rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-[#0c1322]/95 overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Subtle decorative glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-5 border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm shadow-md text-white ${
              isTeacher 
                ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500' 
                : 'bg-gradient-to-tr from-emerald-600 to-teal-500'
            }`}>
              {getInitials(name || fullName)}
            </div>
            <div>
              <h2 id="profile-settings-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Profile Settings
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Update your display name and view account details
              </p>
            </div>
          </div>

          <button
            id="close-profile-settings-btn"
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Alert */}
        {successMessage && (
          <div 
            id="profile-success-alert"
            className="mt-5 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-1"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Server Error Alert */}
        {serverError && (
          <div 
            id="profile-server-error-alert"
            className="mt-5 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Full Name Field (Editable) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="profile-fullname-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-indigo-500" />
                <span>Full Name</span>
                <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[11px] font-mono ${
                name.length > 100 
                  ? 'text-rose-500 font-bold' 
                  : 'text-slate-400 dark:text-slate-500'
              }`}>
                {name.length}/100
              </span>
            </div>

            <div className="relative">
              <input
                ref={inputRef}
                id="profile-fullname-input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setTouched(true);
                  if (serverError) setServerError(null);
                }}
                onBlur={() => setTouched(true)}
                maxLength={120}
                placeholder="Enter your full name"
                className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-900/90 text-slate-900 dark:text-white border transition-all focus:outline-none focus:ring-2 ${
                  inlineError 
                    ? 'border-rose-500 focus:ring-rose-500/30' 
                    : 'border-slate-200 dark:border-slate-800 focus:border-indigo-500 focus:ring-indigo-500/30'
                }`}
                aria-invalid={!!inlineError}
                aria-describedby={inlineError ? 'name-validation-error' : undefined}
              />
            </div>

            {/* US-AUTH-06 Criterion 4: Inline Validation Error */}
            {inlineError && (
              <p 
                id="name-validation-error" 
                role="alert" 
                className="mt-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 animate-in fade-in"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{inlineError}</span>
              </p>
            )}
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              This name will be visible to teachers and peers in classrooms, attendance rosters, and chat.
            </p>
          </div>

          {/* Email Field (Read-only) */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              <span>Email Address</span>
            </label>
            <div className="relative flex items-center">
              <input
                id="profile-email-readonly"
                type="email"
                value={user?.email || ''}
                readOnly
                disabled
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-100/80 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-800/60 cursor-not-allowed select-none"
              />
              <div className="absolute right-3 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                <Lock className="w-3 h-3" />
                <span>Verified</span>
              </div>
            </div>
          </div>

          {/* Role Field (Read-only badge) */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              {isTeacher ? <GraduationCap className="w-3.5 h-3.5 text-indigo-500" /> : <BookOpen className="w-3.5 h-3.5 text-emerald-500" />}
              <span>Account Type</span>
            </label>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className={`capitalize font-bold text-xs px-2.5 py-1 rounded-lg ${
                  isTeacher
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                }`}>
                  {role} Account
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {isTeacher ? 'Host classroom privileges' : 'Participant privileges'}
                </span>
              </div>
              <Sparkles className="w-3.5 h-3.5 text-slate-400" />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-200/80 dark:border-slate-800/80">
            <button
              id="cancel-profile-btn"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              Cancel
            </button>

            <button
              id="save-profile-btn"
              type="submit"
              disabled={!canSave}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>,
    document.body
  );
};
