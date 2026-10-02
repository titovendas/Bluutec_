import { Link, useLocation, useRouter } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  UserCircle,
  Settings,
  Menu,
  LogOut,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import uzzyLogo from "@/assets/uzzy-logo.png";
import { CatalogSyncStatus } from "@/components/layout/catalog-sync-status";

const SIDEBAR_COLLAPSED_KEY = "fv:sidebar-collapsed";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/pedidos", label: "Pedidos", icon: ShoppingCart },
  { to: "/vendedores", label: "Vendedores", icon: UserCircle },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function NavLink({
  to,
  label,
  icon: Icon,
  onClick,
  collapsed,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  const location = useLocation();
  const active =
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && (
        <>
          {label}
          {active && <ChevronRight className="ml-auto h-4 w-4 opacity-70" />}
        </>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  const SidebarContent = (collapsedView: boolean) => (
    <div className="flex h-full flex-col bg-sidebar">
      <div
        className={cn(
          "flex h-16 items-center gap-2 border-b border-sidebar-border px-4",
          collapsedView && "justify-center px-2"
        )}
      >
        {collapsedView ? (
          <img src={uzzyLogo} alt="UZZY Ferramentas" className="h-7 w-auto" />
        ) : (
          <img src={uzzyLogo} alt="UZZY Ferramentas" className="h-8 w-auto" />
        )}
        <span className="sr-only">UZZY Ferramentas</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            collapsed={collapsedView}
            onClick={() => setOpen(false)}
          />
        ))}
      </nav>

      <div className="space-y-3 border-t border-border p-3">
        {!collapsedView && <CatalogSyncStatus />}
        <Button
          variant="ghost"
          title={collapsedView ? "Sair" : undefined}
          className={cn(
            "w-full text-muted-foreground hover:text-foreground",
            collapsedView ? "justify-center px-2" : "justify-start"
          )}
          onClick={handleSignOut}
        >
          <LogOut className={cn("h-4 w-4", !collapsedView && "mr-2")} />
          {!collapsedView && "Sair"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-border transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="relative h-full">
          {SidebarContent(collapsed)}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
          >
            {collapsed ? (
              <ChevronsRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronsLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </aside>

      {/* Mobile header + sheet */}
      <div className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:hidden">
        <img src={uzzyLogo} alt="UZZY Ferramentas" className="h-8 w-auto" />

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            {SidebarContent(false)}
          </SheetContent>
        </Sheet>
      </div>

      <main className="min-w-0 flex-1 pt-16 lg:pt-0">
        <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
