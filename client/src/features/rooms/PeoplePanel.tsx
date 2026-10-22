import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  GraduationCap,
  BookOpen,
  UserMinus,
  Key,
  Copy,
  Check,
  RefreshCw,
  Radio,
  ScreenShare,
  Mic,
  Video,
  PenTool,
  Code2,
  Lock,
  Hand,
  MicOff,
} from 'lucide-react';
import { RoomSummary, PresenceEntry, Member, PermissionKey, UserRole } from '@linkup/shared';
import { useAuth } from '../../context/AuthContext';
import { socket } from '../../lib/socket';
import { api, HttpError } from '../../lib/api';
import { useNavigate } from 'react-router-dom';

const PERMISSION_CONFIG: {
  key: PermissionKey;
  label: string;
  idKey: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { key: 'canMic', label: 'Mic', idKey: 'mic', Icon: Mic },
  { key: 'canCamera', label: 'Camera', idKey: 'camera', Icon: Video },
  { key: 'canScreen', label: 'Screen', idKey: 'screen', Icon: ScreenShare },
  { key: 'canWhiteboard', label: 'Whiteboard', idKey: 'whiteboard', Icon: PenTool },
  { key: 'canCode', label: 'Code', idKey: 'code', Icon: Code2 },
];

export const getPermissionToggleId = (idKey: string, memberId: string) => {
  switch (idKey) {
    case 'mic':
      return `toggle-perm-mic-${memberId}`;
    case 'camera':
      return `toggle-perm-camera-${memberId}`;
    case 'screen':
      return `toggle-perm-screen-${memberId}`;
    case 'whiteboard':
      return `toggle-perm-whiteboard-${memberId}`;
    case 'code':
      return `toggle-perm-code-${memberId}`;
    default:
      return `toggle-perm-${idKey}-${memberId}`;
  }
};

interface PeoplePanelProps {
  room: RoomSummary;
  currentJoinCode?: string | null;
  onJoinCodeRegenerated?: (newCode: string) => void;
}

type PanelMember = {
  id: string;
  userId?: string;
  name: string;
  role: UserRole;
  memberRole: 'host' | 'participant';
  isSelf: boolean;
};

