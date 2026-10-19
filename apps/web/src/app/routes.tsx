import { Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/app-shell';
import { RequireAdmin, RequireAuth, ScrollToTop } from '@/components/route-guards';
import { AccountPage } from '@/pages/AccountPage';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProductDetailPage } from '@/pages/ProductDetailPage';
import { ProductFormPage } from '@/pages/ProductFormPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { UsersPage } from '@/pages/UsersPage';

export function AppRoutes() {
  return (
    <>
      <ScrollToTop />

      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <RequireAuth>
              <AppShell>
                <Outlet />
              </AppShell>
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<ProductFormPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/products/:id/edit" element={<ProductFormPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route
            path="/users"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
