import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Mic, 
  Video, 
  MonitorUp, 
  PenTool, 
  Code2, 
  Loader2, 
  AlertCircle, 
  PlusCircle,
  GraduationCap,
  Shield,
  CheckCircle2
} from 'lucide-react';
import { api, HttpError } from '../../lib/api';
import { Room, Permissions, PermissionKey } from '@linkup/shared';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (room: Room) => void;
}

const DEFAULT_PERMISSIONS: Permissions = {
  canMic: false,
  canCamera: false,
  canScreen: false,
  canWhiteboard: false,
  canCode: false,
};

interface PermissionItem {
  key: PermissionKey;
  label: string;
  description: string;
  icon: React.ElementType;
}

const PERMISSION_CONFIGS: PermissionItem[] = [
  {
    key: 'canMic',
    label: 'Microphone',
    description: 'Allow students to unmute and speak during the session',
    icon: Mic,
  },
  {
    key: 'canCamera',
    label: 'Camera Video',
    description: 'Allow students to stream their webcam video feed',
    icon: Video,
  },
  {
    key: 'canScreen',
    label: 'Screen Sharing',
    description: 'Allow students to present their screen to the room',
    icon: MonitorUp,
  },
  {
    key: 'canWhiteboard',
    label: 'Shared Whiteboard',
    description: 'Allow students to draw and annotate on the canvas',
    icon: PenTool,
  },
  {
    key: 'canCode',
    label: 'Collaborative Code',
    description: 'Allow students to write and run code in the editor',
    icon: Code2,
  },
];

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [touchedName, setTouchedName] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset form and focus on open
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setPermissions(DEFAULT_PERMISSIONS);
      setTouchedName(false);
      setIsSubmitting(false);
      setErrorMessage(null);

      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  // Validation rules (US-DASH-03 Acceptance Criterion 2)
  const trimmedName = name.trim();
  const nameLength = trimmedName.length;
  let nameError: string | null = null;
  if (touchedName) {
    if (nameLength === 0) {
      nameError = 'Room name is required';
    } else if (nameLength > 80) {
      nameError = 'Room name cannot exceed 80 characters';
    }
  }

  const descLength = description.trim().length;
  let descError: string | null = null;
  if (descLength > 500) {
    descError = 'Description cannot exceed 500 characters';
  }

  const isFormValid = nameLength >= 1 && nameLength <= 80 && descLength <= 500;

  const handleTogglePermission = (key: PermissionKey) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSetAllPermissions = (value: boolean) => {
    setPermissions({
      canMic: value,
      canCamera: value,
      canScreen: value,
      canWhiteboard: value,
      canCode: value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedName(true);

    if (!isFormValid) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: trimmedName,
        description: description.trim() || undefined,
        defaultPermissions: permissions,
      };

      const createdRoom = await api.post<Room>('/api/rooms', payload);
      onSuccess(createdRoom);
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        if (err.status === 403) {
          setErrorMessage('Permission denied: Only teachers can create classroom rooms (TEACHER_ONLY).');
        } else if (err.status === 400) {
          setErrorMessage(err.data?.error?.message || 'Invalid room parameters. Please check room name and description.');
        } else {
          setErrorMessage(err.data?.error?.message || 'Failed to create room. Please try again.');
        }
      } else {
        setErrorMessage('An unexpected network error occurred while creating the room.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
    >
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden z-10 my-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-sm">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 
                  id="create-room-modal-title" 
                  className="text-lg font-bold text-slate-900 dark:text-white"
                >
                  Create a Room
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/20">
                  <GraduationCap className="w-3 h-3" /> Teacher Only
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set up a new workspace before inviting students with a 6-character code
              </p>
            </div>
          </div>

          <button
            id="close-create-room-modal-btn"
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Close modal (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Server Error Alert */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {/* Room Name Input (required, max 80 chars) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label 
                htmlFor="create-room-name-input"
                className="text-xs font-bold text-slate-800 dark:text-slate-200"
              >
                Room Name <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[11px] font-mono ${name.length > 80 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                {name.length}/80
              </span>
            </div>
            <input
              id="create-room-name-input"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!touchedName) setTouchedName(true);
              }}
              onBlur={() => setTouchedName(true)}
              placeholder="e.g. CS101: Data Structures & Algorithms"
              maxLength={100}
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/60 border ${
                nameError 
                  ? 'border-rose-300 dark:border-rose-500/50 focus:ring-rose-500' 
                  : 'border-slate-200 dark:border-slate-700 focus:ring-indigo-500'
              } text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all`}
            />
            {nameError && (
              <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{nameError}</span>
              </p>
            )}
          </div>

          {/* Description Textarea (optional, max 500 chars) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label 
                htmlFor="create-room-desc-input"
                className="text-xs font-bold text-slate-800 dark:text-slate-200"
              >
                Description <span className="text-slate-400 font-normal text-[11px]">(Optional)</span>
              </label>
              <span className={`text-[11px] font-mono ${description.length > 500 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                {description.length}/500
              </span>
            </div>
            <textarea
              id="create-room-desc-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of lectures, lab instructions, or syllabus topics..."
              maxLength={600}
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/60 border ${
                descError
                  ? 'border-rose-300 dark:border-rose-500/50 focus:ring-rose-500'
                  : 'border-slate-200 dark:border-slate-700 focus:ring-indigo-500'
              } text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all resize-none`}
            />
            {descError && (
              <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{descError}</span>
              </p>
            )}
          </div>

          {/* 5 Default Permission Toggles (Mic, Camera, Screen, Whiteboard, Code) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Default Student Permissions
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Initial capabilities granted to students when they join this room.
                </p>
              </div>

              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleSetAllPermissions(true)}
                  className="px-2 py-0.5 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 font-medium transition-colors"
                >
                  Enable All
                </button>
                <span className="text-slate-300 dark:text-slate-700">&bull;</span>
                <button
                  type="button"
                  onClick={() => handleSetAllPermissions(false)}
                  className="px-2 py-0.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors"
                >
                  Restrict All
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {PERMISSION_CONFIGS.map(({ key, label, description: desc, icon: Icon }) => {
                const isEnabled = permissions[key];
                return (
                  <div
                    key={key}
                    onClick={() => handleTogglePermission(key)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isEnabled
                        ? 'bg-indigo-50/70 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30'
                        : 'bg-slate-50/50 dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                          isEnabled
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          {label}
                          {isEnabled && (
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                              Allowed
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                          {desc}
                        </div>
                      </div>
                    </div>

                    {/* Switch Toggle Button */}
                    <button
                      type="button"
                      id={`perm-toggle-${key}`}
                      aria-label={`Toggle ${label}`}
                      aria-checked={isEnabled}
                      role="switch"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePermission(key);
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        isEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          isEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notice about join code */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/10 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Upon creation, LinkUp will automatically generate a unique <strong>6-character join code</strong> (no ambiguous characters like 0, O, 1, or I) for you to share with your students.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
            <button
              id="cancel-create-room-btn"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              id="submit-create-room-btn"
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-md shadow-indigo-600/25"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Room...</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Create Room</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
