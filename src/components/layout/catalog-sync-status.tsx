import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2, ImageDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  syncCatalog,
  getCatalogSyncedAt,
  getOfflineCatalogCount,
  prefetchAllProductImages,
} from "@/lib/offline-catalog";
import { syncPendingData, pendingCount } from "@/lib/offline-queue";
import { toast } from "sonner";

function formatSyncedAt(iso: string | null) {
  if (!iso) return "nunca sincronizado";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `hoje às ${time}`;
  return `${date.toLocaleDateString("pt-BR")} às ${time}`;
}

export function CatalogSyncStatus() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [imageProgress, setImageProgress] = useState<string | null>(null);

  const refreshStatus = async () => {
    setSyncedAt(await getCatalogSyncedAt());
    setCount(await getOfflineCatalogCount());
    setPending(await pendingCount());
  };

  useEffect(() => {
    refreshStatus();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = setInterval(refreshStatus, 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncCatalog();
      const result = await syncPendingData();
      await refreshStatus();
      if (result.syncedCustomers + result.syncedOrders > 0) {
        toast.success(
          `Sincronizado: ${result.syncedCustomers} cliente(s), ${result.syncedOrders} pedido(s).`
        );
      }
      if (result.failed > 0) {
        toast.error(
          result.errors[0] ||
            `${result.failed} item(ns) não sincronizaram. Tentaremos de novo automaticamente.`
        );
      }
    } catch {
      toast.error("Não foi possível sincronizar agora. Verifique a conexão.");
    } finally {
      setSyncing(false);
    }
  };

  const handleDownloadImages = async () => {
    setDownloadingImages(true);
    setImageProgress("Iniciando...");
    try {
      const result = await prefetchAllProductImages((done, total) => {
        setImageProgress(`${done} de ${total}`);
      });
      if (result.total === 0) {
        toast.info("Sincronize o catálogo primeiro.");
      } else {
        toast.success(
          `${result.downloaded} de ${result.total} fotos salvas para uso offline.`
        );
      }
    } catch {
      toast.error("Não foi possível baixar as fotos agora.");
    } finally {
      setDownloadingImages(false);
      setImageProgress(null);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
      <div className="flex items-center gap-1.5">
        {online ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-amber-600" />
        )}
        <span className="font-medium text-foreground">
          {online ? "Online" : "Modo offline"}
        </span>
      </div>
      <p className="text-muted-foreground">
        Catálogo local: {count > 0 ? `${count} produtos` : "vazio"}
      </p>
      <p className="text-muted-foreground">
        Atualizado {formatSyncedAt(syncedAt)}
      </p>
      {pending > 0 && (
        <p className="font-medium text-amber-700">
          {pending} {pending === 1 ? "item" : "itens"} aguardando
          sincronização
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={handleSync}
        disabled={syncing || !online}
      >
        <RefreshCw className={`mr-1.5 h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Sincronizando..." : "Sincronizar agora"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={handleDownloadImages}
        disabled={downloadingImages || !online}
        title="Baixa as fotos de todos os produtos do catálogo para aparecerem mesmo sem internet"
      >
        <ImageDown className="mr-1.5 h-3 w-3" />
        {downloadingImages
          ? `Baixando fotos... ${imageProgress ?? ""}`
          : "Baixar fotos p/ offline"}
      </Button>
    </div>
  );
}
