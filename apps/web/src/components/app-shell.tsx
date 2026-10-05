import { NavLink, useNavigate } from 'react-router-dom';
import {
  Boxes,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  type LucideIcon,
  Package,
  Tags,
  UserCog,
  Users,
} from 'lucide-react';
import { useState } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { MustChangePasswordPrompt } from '@/components/route-guards';
import { useAuth } from '@/hooks/use-auth';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The application shell.
 *
 * Two navigations, deliberately: a bottom bar for the four things a shop does all
 * day, and a drawer behind the account avatar for everything else. Bottom
 * navigation is the pattern that works one-handed on a phone in a stockroom, and
 * four targets is the most that stays unambiguous at that size. Adding a fifth
 * ("More") would mean nesting one more tap in front of every rare action.
 */

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Hidden from Staff, matching the server's role guards. */
  adminOnly?: boolean;
}

const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inventory', label: 'Stock', icon: Boxes },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/history', label: 'History', icon: History },
];

const SECONDARY_NAV: readonly NavItem[] = [
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const visibleSecondary = SECONDARY_NAV.filter((item) => !item.adminOnly || isAdmin);

  async function handleSignOut() {
    await signOut();
    // Navigated explicitly rather than relying on the guard: sign-out clears the
    // cached session, so the guard would redirect anyway, but doing it here keeps
    // the order obvious and avoids a render of a half-signed-out shell.
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <MustChangePasswordPrompt />

      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold leading-tight">Inventory</span>
            <span className="truncate text-xs leading-tight text-muted-foreground">
              {user?.name}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <AccountMenu />

            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="Open menu" className="sm:hidden" />
                }
              >
                <Menu aria-hidden />
              </SheetTrigger>

              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>

                <nav className="flex flex-col gap-1 px-4">
                  {visibleSecondary.map((item) => (
                    <DrawerLink key={item.to} item={item} onNavigate={setDrawerOpen} />
                  ))}

                  <NavLink
                    to="/account"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60"
                  >
                    <UserCog aria-hidden className="size-4" />
                    Account &amp; password
                  </NavLink>
                </nav>

                <div className="mt-auto border-t p-4">
                  <p className="mb-2 truncate text-xs text-muted-foreground">{user?.email}</p>
                  <Button variant="outline" className="w-full" onClick={handleSignOut}>
                    <LogOut aria-hidden data-icon="inline-start" />
                    Sign out
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-24">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        aria-label="Primary"
      >
        <ul className="pb-safe mx-auto grid max-w-5xl grid-cols-4">
          {PRIMARY_NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      aria-hidden
                      className={cn('size-5', isActive && 'text-foreground')}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function DrawerLink({ item, onNavigate }: { item: NavItem; onNavigate: (open: boolean) => void }) {
  return (
    <NavLink
      to={item.to}
      onClick={() => onNavigate(false)}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
        )
      }
    >
      <item.icon aria-hidden className="size-4" />
      {item.label}
    </NavLink>
  );
}

/**
 * The account chip shown in the header on wide screens.
 *
 * Separate from the sheet because at desktop width a persistent avatar is a cheaper
 * route to sign-out than a hamburger that opens a drawer.
 */
export function AccountMenu() {
  const { user, isAdmin, signOut } = useAuth();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="hidden gap-2 sm:flex">
            <Avatar size="sm">
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden lg:inline">{user.name}</span>
            {isAdmin ? (
              <span className="text-xs text-muted-foreground">Admin</span>
            ) : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<NavLink to="/account" />}>Account &amp; password</DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem render={<NavLink to="/users" />}>Manage users</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
          <LogOut aria-hidden data-icon="inline-start" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
