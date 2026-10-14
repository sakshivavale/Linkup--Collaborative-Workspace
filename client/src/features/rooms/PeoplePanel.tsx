import React from 'react';
import { Users, GraduationCap, BookOpen } from 'lucide-react';
import { RoomSummary } from '@linkup/shared';
import { useAuth } from '../../context/AuthContext';

interface PeoplePanelProps {
  room: RoomSummary;
}

/**
 * PeoplePanel — sidebar roster showing current room members.
 * Live presence sync via Socket.IO will be added in a future story.
 */
export const PeoplePanel: React.FC<PeoplePanelProps> = ({ room }) => {
  const { fullName, role } = useAuth();

  // For now show the authenticated user + host info from room summary
  const members = [
    {
      id: 'self',
      name: fullName,
      role,
      memberRole: room.myRole,
      isOnline: true,
      isSelf: true,
    },
    ...(room.myRole !== 'host'
      ? [
          {
            id: 'host',
            name: room.hostName,
            role: 'teacher' as const,
            memberRole: 'host' as const,
            isOnline: true,
            isSelf: false,
          },
        ]
      : []),
  ];

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name.slice(0, 2).toUpperCase() || 'U';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 shrink-0">
        <Users className="w-4 h-4 text-indigo-500" />
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
          People
        </span>
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
          {room.memberCount}
        </span>
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {members.map(member => (
          <div
            key={member.id}
            className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
          >
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                member.memberRole === 'host'
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-400'
                  : 'bg-gradient-to-tr from-emerald-600 to-teal-400'
              }`}>
                {getInitials(member.name)}
              </div>
              {/* Online indicator */}
              {member.isOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-950" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {member.name}
                  {member.isSelf && (
                    <span className="ml-1 text-[10px] text-slate-400 font-normal">(you)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                {member.role === 'teacher' ? (
                  <GraduationCap className="w-3 h-3 text-indigo-500 shrink-0" />
                ) : (
                  <BookOpen className="w-3 h-3 text-emerald-500 shrink-0" />
                )}
                <span className="text-[10px] text-slate-400 dark:text-slate-500 capitalize">
                  {member.memberRole === 'host' ? 'Host' : 'Participant'} · {member.role}
                </span>
              </div>
            </div>
          </div>
        ))}

        {room.memberCount > members.length && (
          <p className="text-xs text-center text-slate-400 dark:text-slate-600 py-2">
            +{room.memberCount - members.length} more members
            <br />
            <span className="text-[10px]">Live roster sync coming soon</span>
          </p>
        )}
      </div>
    </div>
  );
};
