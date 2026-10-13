import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen ambient-bg flex flex-col transition-colors duration-300">
      <Header />
      <div className="flex-1 flex flex-col">
        <Outlet />
      </div>
    </div>
  );
};
