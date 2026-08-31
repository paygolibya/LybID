import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AuthProvider } from './lib/auth';
import { ApplicantDetail } from './pages/ApplicantDetail';
import { BusinessDetail } from './pages/BusinessDetail';
import { Login } from './pages/Login';
import { TenantDetail } from './pages/TenantDetail';
import { TenantsList } from './pages/TenantsList';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/tenants"
          element={
            <RequireAuth>
              <TenantsList />
            </RequireAuth>
          }
        />
        <Route
          path="/tenants/:tenantId"
          element={
            <RequireAuth>
              <TenantDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/tenants/:tenantId/applicants/:applicantId"
          element={
            <RequireAuth>
              <ApplicantDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/tenants/:tenantId/businesses/:businessId"
          element={
            <RequireAuth>
              <BusinessDetail />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/tenants" replace />} />
      </Routes>
    </AuthProvider>
  );
}
