import { Navigate, Route, Routes } from 'react-router-dom';

import { SystemStatusPage } from '@/pages/SystemStatusPage';

/**
 * The full page set lands in Phase 6. Only the foundation check is routed now so
 * that this phase has something real to verify rather than a stub.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SystemStatusPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
