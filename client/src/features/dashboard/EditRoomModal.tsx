import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Loader2, 
  AlertCircle, 
  CheckCircle2,
  Archive,
  Edit3,
  AlertTriangle
} from 'lucide-react';
import { api, HttpError } from '../../lib/api';
import { RoomSummary } from '@linkup/shared';

interface EditRoomModalProps {
  isOpen: boolean;
  room: RoomSummary;
  onClose: () => void;
  onSuccess: (updatedRoom: RoomSummary) => void;
  onArchive: (roomId: string) => void;
}

export const EditRoomModal: React.FC<EditRoomModalProps> = ({
  isOpen,
  room,
  onClose,
  onSuccess,
  onArchive,
}) => {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description || '');
  const [touchedName, setTouchedName] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync state when modal opens or room prop changes
  useEffect(() => {
    if (isOpen) {
      setName(room.name);
      setDescription(room.description || '');
      setTouchedName(false);
      setIsSubmitting(false);
      setIsArchiving(false);
      setShowArchiveConfirm(false);
      setErrorMessage(null);

      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, room]);

  if (!isOpen) return null;

  // Validation rules
  const trimmedName = name.trim();
  const nameError = touchedName && trimmedName.length === 0
    ? 'Room name is required and cannot be empty'
    : name.length > 80
    ? 'Room name cannot exceed 80 characters'
    : null;

  const descError = description.length > 500
    ? 'Description cannot exceed 500 characters'
    : null;

  const isFormValid = trimmedName.length > 0 && name.length <= 80 && description.length <= 500;

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
      };

      const updated = await api.patch<RoomSummary>(`/api/rooms/${room.id}`, payload);
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        if (err.status === 403) {
          setErrorMessage('Only the room host can edit room details.');
        } else if (err.status === 404) {
          setErrorMessage('Room not found or already archived.');
        } else {
          setErrorMessage(err.data?.error?.message || err.message || 'Failed to update room.');
        }
      } else {
        setErrorMessage('A network error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (isArchiving) return;

    setIsArchiving(true);
    setErrorMessage(null);

    try {
      await api.patch(`/api/rooms/${room.id}`, { archived: true });
      onArchive(room.id);
      onClose();
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        if (err.status === 403) {
          setErrorMessage('Only the room host can archive this room.');
        } else if (err.status === 404) {
          setErrorMessage('Room not found or already archived.');
        } else {
          setErrorMessage(err.data?.error?.message || err.message || 'Failed to archive room.');
        }
      } else {
        setErrorMessage('A network error occurred. Please try again.');
      }
      setShowArchiveConfirm(false);
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div
      id="edit-room-modal-backdrop"
      data-testid="edit-room-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting && !isArchiving) {
          onClose();
        }
      }}
    >
      <div
        id="edit-room-modal"
        data-testid="edit-room-modal"
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Edit Room Settings
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Update room name, description, or archive room
              </p>
            </div>
          </div>
          <button
            id="close-edit-room-modal-btn"
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isArchiving}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMessage && (
            <div
              id="edit-room-error"
              className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Room Name Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="edit-room-name" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Room Name <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[10px] ${name.length > 80 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                {name.length}/80
              </span>
            </div>
            <input
              id="edit-room-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTouchedName(true);
              }}
              onBlur={() => setTouchedName(true)}
              placeholder="e.g. CS101: Data Structures"
              disabled={isSubmitting || isArchiving}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white placeholder-slate-400 ${
                nameError
                  ? 'border-rose-400 dark:border-rose-500 focus:ring-rose-400/20'
                  : 'border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/20'
              }`}
            />
            {nameError && (
              <p className="text-[11px] text-rose-500 font-medium pl-1">
                {nameError}
              </p>
            )}
          </div>

          {/* Description Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="edit-room-description" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Description <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <span className={`text-[10px] ${description.length > 500 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                {description.length}/500
              </span>
            </div>
            <textarea
              id="edit-room-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide context or instructions for your students..."
              disabled={isSubmitting || isArchiving}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white placeholder-slate-400 resize-none ${
                descError
                  ? 'border-rose-400 dark:border-rose-500 focus:ring-rose-400/20'
                  : 'border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/20'
              }`}
            />
            {descError && (
              <p className="text-[11px] text-rose-500 font-medium pl-1">
                {descError}
              </p>
            )}
          </div>

          {/* Archive Danger Zone */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            {!showArchiveConfirm ? (
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Archive this Room
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Removes room from all members' dashboards.
                  </p>
                </div>
                <button
                  id="open-archive-confirm-btn"
                  type="button"
                  onClick={() => setShowArchiveConfirm(true)}
                  disabled={isSubmitting || isArchiving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archive</span>
                </button>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-rose-50/80 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300">
                      Are you sure you want to archive "{room.name}"?
                    </h4>
                    <p className="text-[11px] text-rose-700 dark:text-rose-400/90 leading-relaxed mt-0.5">
                      This room will no longer appear on your dashboard or any student's dashboard.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowArchiveConfirm(false)}
                    disabled={isArchiving}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    id="confirm-archive-room-btn"
                    type="button"
                    onClick={handleArchive}
                    disabled={isArchiving}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 transition-all shadow-sm shadow-rose-600/30 disabled:opacity-50"
                  >
                    {isArchiving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Archiving...</span>
                      </>
                    ) : (
                      <>
                        <Archive className="w-3.5 h-3.5" />
                        <span>Yes, Archive Room</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isArchiving}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              id="save-room-settings-btn"
              type="submit"
              disabled={!isFormValid || isSubmitting || isArchiving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:pointer-events-none"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
