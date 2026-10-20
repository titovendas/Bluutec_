import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2, ImageDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  syncCatalog,
  getCatalogSyncedAt,
  getOfflineCatalogCount,
  prefetchAllProductImages,
} from "@/lib/offline-catalog";
import {
  syncPendingData,
  pendingCount,
  listPendingItems,
  discardPendingItem,
  type PendingItemInfo,
} from "@/lib/offline-queue";
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
  const queryClient = useQueryClient();
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItemInfo[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const loadPendingItems = async () => setPendingItems(await listPendingItems());

  const openPending = async () => {
    await loadPendingItems();
    setConfirmDiscard(null);
    setPendingOpen(true);
  };

  const handleDiscard = async (key: string) => {
    await discardPendingItem(key);
    setConfirmDiscard(null);
    await loadPendingItems();
    await refreshStatus();
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    toast.success("Item removido da fila.");
  };

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
      if (result.syncedCustomers + result.syncedOrders + result.alreadyOnServer + result.staleSkipped > 0) {
        toast.success(
          result.syncedCustomers + result.syncedOrders > 0
            ? `Sincronizado: ${result.syncedCustomers} cliente(s), ${result.syncedOrders} pedido(s).`
            : "Fila limpa."
        );
        if (result.alreadyOnServer > 0) {
          toast.info(
            `${result.alreadyOnServer} pedido(s) já estavam no servidor e foram tirados da fila (sem duplicar).`
          );
        }
        if (result.staleSkipped > 0) {
          toast.info(
            `${result.staleSkipped} edição(ões) antiga(s) foram ignoradas: o pedido já tinha sido atualizado depois no servidor.`
          );
        }
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["order"] });
        queryClient.invalidateQueries({ queryKey: ["customers"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      if (pendingOpen) await loadPendingItems();
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
        <button
          type="button"
          onClick={openPending}
          className="text-left font-medium text-amber-700 underline underline-offset-2"
        >
          {pending} {pending === 1 ? "item" : "itens"} aguardando
          sincronização — ver detalhes
        </button>
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

      <Dialog open={pendingOpen} onOpenChange={setPendingOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Aguardando sincronização</DialogTitle>
            <DialogDescription>
              Itens feitos neste aparelho que ainda não foram confirmados no
              servidor. Se algum já aparece na lista de pedidos, ele pode ser
              descartado daqui sem perder nada.
            </DialogDescription>
          </DialogHeader>

          {pendingItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nada aguardando. Tudo sincronizado.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingItems.map((item) => (
                <div key={item.key} className="space-y-1.5 rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase">
                          {item.kind} · {item.action}
                        </span>
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.detail} · {new Date(item.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </div>
                  {item.error && (
                    <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                      Último erro: {item.error}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    {confirmDiscard === item.key ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(null)}>
                          Cancelar
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDiscard(item.key)}>
                          Confirmar descarte
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setConfirmDiscard(item.key)}
                      >
                        Descartar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingOpen(false)}>
              Fechar
            </Button>
            <Button onClick={handleSync} disabled={syncing || !online}>
              {syncing ? "Sincronizando..." : "Tentar sincronizar agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
