import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, HttpError } from '../../lib/api';
import { Room, Permissions, PermissionKey } from '@linkup/shared';
import { 
  ArrowLeft, 
  Mic, 
  Video, 
  MonitorUp, 
  PenTool, 
  Code2, 
  Loader2, 
  PlusCircle, 
  GraduationCap, 
  ShieldCheck, 
  AlertCircle 
} from 'lucide-react';

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
    description: 'Allow participants to unmute and speak during the session',
    icon: Mic,
  },
  {
    key: 'canCamera',
    label: 'Webcam Video',
    description: 'Allow participants to stream their video feed to the room',
    icon: Video,
  },
  {
    key: 'canScreen',
    label: 'Screen Sharing',
    description: 'Allow participants to present their screen to the room',
    icon: MonitorUp,
  },
  {
    key: 'canWhiteboard',
    label: 'Interactive Whiteboard',
    description: 'Allow participants to draw and annotate on the shared canvas',
    icon: PenTool,
  },
  {
    key: 'canCode',
    label: 'Collaborative Code',
    description: 'Allow participants to write and run code in the editor',
    icon: Code2,
  },
];

export const CreateRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [touchedName, setTouchedName] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      navigate(`/rooms/${newRoom.id}`, { replace: true });
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
    <div className="min-h-screen ambient-bg flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 transition-colors duration-300">
      <div className="max-w-xl w-full mx-auto space-y-8">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
              <PlusCircle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Create a Classroom
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set up a new workspace for live video, code, and whiteboard collaboration
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 sm:p-8 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800">
          <form onSubmit={handleSubmit} className="space-y-6">
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

            {/* Submit Button */}
            <div className="pt-4 flex items-center justify-end gap-3">
              <Link
                to="/"
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                id="create-room-submit-btn"
                data-testid="create-room-submit-btn"
                disabled={!isFormValid || isSubmitting}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold text-xs shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
    </div>
  );
};

export default CreateRoomPage;