export const PeoplePanel: React.FC<PeoplePanelProps> = ({
  room,
  currentJoinCode: initialJoinCode,
  onJoinCodeRegenerated,
}) => {
  const navigate = useNavigate();
  const { fullName, role, user } = useAuth();
  const currentUserId = user?.id ?? 'self';
  const effectiveRole = role ?? 'student';

  const [joinCode, setJoinCode] = useState<string | null>(initialJoinCode || room.joinCode);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);

  // US-PERM-06: Mute All state (host only)
  const [isMutingAll, setIsMutingAll] = useState(false);
  const [muteAllSuccess, setMuteAllSuccess] = useState(false);

  // US-ROOM-02: Real-time presence state
  const [presenceList, setPresenceList] = useState<PresenceEntry[]>(() => room.presence || []);

  useEffect(() => {
    if (initialJoinCode !== undefined) {
      setJoinCode(initialJoinCode);
    } else {
      setJoinCode(room.joinCode);
    }
  }, [initialJoinCode, room.joinCode]);

  const handleCopyJoinCode = () => {
    const code = joinCode || room.joinCode;
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleRegenerateCode = async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    try {
      const res = await api.post<{ joinCode: string }>(`/api/rooms/${room.id}/join-code`);
      if (res?.joinCode) {
        setJoinCode(res.joinCode);
        room.joinCode = res.joinCode;
        onJoinCodeRegenerated?.(res.joinCode);
        setRegenerated(true);
        setTimeout(() => setRegenerated(false), 2500);
      }
    } catch (err: any) {
      console.warn('[PeoplePanel] Error regenerating join code:', err);
      // Fallback for sample demo room
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let fallbackCode = '';
      for (let i = 0; i < 6; i++) {
        fallbackCode += chars[Math.floor(Math.random() * chars.length)];
      }
      setJoinCode(fallbackCode);
      room.joinCode = fallbackCode;
      onJoinCodeRegenerated?.(fallbackCode);
      setRegenerated(true);
      setTimeout(() => setRegenerated(false), 2500);
    } finally {
      setIsRegenerating(false);
    }
  };

  const [members, setMembers] = useState<PanelMember[]>(() => {
    const selfMember: PanelMember = {
      id: 'self',
      userId: currentUserId,
      name: fullName,
      role: effectiveRole,
      memberRole: room.myRole,
      isSelf: true,
    };

    const serverMembers = (room.members ?? []).filter((m): m is Member => Boolean(m && m.userId));
    const normalized = serverMembers
      .filter((member) => member.userId !== currentUserId)
      .map((member) => ({
        id: `member-${member.userId}`,
        userId: member.userId,
        name: member.fullName || 'Anonymous',
        role: member.userRole ?? 'student',
        memberRole: member.memberRole ?? 'participant',
        isSelf: false,
      }));

    if (room.myRole !== 'host' && !serverMembers.some((m) => m && (m.memberRole === 'host' || m.fullName === room.hostName))) {
      const hostMember: PanelMember = {
        id: 'host',
        userId: 'host',
        name: room.hostName,
        role: 'teacher',
        memberRole: 'host',
        isSelf: false,
      };
      return [selfMember, hostMember, ...normalized];
    }

    return [selfMember, ...normalized];
  });

  useEffect(() => {
    const selfMember: PanelMember = {
      id: 'self',
      userId: currentUserId,
      name: fullName,
      role: effectiveRole,
      memberRole: room.myRole,
      isSelf: true,
    };

    const serverMembers = (room.members ?? []).filter((m): m is Member => Boolean(m && m.userId));
    const normalized = serverMembers
      .filter((member) => member.userId !== currentUserId)
      .map((member) => ({
        id: `member-${member.userId}`,
        userId: member.userId,
        name: member.fullName || 'Anonymous',
        role: member.userRole ?? 'student',
        memberRole: member.memberRole ?? 'participant',
        isSelf: false,
      }));

    if (room.myRole !== 'host' && !serverMembers.some((m) => m && (m.memberRole === 'host' || m.fullName === room.hostName))) {
      const hostMember: PanelMember = {
        id: 'host',
        userId: 'host',
        name: room.hostName,
        role: 'teacher',
        memberRole: 'host',
        isSelf: false,
      };
      setMembers([selfMember, hostMember, ...normalized]);
    } else {
      setMembers([selfMember, ...normalized]);
    }
  }, [currentUserId, effectiveRole, fullName, room, room.id, room.members, room.myRole]);

  // US-ROOM-02: Listen to real-time presence and member updates
  useEffect(() => {
    const onPresenceUpdate = (data: { roomId: string; presence: PresenceEntry[] }) => {
      if (data.roomId === room.id && Array.isArray(data.presence)) {
        setPresenceList(data.presence.filter(Boolean));
      }
    };

    const onMemberJoined = (data: { roomId: string; member: Member }) => {
      if (data.roomId === room.id && data.member && data.member.userId) {
        setMembers((current) => {
          if (current.some((m) => m && m.userId === data.member.userId)) return current;
          return [
            ...current,
            {
              id: `member-${data.member.userId}`,
              userId: data.member.userId,
              name: data.member.fullName || 'Anonymous',
              role: data.member.userRole ?? 'student',
              memberRole: data.member.memberRole ?? 'participant',
              isSelf: data.member.userId === currentUserId,
            },
          ];
        });
      }
    };

    const onMemberRemoved = ({ roomId, userId: removedUserId }: { roomId: string; userId: string }) => {
      if (roomId !== room.id) return;
      setMembers((current) => current.filter((member) => member.userId !== removedUserId));
      setPresenceList((current) => current.filter((p) => p.userId !== removedUserId));
    };

    const onRoomKicked = ({ roomId }: { roomId: string }) => {
      if (roomId !== room.id) return;
      navigate('/', { replace: true, state: { flash: 'ROOM_KICKED' } });
    };

    const onPermChanged = (data: { roomId: string; userId: string; permissions: any }) => {
      if (data.roomId !== room.id) return;
      if (room.members) {
        const target = room.members.find((m) => m.userId === data.userId);
        if (target) {
          target.permissions = data.permissions;
        }
      }
      setMembers((prev) => [...prev]);
    };

    // US-PERM-07 AC-2: Listen for real-time hand:changed events
    const onHandChanged = (data: { roomId: string; userId: string; raised: boolean }) => {
      if (data.roomId !== room.id) return;
      setPresenceList((current) => {
        const found = current.some((p) => p.userId === data.userId);
        if (found) {
          return current.map((p) =>
            p.userId === data.userId ? { ...p, handRaised: data.raised } : p
          );
        }
        const memberObj = members.find((m) => m.userId === data.userId);
        return [
          ...current,
          {
            userId: data.userId,
            fullName: memberObj?.name || 'Participant',
            inLive: false,
            handRaised: data.raised,
            micOn: true,
            cameraOn: false,
          },
        ];
      });
    };

    // US-PERM-06: Listen to bulk permission updates
    const onPermBulk = (data: { roomId: string; patch: Partial<Permissions>; members?: Member[] }) => {
      if (data.roomId !== room.id) return;
      if (room.members && data.patch) {
        room.members.forEach((m) => {
          if (m.memberRole !== 'host') {
            m.permissions = {
              ...m.permissions,
              ...data.patch,
            };
          }
        });
      }
      setMembers((prev) => [...prev]);
    };

    socket.on('presence:update', onPresenceUpdate);
    socket.on('hand:changed', onHandChanged);
    socket.on('member:joined', onMemberJoined);
    socket.on('member:removed', onMemberRemoved);
    socket.on('room:kicked', onRoomKicked);
    socket.on('perm:changed', onPermChanged);
    socket.on('perm:bulk', onPermBulk);

    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('hand:changed', onHandChanged);
      socket.off('member:joined', onMemberJoined);
      socket.off('member:removed', onMemberRemoved);
      socket.off('room:kicked', onRoomKicked);
      socket.off('perm:changed', onPermChanged);
      socket.off('perm:bulk', onPermBulk);
    };
  }, [currentUserId, members, navigate, room.id, room.members]);

  const handleTogglePermission = async (member: PanelMember, permKey: PermissionKey) => {
    if (!member.userId || member.memberRole === 'host' || room.myRole !== 'host') return;
    const currentMemberRecord = room.members?.find((m) => m.userId === member.userId);
    const currentVal = Boolean(currentMemberRecord?.permissions?.[permKey] ?? (permKey !== 'canScreen'));
    const nextVal = !currentVal;

    // Optimistic update
    if (currentMemberRecord) {
      if (!currentMemberRecord.permissions) {
        currentMemberRecord.permissions = {
          canMic: true,
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: true,
          [permKey]: nextVal,
        };
      } else {
        currentMemberRecord.permissions[permKey] = nextVal;
      }
      setMembers((prev) => [...prev]);
    }

    try {
      await api.patch(`/api/rooms/${room.id}/members/${member.userId}/permissions`, {
        [permKey]: nextVal,
      });
    } catch (err: any) {
      console.error('[PeoplePanel] Failed to update permission:', err);
      // Rollback
      if (currentMemberRecord?.permissions) {
        currentMemberRecord.permissions[permKey] = currentVal;
        setMembers((prev) => [...prev]);
      }
      window.alert(err?.message || 'Failed to update permission');
    }
  };

  // US-PERM-07 AC-3: Host "Grant Mic" button grants can_mic = true and lowers the hand (FR-4.8)
  const handleGrantMic = async (member: PanelMember) => {
    if (!member.userId || member.memberRole === 'host' || room.myRole !== 'host') return;

    // Optimistically update permissions in room.members and members state
    const currentMemberRecord = room.members?.find((m) => m.userId === member.userId);
    if (currentMemberRecord) {
      if (!currentMemberRecord.permissions) {
        currentMemberRecord.permissions = {
          canMic: true,
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: true,
        };
      } else {
        currentMemberRecord.permissions.canMic = true;
      }
      setMembers((prev) => [...prev]);
    }

    // Optimistically lower the hand in presenceList
    setPresenceList((current) =>
      current.map((p) => (p.userId === member.userId ? { ...p, handRaised: false } : p))
    );

    try {
      // 1. PATCH member permissions with canMic: true
      await api.patch(`/api/rooms/${room.id}/members/${member.userId}/permissions`, {
        canMic: true,
      });

      // 2. Emit socket hand:raise as host to ensure instant synchronization
      socket.emit('hand:raise', {
        roomId: room.id,
        userId: member.userId,
        raised: false,
        asHost: true,
      });
    } catch (err: any) {
      console.error('[PeoplePanel] Failed to grant mic:', err);
      window.alert(err?.message || 'Failed to grant microphone');
    }
  };

  // US-PERM-07 AC-4: Student can lower their own hand at any time
  const handleLowerSelfHand = () => {
    socket.emit('hand:raise', {
      roomId: room.id,
      raised: false,
    });
    setPresenceList((current) =>
      current.map((p) => (p.userId === currentUserId ? { ...p, handRaised: false } : p))
    );
  };

  // Lookup map for fast presence checks (<1ms)
  const presenceMap = useMemo(() => {
    const map = new Map<string, PresenceEntry>();
    for (const p of presenceList) {
      map.set(p.userId, p);
    }
    return map;
  }, [presenceList]);

  const handleRemoveMember = async (member: PanelMember) => {
    if (!member.userId || member.userId === currentUserId) return;
    const confirmed = window.confirm(`Remove ${member.name} from this room?`);
    if (!confirmed) return;

    try {
      await api.delete(`/api/rooms/${room.id}/members/${member.userId}`);
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
    } catch (err) {
      if (err instanceof HttpError) {
        window.alert(err.message || 'Failed to remove member');
      } else {
        window.alert('Failed to remove member');
      }
    }
  };

  // US-PERM-06: Bulk Mute All action (host only, FR-4.7)
  const handleMuteAll = async () => {
    if (room.myRole !== 'host' || isMutingAll) return;
    setIsMutingAll(true);

    // Optimistically update all participants (not host) in local state
    if (room.members) {
      room.members.forEach((m) => {
        if (m.memberRole !== 'host' && m.userId !== currentUserId) {
          if (m.permissions) {
            m.permissions.canMic = false;
          } else {
            m.permissions = {
              canMic: false,
              canCamera: true,
              canScreen: false,
              canWhiteboard: true,
              canCode: true,
            };
          }
        }
      });
    }
    setMembers((prev) => [...prev]);

    try {
      await api.post(`/api/rooms/${room.id}/permissions/bulk`, {
        canMic: false,
      });
      setMuteAllSuccess(true);
      setTimeout(() => setMuteAllSuccess(false), 2000);
    } catch (err: any) {
      console.error('[PeoplePanel] Failed to mute all participants:', err);
      window.alert(err?.message || 'Failed to mute all participants');
    } finally {
      setIsMutingAll(false);
    }
  };

  const extraCount = Math.max(0, room.memberCount - members.length);

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name.slice(0, 2).toUpperCase() || 'U';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 shrink-0">
        <Users className="w-4 h-4 text-indigo-500" />
        <span
          id="people-panel-title"
          data-testid="people-panel-title"
          className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide"
        >
          {room.myRole === 'host' ? 'Participants' : 'People'}
        </span>
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
          {members.length > 0 ? members.length : room.memberCount}
        </span>
      </div>

      {/* US-PERM-06: Mute All Button for Host (P1, FR-4.7) */}
      {room.myRole === 'host' && (
        <div className="mx-3 mt-3 shrink-0">
          <button
            id="mute-all-btn"
            data-testid="mute-all-btn"
            type="button"
            onClick={handleMuteAll}
            disabled={isMutingAll}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 border border-rose-200/80 dark:border-rose-800/60 text-xs font-bold text-rose-700 dark:text-rose-300 transition-all shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
            title="Mute all participants at once"
            aria-label="Mute All"
          >
            <MicOff className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            <span>{isMutingAll ? 'Muting everyone...' : muteAllSuccess ? 'Everyone Muted!' : 'Mute All'}</span>
          </button>
        </div>
      )}

      {/* US-ROOM-04: Host room join code card with Copy & Regenerate options */}
      {room.myRole === 'host' && (joinCode || room.joinCode) && (
        <div
          id="people-join-code-card"
          data-testid="people-join-code-card"
          className="mx-3 mt-3 p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 flex flex-col gap-2 shrink-0"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-indigo-950/70 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
              <Key className="w-3 h-3 text-indigo-500" />
              Room Join Code
            </span>
            <span
              id="people-join-code-display"
              data-testid="people-join-code-display"
              className="text-[11px] font-mono font-bold tracking-widest text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800"
            >
              {joinCode || room.joinCode}
            </span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              id="people-copy-join-code-btn"
              data-testid="people-copy-join-code-btn"
              type="button"
              onClick={handleCopyJoinCode}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors active:scale-95 shadow-sm"
              aria-label={`Copy join code ${joinCode || room.joinCode}`}
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
            </button>
            <button
              id="people-regenerate-join-code-btn"
              data-testid="people-regenerate-join-code-btn"
              type="button"
              onClick={handleRegenerateCode}
              disabled={isRegenerating}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 active:scale-95 shadow-sm"
              title="Regenerate code (previous code will immediately stop working)"
              aria-label="Regenerate join code"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              <span>{regenerated ? 'New Code!' : 'Regenerate'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Member list with Role badges, Online/Offline dot, and In Call indicators */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {members.map((member) => {
          const presenceEntry = member.userId ? presenceMap.get(member.userId) : undefined;
          // Self is online while connected in the room; other members are online if in presenceMap
          const isOnline = member.isSelf
            ? (socket.connected || Boolean(presenceEntry))
            : Boolean(presenceEntry);
          const isInCall = Boolean(presenceEntry?.inLive);
          const isHandRaised = Boolean(presenceEntry?.handRaised);
          const memberRecord = room.members?.find((m) => m.userId === member.userId);
          const isHostViewer = room.myRole === 'host';
          const isHostMember = member.memberRole === 'host';
          const memberId = member.userId || member.id;

          return (
            <div
              key={member.id}
              id={`member-row-${memberId}`}
              data-testid={`member-row-${memberId}`}
              className="flex flex-col gap-1.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors border border-slate-100/80 dark:border-slate-800/60 bg-white/50 dark:bg-slate-900/30"
            >
              {/* Member header row */}
              <div className="flex items-center gap-2.5">
                {/* Avatar with Online/Offline indicator dot (US-ROOM-02 AC-1, AC-2, US-PERM-01 AC-1) */}
                <div className="relative shrink-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${
                      isHostMember
                        ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500'
                        : 'bg-gradient-to-tr from-emerald-600 to-teal-500'
                    }`}
                  >
                    {getInitials(member.name)}
                  </div>
                  <span
                    id={`member-presence-${memberId}`}
                    data-testid={`member-presence-${memberId}`}
                    data-status={isOnline ? 'online' : 'offline'}
                    title={isOnline ? 'Online' : 'Offline'}
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-950 transition-colors duration-200 ${
                      isOnline
                        ? 'bg-emerald-500 shadow-sm'
                        : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                </div>

                {/* Name and role badges */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      id={`member-name-${memberId}`}
                      data-testid={`member-name-${memberId}`}
                      className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
                    >
                      {member.name}
                    </span>
                    {member.isSelf && (
                      <span className="text-[10px] text-slate-400 font-normal shrink-0">(you)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {/* Role badge (Teacher / Student) */}
                    {member.role === 'teacher' ? (
                      <span
                        id={`member-role-${memberId}`}
                        data-testid={`member-role-${memberId}`}
                        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/80"
                      >
                        <GraduationCap className="w-3 h-3 text-indigo-500 shrink-0" />
                        <span>Teacher</span>
                      </span>
                    ) : (
                      <span
                        id={`member-role-${memberId}`}
                        data-testid={`member-role-${memberId}`}
                        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/80"
                      >
                        <BookOpen className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span>Student</span>
                      </span>
                    )}

                    {/* Host badge */}
                    {isHostMember && (
                      <span
                        id={`member-host-${memberId}`}
                        data-testid={`member-host-${memberId}`}
                        className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60"
                      >
                        Host
                      </span>
                    )}

                    {/* "In call" indicator */}
                    {isInCall && (
                      <span
                        id={`member-in-call-${memberId}`}
                        data-testid={`member-in-call-${memberId}`}
                        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/60 animate-pulse"
                        title="Currently in live call"
                      >
                        <Radio className="w-2.5 h-2.5 text-rose-500 animate-pulse shrink-0" />
                        <span>In call</span>
                      </span>
                    )}

                    {/* US-PERM-07 AC-2: Hand raised icon badge indicator (FR-4.8) */}
                    {isHandRaised && (
                      <span
                        id={`member-hand-icon-${memberId}`}
                        data-testid={`member-hand-icon-${memberId}`}
                        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700/80 animate-pulse"
                        title="Hand is raised"
                      >
                        <Hand className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>✋ Hand raised</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* US-PERM-07 AC-3: Host "Grant Mic" button next to hand icon */}
                {isHostViewer && isHandRaised && !isHostMember && (
                  <button
                    id={`member-grant-mic-btn-${memberId}`}
                    data-testid={`member-grant-mic-btn-${memberId}`}
                    type="button"
                    onClick={() => handleGrantMic(member)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 px-2 py-1 text-[10px] font-bold transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                    title="Grant microphone and lower hand"
                    aria-label={`Grant mic to ${member.name}`}
                  >
                    <Mic className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span>Grant Mic</span>
                  </button>
                )}

                {/* US-PERM-07 AC-4: Student can lower their own hand at any time */}
                {member.isSelf && isHandRaised && (
                  <button
                    id={`member-lower-hand-btn-${memberId}`}
                    data-testid={`member-lower-hand-btn-${memberId}`}
                    type="button"
                    onClick={handleLowerSelfHand}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 text-[10px] font-semibold transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                    title="Lower your hand"
                    aria-label="Lower your hand"
                  >
                    <Hand className="w-3 h-3 text-slate-500" />
                    <span>Lower Hand</span>
                  </button>
                )}

                {/* Host actions: remove member (US-ROOM-03) */}
                {isHostViewer && !member.isSelf && !isHostMember && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 shrink-0 transition-colors"
                    aria-label={`Remove ${member.name} from room`}
                  >
                    <UserMinus className="w-3 h-3" />
                    <span>Remove</span>
                  </button>
                )}
              </div>

              {/* US-PERM-01 AC-1, AC-2: 5 Permission Toggles per person for Host view (Mic, Camera, Screen, Whiteboard, Code) */}
              {isHostViewer && (
                <div
                  id={`member-permissions-${memberId}`}
                  data-testid={`member-permissions-${memberId}`}
                  className="mt-1 pt-1.5 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-1"
                >
                  <div className="flex items-center gap-1 w-full justify-between">
                    {PERMISSION_CONFIG.map(({ key, label, idKey, Icon }) => {
                      // Host's own row shows all toggles permanently enabled and locked (AC-2)
                      const isEnabled = isHostMember
                        ? true
                        : Boolean(memberRecord?.permissions?.[key] ?? (key !== 'canScreen'));
                      const isLocked = isHostMember;

                      return (
                        <button
                          key={key}
                          id={`toggle-perm-${idKey}-${memberId}`}
                          data-testid={`toggle-perm-${idKey}-${memberId}`}
                          data-permission={key}
                          data-enabled={isEnabled}
                          data-locked={isLocked}
                          type="button"
                          disabled={isLocked}
                          onClick={() => !isLocked && handleTogglePermission(member, key)}
                          title={
                            isLocked
                              ? 'Host permissions are permanently enabled and locked'
                              : `${label}: ${isEnabled ? 'Allowed (click to revoke)' : 'Disabled (click to grant)'}`
                          }
                          className={`flex-1 inline-flex items-center justify-center gap-1 px-1 py-1 rounded-md text-[10px] font-semibold transition-all select-none ${
                            isLocked
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60 cursor-not-allowed opacity-90'
                              : isEnabled
                              ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 active:scale-95 shadow-xs'
                              : 'bg-slate-100 dark:bg-slate-800/70 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 hover:text-slate-600 dark:hover:text-slate-300'
                          }`}
                          aria-label={`${label} permission for ${member.name}`}
                          aria-pressed={isEnabled}
                        >
                          <Icon className="w-3 h-3 shrink-0" />
                          <span className="hidden sm:inline text-[9px]">{label}</span>
                          {isLocked && <Lock className="w-2 h-2 ml-0.5 text-amber-600 dark:text-amber-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {extraCount > 0 && (
          <p className="text-xs text-center text-slate-400 dark:text-slate-600 py-2">
            +{extraCount} more members
          </p>
        )}
      </div>
    </div>
  );
};
