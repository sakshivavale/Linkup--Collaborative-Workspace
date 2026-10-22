import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ClipboardList, 
  ArrowLeft, 
  Download, 
  DoorOpen, 
  Clock, 
  UserCheck, 
  ShieldCheck,
  Calendar,
  AlertCircle,
  Loader2,
  Users,
  Repeat,
  FileSpreadsheet,
  CheckCircle2
} from 'lucide-react';
import { Session, AttendanceRow } from '@linkup/shared';
import { api, apiFetch, HttpError } from '../../lib/api';

export const AttendancePage: React.FC = () => {
  const { id, roomId } = useParams<{ id?: string; roomId?: string }>();
  const currentRoomId = (roomId || id || '').trim();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);
  const [loadingAttendance, setLoadingAttendance] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // 1. Fetch room role and sessions for this room (Host only - US-ATT-04)
  useEffect(() => {
    if (!currentRoomId) return;
    let isMounted = true;

    async function loadSessions() {
      setLoadingSessions(true);
      setError(null);
      try {
        // Check room role if accessible
        try {
          const roomData = await api.get<{ myRole?: string }>(`/api/rooms/${currentRoomId}`);
          if (roomData && roomData.myRole && roomData.myRole !== 'host') {
            if (!isMounted) return;
            setIsHost(false);
            setError('403 Forbidden: Only the room host can view attendance records.');
            setLoadingSessions(false);
            return;
          }
        } catch (rErr: any) {
          if (rErr instanceof HttpError && rErr.status === 403) {
            if (!isMounted) return;
            setIsHost(false);
            setError('403 Forbidden: Only the room host can view attendance records.');
            setLoadingSessions(false);
            return;
          }
        }

        const data = await api.get<Session[]>(`/api/rooms/${currentRoomId}/sessions`);
        if (!isMounted) return;
        setSessions(Array.isArray(data) ? data.filter((s): s is Session => Boolean(s && s.id)) : []);
        setIsHost(true);
        if (Array.isArray(data) && data.length > 0 && data[0]?.id) {
          // Select most recent session by default
          setSelectedSessionId(data[0].id);
        }
      } catch (err: any) {
        if (!isMounted) return;
        const isForbidden =
          (err instanceof HttpError && err.status === 403) ||
          err?.status === 403 ||
          err?.code === 'HOST_ONLY' ||
          err?.code === 'FORBIDDEN' ||
          err?.message?.includes('403') ||
          err?.message?.toLowerCase().includes('host');

        if (isForbidden) {
          setIsHost(false);
          setError('403 Forbidden: Only the room host can view attendance records.');
        } else {
          setError(err?.message || 'Failed to load sessions for this room.');
        }
      } finally {
        if (isMounted) {
          setLoadingSessions(false);
        }
      }
    }

    loadSessions();

    return () => {
      isMounted = false;
    };
  }, [currentRoomId]);

  // 2. Fetch attendance rows whenever selectedSessionId changes
  const loadAttendance = useCallback(async (sessionId: string) => {
    if (!currentRoomId || !sessionId) {
      setAttendanceRows([]);
      return;
    }

    setLoadingAttendance(true);
    setError(null);
    try {
      const rows = await api.get<AttendanceRow[]>(`/api/rooms/${currentRoomId}/sessions/${sessionId}/attendance`);
      setAttendanceRows(rows || []);
    } catch (err: any) {
      console.error('[Attendance] Error fetching session attendance:', err);
      const isForbidden =
        (err instanceof HttpError && err.status === 403) ||
        err?.status === 403 ||
        err?.code === 'HOST_ONLY' ||
        err?.code === 'FORBIDDEN' ||
        err?.message?.includes('403') ||
        err?.message?.toLowerCase().includes('host');

      if (isForbidden) {
        setIsHost(false);
        setError('403 Forbidden: Only the room host can view attendance records.');
      } else {
        setError(err?.message || 'Failed to load attendance records for selected session.');
      }
    } finally {
      setLoadingAttendance(false);
    }
  }, [currentRoomId]);

  useEffect(() => {
    if (selectedSessionId) {
      loadAttendance(selectedSessionId);
    }
  }, [selectedSessionId, loadAttendance]);

  // 3. Download CSV handler (US-ATT-06, FR-6.6)
  const handleDownloadCsv = async () => {
    if (!currentRoomId || !selectedSessionId || exportingCsv) return;

    setExportingCsv(true);
    try {
      const res = await apiFetch(`/api/rooms/${currentRoomId}/sessions/${selectedSessionId}/attendance.csv`);
      if (!res.ok) {
        let errMsg = 'Failed to download attendance CSV';
        try {
          const errJson = await res.json();
          errMsg = errJson?.error?.message || errMsg;
        } catch {
          // fallback
        }
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-${selectedSessionId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast('Attendance CSV exported successfully!');
    } catch (err: any) {
      console.error('[Attendance] CSV download failed:', err);
      setError(err?.message || 'Failed to export attendance CSV.');
    } finally {
      setExportingCsv(false);
    }
  };

  // Helper date formatters
  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatSessionLabel = (sess: Session, index: number) => {
    const started = formatDateTime(sess.startedAt);
    const isOngoing = !sess.endedAt;
    const ended = isOngoing ? 'Ongoing' : formatDateTime(sess.endedAt!);
    return `Session ${sessions.length - index}: ${started} — ${ended}`;
  };

  // Summary statistics
  const totalAttendees = attendanceRows.length;
  const totalMinutes = attendanceRows.reduce((acc, row) => acc + (row.minutes || 0), 0);
  const totalJoins = attendanceRows.reduce((acc, row) => acc + (row.joins || 0), 0);

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-200" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navigation breadcrumbs */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          to={`/rooms/${currentRoomId}`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
        >
          <DoorOpen className="w-3.5 h-3.5" />
          <span>Back to Room {currentRoomId}</span>
        </Link>
        <span className="text-slate-300 dark:text-slate-700">&bull;</span>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Dashboard</span>
        </Link>
      </div>

      {/* Hero Header Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium mb-3">
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Attendance Tracking &bull; US-ATT-04 / US-ATT-06 (FR-6.4, FR-6.6)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Attendance: Room <span className="font-mono text-indigo-600 dark:text-indigo-400">{currentRoomId}</span>
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Automated session presence tracking. Accurately tracks first join time, last leave time, total participation duration, and reconnects with grace periods. Accessible only to the room host.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {/* Download CSV Button (US-ATT-06 Acceptance Criteria 1) */}
            <button
              id="download-csv-btn"
              data-testid="download-csv-btn"
              type="button"
              onClick={handleDownloadCsv}
              disabled={!selectedSessionId || exportingCsv || !isHost || loadingSessions}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm ${
                !selectedSessionId || exportingCsv || !isHost || loadingSessions
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-500/20 hover:shadow-md cursor-pointer'
              }`}
              title={
                !isHost
                  ? 'Host access required to export attendance'
                  : !selectedSessionId
                  ? 'No session selected'
                  : 'Export attendance as CSV file'
              }
            >
              {exportingCsv ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{exportingCsv ? 'Exporting CSV...' : 'Download CSV'}</span>
            </button>

            {/* Direct CSV Link indicator */}
            {selectedSessionId && isHost && (
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 hidden sm:inline">
                GET /rooms/{currentRoomId}/sessions/{selectedSessionId.slice(0, 8)}…/attendance.csv
              </span>
            )}
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 dark:opacity-10 pointer-events-none flex items-center justify-center">
          <Calendar className="w-64 h-64 text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>

      {/* Access Denied Card (403 HOST_ONLY) */}
      {!isHost && (
        <div
          data-testid="attendance-403-forbidden"
          className="glass-panel rounded-2xl p-6 mb-8 border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 flex items-start gap-4"
        >
          <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-200/80 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 mb-1.5">
              <span>HTTP 403 Forbidden</span>
            </div>
            <h2 className="text-base font-bold text-amber-950 dark:text-amber-200">Host Access Restricted</h2>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 max-w-xl leading-relaxed">
              Attendance records and session participant rosters are strictly restricted to the room host (US-ATT-04). Other users and participants receive HTTP 403 Forbidden.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Link
                to={`/rooms/${currentRoomId}`}
                id="back-to-room-btn"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors shadow-sm"
              >
                <DoorOpen className="w-4 h-4" />
                <span>Return to Room</span>
              </Link>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Dashboard</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Error notification banner */}
      {error && isHost && (
        <div className="glass-panel rounded-2xl p-4 mb-6 border border-rose-200 dark:border-rose-500/30 bg-rose-500/5 flex items-center gap-3 text-rose-700 dark:text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Session Selector & Analytics Section */}
      {isHost && (
        <div className="space-y-6">
          {/* Controls Bar: Session Picker Dropdown & Quick Stats */}
          <div className="glass-panel rounded-2xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex-1 max-w-md">
              <label 
                htmlFor="session-picker-select" 
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Select Session
              </label>
              {loadingSessions ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  <span>Loading sessions...</span>
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No sessions have been hosted in this room yet.
                </p>
              ) : (
                <div className="relative">
                  <select
                    id="session-picker-select"
                    data-testid="session-picker-select"
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors cursor-pointer"
                  >
                    {sessions.map((sess, idx) => (
                      <option key={sess.id} value={sess.id}>
                        {formatSessionLabel(sess, idx)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Quick Stat Highlights */}
            {selectedSessionId && (
              <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 pt-3 md:pt-0 md:pl-6">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {totalAttendees}
                    </div>
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Participants
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {totalMinutes}m
                    </div>
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Total Min
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400">
                    <Repeat className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {totalJoins}
                    </div>
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Total Joins
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Attendance Table Panel */}
          <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Session Attendance Roster
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <span>US-ATT-06 Verified</span>
              </div>
            </div>

            {loadingAttendance ? (
              <div className="p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto mb-2" />
                <p className="text-xs text-slate-500">Loading attendance data...</p>
              </div>
            ) : !selectedSessionId || sessions.length === 0 ? (
              <div className="p-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 mx-auto flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No Session Selected
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  Start a live meeting in room <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{currentRoomId}</span> to automatically record student attendance.
                </p>
              </div>
            ) : attendanceRows.length === 0 ? (
              <div className="p-10 text-center" data-testid="empty-attendance-roster">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 mx-auto flex items-center justify-center text-slate-400 mb-3">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No Attendees Logged
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  No participants were recorded in this session.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="attendance-table" id="attendance-table">
                  <thead>
                    <tr className="bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="py-3.5 px-6">Name</th>
                      <th className="py-3.5 px-6">First Join</th>
                      <th className="py-3.5 px-6">Last Leave</th>
                      <th className="py-3.5 px-6 text-center">Total Minutes</th>
                      <th className="py-3.5 px-6 text-center">Number of Joins</th>
                      <th className="py-3.5 px-6 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                    {attendanceRows.map((row) => (
                      <tr 
                        key={row.userId}
                        data-testid={`attendance-row-${row.userId}`}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-6 font-semibold text-slate-900 dark:text-white flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-emerald-500 text-white flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                            {row.fullName ? row.fullName.charAt(0) : 'U'}
                          </div>
                          <span data-testid={`attendance-name-${row.userId}`}>{row.fullName}</span>
                        </td>
                        <td className="py-3 px-6 text-slate-600 dark:text-slate-300 font-mono text-[11px]" data-testid={`attendance-first-join-${row.userId}`}>
                          {formatDateTime(row.firstJoin)}
                        </td>
                        <td className="py-3 px-6 text-slate-600 dark:text-slate-300 font-mono text-[11px]" data-testid={`attendance-last-leave-${row.userId}`}>
                          {formatDateTime(row.lastLeave)}
                        </td>
                        <td className="py-3 px-6 text-center" data-testid={`attendance-minutes-${row.userId}`}>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                            {Math.round(Number(row.minutes) || 0)} min{Math.round(Number(row.minutes) || 0) === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td className="py-3 px-6 text-center" data-testid={`attendance-joins-${row.userId}`}>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {row.joins} {row.joins === 1 ? 'join' : 'joins'}
                          </span>
                        </td>
                        <td className="py-3 px-6 text-center" data-testid={`attendance-status-${row.userId}`}>
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                              row.status === 'present'
                                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20'
                            }`}
                          >
                            {row.status === 'present' ? 'Present' : 'Absent'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Protected Route Footer Note */}
      <div className="mt-8 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Attendance Export &bull; US-ATT-06 (FR-6.6) &bull; Host Secured</span>
        </div>
      </div>
    </main>
  );
};

export default AttendancePage;
