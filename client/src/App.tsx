import { createBrowserRouter, RouterProvider, NavLink, Outlet, Link } from 'react-router';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@databricks/appkit-ui/react';
import {
  Award,
  BotMessageSquare,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  PlayCircle,
  ShieldCheck,
  Trash2,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { AppDataProvider, useAppData } from '@/lib/AppData';
import { Onboarding } from '@/pages/Onboarding';
import { Dashboard } from '@/pages/Dashboard';
import { ModulePage } from '@/pages/ModulePage';
import { LakebasePage } from '@/pages/LakebasePage';
import { DemoPage } from '@/pages/DemoPage';
import { FitPage } from '@/pages/FitPage';
import { AskPage } from '@/pages/AskPage';
import { PricingPage } from '@/pages/PricingPage';
import { AdminPage } from '@/pages/AdminPage';
import { CertificatePage } from '@/pages/CertificatePage';
import { LeaderboardPage } from '@/pages/LeaderboardPage';
import { VerifyPage } from '@/pages/VerifyPage';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground shadow-sm'
      : 'text-white/80 hover:bg-white/10 hover:text-white'
  }`;

function NavLinks() {
  const { config, isAdmin } = useAppData();
  const items: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/ask', label: 'Ask Lakebase', icon: BotMessageSquare },
    { to: '/demo', label: 'Demo', icon: PlayCircle },
    { to: '/fit', label: 'Fit-checker', icon: ClipboardCheck },
    { to: '/pricing', label: 'Pricing', icon: CircleDollarSign },
    ...(config.program.leaderboard.enabled ? [{ to: '/leaderboard', label: 'Leaderboard', icon: Trophy }] : []),
    ...(config.program.certificate.enabled ? [{ to: '/certificate', label: 'Certificate', icon: Award }] : []),
    { to: '/lakebase', label: 'Lakebase', icon: Database },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: ShieldCheck }] : []),
  ];

  return (
    <nav aria-label="Main" className="nav-scroll -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-2.5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={navLinkClass}>
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function UserMenu() {
  const { partner, signOut, reset } = useAppData();
  if (!partner) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-2.5 text-sm text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-primary">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initials(partner.name)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden max-w-[10rem] truncate sm:inline">{partner.name}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate text-sm font-semibold">{partner.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{partner.email}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{partner.org}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>
            Sign out
            <span className="block text-xs text-muted-foreground">Your results stay saved</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            if (
              confirm(
                'Permanently delete your saved module results?\n\nThis removes them from Lakebase too and cannot be undone. To simply leave, use “Sign out” instead.',
              )
            ) {
              reset();
            }
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          <span>
            Delete my saved results
            <span className="block text-xs opacity-80">Cannot be undone</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Layout() {
  const { config, lakebase } = useAppData();

  return (
    <div className="app-bg flex min-h-screen flex-col">
      <header className="app-chrome sticky top-0 z-30 border-b border-white/10 px-4 shadow-md md:px-6 print:hidden">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3 py-3">
            <Link to="/" className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
                <GraduationCap className="h-5 w-5 text-primary-foreground" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block max-w-[11rem] truncate text-sm font-semibold text-white sm:max-w-none sm:text-base">{config.branding.shortName}</span>
                <span className="hidden text-[11px] text-white/60 sm:block">{config.branding.org}</span>
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-2.5">
              {lakebase ? (
                <span
                  className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/90 sm:inline-flex"
                  title={lakebase.connected ? 'Your progress is saved in Lakebase' : (lakebase.error ?? 'Lakebase is not reachable')}
                >
                  <span className={`h-2 w-2 rounded-full ${lakebase.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {lakebase.connected ? 'Saved to Lakebase' : 'Browser only'}
                </span>
              ) : null}
              <UserMenu />
            </div>
          </div>
          <NavLinks />
        </div>
      </header>

      <main className="flex-1 px-4 py-8 md:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-border/70 px-4 py-4 text-center text-xs text-muted-foreground md:px-6 print:hidden">
        {config.branding.appName} · {config.branding.org}
      </footer>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/module/:moduleKey', element: <ModulePage /> },
      { path: '/ask', element: <AskPage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/certificate', element: <CertificatePage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/verify/:id', element: <VerifyPage /> },
      { path: '/pricing', element: <PricingPage /> },
      { path: '/demo', element: <DemoPage /> },
      { path: '/fit', element: <FitPage /> },
      { path: '/lakebase', element: <LakebasePage /> },
    ],
  },
]);

function Gate() {
  const { config, partner } = useAppData();
  // Certificate verification is public: a third party must not hit the sign-up wall.
  const isVerify = window.location.pathname.startsWith('/verify/');
  if (config.onboarding.enabled && !partner && !isVerify) {
    return <Onboarding />;
  }
  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <AppDataProvider>
      <Gate />
    </AppDataProvider>
  );
}
