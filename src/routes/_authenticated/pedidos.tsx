import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderStatusBadge, orderRowClass } from "@/components/orders/status-badge";
import { deleteOrder } from "@/lib/sales.functions";
import { listOrdersMerged, queueOrderDelete } from "@/lib/offline-queue";
import { formatCurrency, formatDate, orderNumberLabel } from "@/lib/sales-formatters";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pedidos")({
  component: OrdersPage,
  head: () => ({
    meta: [
      { title: "Pedidos | Força de Vendas" },
      { name: "description", content: "Gerencie seus pedidos de venda." },
    ],
  }),
});

function OrdersPage() {
  const queryClient = useQueryClient();
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => listOrdersMerged(),
  });

  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const term = search.trim().toLowerCase();
  const numberTerm = term.replace(/^#0*/, "");
  const filtered = orders.filter(
    (o: any) =>
      !term ||
      o.customer_name?.toLowerCase().includes(term) ||
      o.seller_name?.toLowerCase().includes(term) ||
      (numberTerm !== "" && String(o.order_number ?? "").includes(numberTerm))
  );


  const handleDelete = async () => {
    if (!deleteId) return;
    setLoading(true);
    const isOnline = typeof navigator === "undefined" || navigator.onLine;
    try {
      if (isOnline && !deleteId.startsWith("local-order-")) {
        try {
          await deleteOrder({ data: { id: deleteId } });
        } catch {
          await queueOrderDelete(deleteId);
        }
      } else {
        await queueOrderDelete(deleteId);
      }
      toast.success("Pedido removido");
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover pedido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground">
            Acompanhe e gerencie seus pedidos de venda.
          </p>
        </div>
        <Button asChild>
          <Link to="/pedidos/novo">
            <Plus className="mr-2 h-4 w-4" /> Novo pedido
          </Link>
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, vendedor ou nº do pedido..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-muted-foreground"
                >
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-muted-foreground"
                >
                  Nenhum pedido encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((order: any) => {
                const isConfirmed = order.status === "pedido";
                return (
                  <TableRow key={order.id!} className={orderRowClass(order.status)}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {orderNumberLabel(order)}
                      {order.__pending && (
                        <span className="mt-1 block w-fit rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">
                          aguardando sincronização
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[140px]">{order.customer_name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(order.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCurrency(order.total)}
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="outline" size="sm" asChild>
                          <Link to="/pedidos/$id" params={{ id: order.id! }}>
                            Ver
                          </Link>
                        </Button>
                        {!isConfirmed && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to="/pedidos/$id/editar" params={{ id: order.id! }}>
                              Editar
                            </Link>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteId(order.id!)}
                        >
                          Excluir
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover pedido</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja remover este pedido? Esta ação não pode ser
            desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
