import { createBrowserRouter, RouterProvider, NavLink, Outlet, Link } from 'react-router';
import { useState } from 'react';
import {
  Button,
  Badge,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import { Menu, GraduationCap, RotateCcw } from 'lucide-react';
import { AppDataProvider, useAppData } from '@/lib/AppData';
import { Onboarding } from '@/pages/Onboarding';
import { Dashboard } from '@/pages/Dashboard';
import { ModulePage } from '@/pages/ModulePage';
import { PlanPage } from '@/pages/PlanPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

type NavLinkClassFn = (props: { isActive: boolean }) => string;

function NavLinks({ linkClass, onClick, className }: { linkClass: NavLinkClassFn; onClick?: () => void; className?: string }) {
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass} onClick={onClick}>
        Dashboard
      </NavLink>
      <NavLink to="/plan" className={linkClass} onClick={onClick}>
        Adoption plan
      </NavLink>
    </nav>
  );
}

function Layout() {
  const { config, partner, reset } = useAppData();
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </span>
            <span className="text-base font-semibold text-foreground">{config.branding.shortName}</span>
          </Link>
          <NavLinks className="hidden gap-1 md:flex" linkClass={navLinkClass} />
          <div className="ml-auto flex items-center gap-2">
            {partner ? (
              <Badge variant="outline" className="hidden sm:inline-flex">
                {partner.name || partner.email}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              title="Reset progress"
              onClick={() => {
                if (confirm('Reset your profile and all module progress on this browser?')) reset();
              }}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="sr-only">Reset progress</span>
            </Button>
            <div className="md:hidden">
              <Sheet open={mobileNavOpen && isMobile} onOpenChange={setMobileNavOpen}>
                <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>{config.branding.shortName}</SheetTitle>
                  </SheetHeader>
                  <NavLinks
                    className="mt-4 flex flex-col gap-1"
                    linkClass={mobileNavLinkClass}
                    onClick={() => setMobileNavOpen(false)}
                  />
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 md:px-6">
        <Outlet />
      </main>

      <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground md:px-6">
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
      { path: '/plan', element: <PlanPage /> },
    ],
  },
]);

function Gate() {
  const { config, partner } = useAppData();
  if (config.onboarding.enabled && !partner) {
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
