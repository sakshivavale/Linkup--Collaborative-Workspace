import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { PublicRoute } from './components/auth/PublicRoute';
import { AppLayout } from './components/layout/AppLayout';
import { SignupPage } from './features/auth/SignupPage';
import { LoginPage } from './features/auth/LoginPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { RoomPage } from './features/rooms/RoomPage';
import { PlaygroundPage } from './features/playground/PlaygroundPage';
import { AttendancePage } from './features/attendance/AttendancePage';
import { AdminDashboardPage } from './features/admin/AdminDashboardPage';
import { PendingApprovalPage } from './features/auth/PendingApprovalPage';
import { CreateRoomPage } from './features/rooms/CreateRoomPage';
import { TeacherRouteGuard } from './components/auth/TeacherRouteGuard';
import { AdminRouteGuard } from './components/auth/AdminRouteGuard';
import { AiAssistantProvider } from './context/AiAssistantContext';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AiAssistantProvider>
          <BrowserRouter>
          <Routes>
            {/* Public routes (redirects to / if already logged in) */}
            <Route
              path="/signup"
              element={
                <PublicRoute>
                  <SignupPage />
                </PublicRoute>
              }
            />
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <LoginPage />
                </PublicRoute>
              }
            />
            {/* AC 1.1.3: Dedicated /signin route for sign in */}
            <Route
              path="/signin"
              element={
                <PublicRoute>
                  <LoginPage />
                </PublicRoute>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <PublicRoute>
                  <ForgotPasswordPage />
                </PublicRoute>
              }
            />

            {/* Password Reset landing page (standalone to allow recovery session handling) */}
            <Route
              path="/reset-password"
              element={<ResetPasswordPage />}
            />

            {/* US-2.2: Dedicated Administrative Routes with Route Guarding (AC 2.2.1, AC 2.2.2) */}
            <Route
              path="/admin"
              element={
                <AdminRouteGuard>
                  <AdminDashboardPage />
                </AdminRouteGuard>
              }
            />
            <Route
              path="/admin/users"
              element={
                <AdminRouteGuard>
                  <AdminDashboardPage />
                </AdminRouteGuard>
              }
            />
            <Route
              path="/admin/approvals"
              element={
                <AdminRouteGuard>
                  <AdminDashboardPage />
                </AdminRouteGuard>
              }
            />
            <Route
              path="/admin/*"
              element={
                <AdminRouteGuard>
                  <AdminDashboardPage />
                </AdminRouteGuard>
              }
            />

            {/* Standalone protected route for unapproved teacher gating screen (AC 2.1.2) */}
            <Route element={<ProtectedRoute />}>
              <Route path="/pending-approval" element={<PendingApprovalPage />} />
            </Route>

            {/* Protected routes wrapped with authentication check and layout */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                {/* US-2.1 AC 2.1.1: Teacher feature protection & pending approval gate */}
                <Route
                  path="/create-room"
                  element={
                    <TeacherRouteGuard>
                      <CreateRoomPage />
                    </TeacherRouteGuard>
                  }
                />
                <Route path="/rooms/:id" element={<RoomPage />} />
                <Route path="/rooms/:id/attendance" element={<AttendancePage />} />
                <Route path="/rooms/:roomId/attendance" element={<AttendancePage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                {/* Fallback for logged-in unknown routes */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>

            {/* Fallback: redirect any unknown or unauthenticated route to /login */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
        </AiAssistantProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
