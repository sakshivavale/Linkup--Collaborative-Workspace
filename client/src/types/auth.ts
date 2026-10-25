export type UserRole = 'teacher' | 'student';
export type TeacherApprovalStatus = 'PENDING_TEACHER' | 'APPROVED' | 'REJECTED' | 'NONE';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isApproved?: boolean;
  status?: TeacherApprovalStatus;
  requestedRole?: UserRole;
  createdAt?: string;
}

export interface SignUpFormData {
  fullName: string;
  email: string;
  password: string;
  role: UserRole | '';
}

export interface SignUpFormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
  general?: string;
}
