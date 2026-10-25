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
  canWhiteboard: true,
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
    label: 'Collaborative Code Editor',
    description: 'Allow participants to write and execute code collaboratively',
    icon: Code2,
  },
];

export const CreateRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedName = name.trim();
  const isNameValid = trimmedName.length >= 1 && trimmedName.length <= 80;

  const handleTogglePermission = (key: PermissionKey) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isNameValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: trimmedName,
        description: description.trim() || undefined,
        defaultPermissions: permissions,
      };

      const createdRoom = await api.post<Room>('/api/rooms', payload);
      if (createdRoom?.id) {
        navigate(`/rooms/${createdRoom.id}`);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      if (err instanceof HttpError) {
        if (err.status === 403 && err.code === 'TEACHER_NOT_APPROVED') {
          navigate('/pending-approval');
          return;
        }
        setErrorMessage(err.message || 'Failed to create room. Please try again.');
      } else {
        setErrorMessage('An unexpected error occurred while creating room.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen ambient-bg flex flex-col justify-between py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl w-full mx-auto">
        {/* Back navigation */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Dashboard</span>
        </Link>

        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl">
          {/* Header */}
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-sm">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                Create a Classroom Room
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Launch a collaborative workspace with live media, code editor, and whiteboard
              </p>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mb-6 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Room Name */}
            <div>
              <label
                htmlFor="room-name-input"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2"
              >
                Room Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="room-name-input"
                data-testid="room-name-input"
                type="text"
                required
                maxLength={80}
                placeholder="e.g. Advanced Algorithms 101"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all shadow-inner"
              />
              <div className="flex justify-between items-center mt-1 text-[11px] text-slate-400">
                <span>Required (1 to 80 characters)</span>
                <span>{name.length}/80</span>
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="room-description-input"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2"
              >
                Description <span className="text-slate-400 text-[10px] normal-case">(optional)</span>
              </label>
              <textarea
                id="room-description-input"
                data-testid="room-description-input"
                rows={3}
                maxLength={500}
                placeholder="e.g. Live collaborative session covering trees and graph traversal"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all shadow-inner resize-none"
              />
              <div className="flex justify-end mt-1 text-[11px] text-slate-400">
                <span>{description.length}/500</span>
              </div>
            </div>

            {/* Default Participant Permissions */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Initial Participant Permissions
                </h2>
              </div>
              <div className="space-y-2">
                {PERMISSION_CONFIGS.map((perm) => {
                  const Icon = perm.icon;
                  const isChecked = permissions[perm.key];
                  return (
                    <div
                      key={perm.key}
                      onClick={() => handleTogglePermission(perm.key)}
                      className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 hover:border-indigo-300 dark:hover:border-indigo-500/30 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            {perm.label}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {perm.description}
                          </p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4 flex items-center justify-end gap-3">
              <Link
                to="/"
                className="px-5 py-2.5 rounded-2xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </Link>
              <button
                id="create-room-submit-btn"
                data-testid="create-room-submit-btn"
                type="submit"
                disabled={!isNameValid || isSubmitting}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Launching Room...</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Launch Room</span>
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
