import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { syncCatalogInBackground } from "@/lib/offline-catalog";
import {
  syncCustomersInBackground,
  syncDefaultSellerName,
  syncPaymentTerms,
} from "@/lib/offline-customers";
import { syncPendingData } from "@/lib/offline-queue";

function syncEverythingInBackground() {
  syncCatalogInBackground();
  syncCustomersInBackground();
  syncDefaultSellerName();
  syncPaymentTerms();
  syncPendingData().catch(() => {});
}

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!user) return;
    // Baixa catálogo, clientes e vendedor padrão para uso offline assim que
    // o app abre, e envia qualquer pedido/cliente pendente. Repete sempre
    // que a conexão voltar, e a cada 2 minutos enquanto o app está aberto.
    syncEverythingInBackground();
    const onOnline = () => syncEverythingInBackground();
    window.addEventListener("online", onOnline);
    const interval = setInterval(syncEverythingInBackground, 120_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
