import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { PublicRoute } from './components/auth/PublicRoute';
import { AppLayout } from './components/layout/AppLayout';
import { SignupPage } from './features/auth/SignupPage';
import { LoginPage } from './features/auth/LoginPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { RoomPage } from './features/rooms/RoomPage';
import { PlaygroundPage } from './features/playground/PlaygroundPage';
import { AttendancePage } from './features/attendance/AttendancePage';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
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

            {/* Protected routes wrapped with authentication check and layout */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/rooms/:id" element={<RoomPage />} />
                <Route path="/rooms/:id/attendance" element={<AttendancePage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                {/* Fallback for logged-in unknown routes */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>

            {/* Fallback: redirect any unknown or unauthenticated route to /login */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
