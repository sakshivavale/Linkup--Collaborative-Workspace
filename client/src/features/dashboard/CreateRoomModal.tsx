import React, { useState, useEffect, useRef } from 'react';
import { api, HttpError } from '../../lib/api';
import { Room, Permissions, PermissionKey } from '@linkup/shared';
import {
  X,
  Mic,
  Video,
  MonitorUp,
  PenTool,
  Code2,
  Loader2,
  PlusCircle,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (room: Room) => void;
}

const DEFAULT_PERMISSIONS: Permissions = {
  canMic: true,
  canCamera: true,
  canScreen: false,
  canWhiteboard: false,
  canCode: true,
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
    label: 'Microphone Audio',
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
    label: 'Interactive Whiteboard',
    description: 'Allow students to draw and annotate on the shared canvas',
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
      nameError = 'Room name is required and cannot be empty';
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

    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: trimmedName,
        description: description.trim() ? description.trim() : null,
        defaultPermissions: permissions,
      };

      const newRoom = await api.post<Room>('/api/rooms', payload);
      onSuccess(newRoom);
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        if (err.status === 403) {
          setErrorMessage('Only verified teachers can create classroom workspaces.');
        } else {
          setErrorMessage(err.data?.error?.message || err.message || 'Failed to create room.');
        }
      } else {
        setErrorMessage('A network error occurred. Please check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="create-room-modal-backdrop"
      data-testid="create-room-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        id="create-room-modal"
        data-testid="create-room-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-room-modal-title"
        className="relative w-full max-w-xl bg-white dark:bg-[#0c1220] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden max-h-[90vh] flex flex-col transition-colors duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="create-room-modal-title"
                data-testid="create-room-modal-title"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                Create New Classroom
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set up a workspace and configure participant permissions
              </p>
            </div>
          </div>
          <button
            type="button"
            id="create-room-close-btn"
            data-testid="create-room-close-btn"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300 animate-shake"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Room Name Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="room-name-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Classroom Name <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[11px] ${nameLength > 80 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                {nameLength}/80
              </span>
            </div>
            <input
              ref={nameInputRef}
              id="room-name-input"
              data-testid="room-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouchedName(true)}
              placeholder="e.g., CS101: Introduction to Data Structures"
              maxLength={85}
              required
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-900 border transition-all ${
                nameError
                  ? 'border-rose-300 dark:border-rose-800 focus:ring-rose-500 focus:border-rose-500'
                  : 'border-slate-200 dark:border-slate-800 focus:ring-indigo-500 focus:border-indigo-500'
              } text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2`}
            />
            {nameError && (
              <p className="text-xs text-rose-500 flex items-center gap-1 mt-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{nameError}</span>
              </p>
            )}
          </div>

          {/* Room Description Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="room-description-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Description <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <span className={`text-[11px] ${descLength > 500 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                {descLength}/500
              </span>
            </div>
            <textarea
              id="room-description-input"
              data-testid="room-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Brief summary of syllabus, lecture topic, or instructions for students..."
              maxLength={520}
              className={`w-full px-3.5 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-900 border transition-all resize-none ${
                descError
                  ? 'border-rose-300 dark:border-rose-800 focus:ring-rose-500 focus:border-rose-500'
                  : 'border-slate-200 dark:border-slate-800 focus:ring-indigo-500 focus:border-indigo-500'
              } text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2`}
            />
            {descError && (
              <p className="text-xs text-rose-500 flex items-center gap-1 mt-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{descError}</span>
              </p>
            )}
          </div>

          {/* Default Permissions Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-500" />
                  <span>Participant Permissions</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Configure default abilities granted to students upon joining
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSetAllPermissions(true)}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Enable All
                </button>
                <span className="text-slate-300 dark:text-slate-700">&bull;</span>
                <button
                  type="button"
                  onClick={() => handleSetAllPermissions(false)}
                  className="text-[11px] font-semibold text-slate-500 hover:underline"
                >
                  Disable All
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {PERMISSION_CONFIGS.map((config) => {
                const IconComponent = config.icon;
                const isEnabled = Boolean(permissions[config.key]);

                return (
                  <div
                    key={config.key}
                    onClick={() => handleTogglePermission(config.key)}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                      isEnabled
                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200/80 dark:border-indigo-800/40'
                        : 'bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/70 dark:border-slate-800/60 opacity-80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                          isEnabled
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                          {config.label}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block leading-tight">
                          {config.description}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      id={`toggle-perm-${config.key}`}
                      data-testid={`toggle-perm-${config.key}`}
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={`Toggle ${config.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePermission(config.key);
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        isEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-end gap-3">
            <button
              type="button"
              id="create-room-cancel-btn"
              data-testid="create-room-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="create-room-submit-btn"
              data-testid="create-room-submit-btn"
              disabled={!isFormValid || isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold text-xs shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Classroom...</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Create Classroom</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
