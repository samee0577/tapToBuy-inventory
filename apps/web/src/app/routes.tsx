import { Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/app-shell';
import { RequireAdmin, RequireAuth, ScrollToTop } from '@/components/route-guards';
import { AccountPage } from '@/pages/AccountPage';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProductDetailPage } from '@/pages/ProductDetailPage';
import { ProductFormPage } from '@/pages/ProductFormPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { UsersPage } from '@/pages/UsersPage';

/**
 * The route table.
 *
 * Two groups rather than a flat list with guards repeated on every entry:
 *
 *  - `/login` sits outside the authenticated layout, because a signed-in user has no
 *    business in the sign-in form — and because the API redirects the browser back
 *    here after a Google failure, so the path has to render whatever state the
 *    session happens to be in.
 *  - Everything else goes through one pathless route that supplies the guard and the
 *    shell. A new screen therefore cannot be added without inheriting both, and the
 *    shell's navigation and sign-out are impossible to forget on a page.
 *
 * The guard is presentation, not control. The `requireRole` middleware on the
 * server is what actually refuses an administrator-only request, and it is the only
 * thing that can be trusted — a user who edits this bundle to reveal `/users` still
 * gets a 403 on every call.
 */
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
          <Route path="/inventory" element={<InventoryPage />} />
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
