import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { SignupPage } from './features/auth/SignupPage';
import { LoginPage } from './features/auth/LoginPage';
import { DashboardPage } from './features/dashboard/DashboardPage';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          {/* US-AUTH-01: Sign Up route */}
          <Route path="/signup" element={<SignupPage />} />
          
          {/* US-AUTH-02: Login route */}
          <Route path="/login" element={<LoginPage />} />
          
          {/* US-DASH: Dashboard route */}
          <Route path="/" element={<DashboardPage />} />
          
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/signup" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;
