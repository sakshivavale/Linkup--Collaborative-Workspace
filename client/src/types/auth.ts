export type UserRole = 'teacher' | 'student';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
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
