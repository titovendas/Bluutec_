import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  Package,
  User,
  FileDown,
  FileText,
  FileSpreadsheet,
  Copy,
  Send,
  Undo2,
  Tag,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProductImage } from "@/components/products/product-image";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getOrder, updateOrderStatus, setOrderFactorySent } from "@/lib/sales.functions";
import { getOrderForDisplay, queueOrderUpsert } from "@/lib/offline-queue";
import {
  formatCurrency,
  formatDate,
  formatCurrency3,
  orderNumberLabel,
} from "@/lib/sales-formatters";
import { effectiveUnitPrice, priceTableLabel } from "@/lib/price-tables";
import { generateOrderPdf } from "@/lib/order-pdf";
import { buildOrderTxt, orderFileNumber } from "@/lib/order-txt";
import { fillFactorySheet, FACTORY_SHEET_UFS } from "@/lib/factory-sheet";
import { loadFactoryTemplate } from "@/lib/factory-template-client";
import {
  combinedDiscountFraction,
  politicaFraction,
  resolveOrderPriceTable,
} from "@/lib/price-tables";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pedidos_/$id")({
  component: OrderDetailPage,
  head: ({ params }) => ({
    meta: [
      { title: "Pedido | Força de Vendas" },
      { name: "description", content: "Detalhes do pedido." },
    ],
  }),
});

function OrderDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [txtOpen, setTxtOpen] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [buildingSheet, setBuildingSheet] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const local = await getOrderForDisplay(id);
      if (local) return local;
      return getOrder({ data: { id } });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const { order, items } = data;
  const isConfirmed = order.status === "pedido";
  const txt = isConfirmed ? buildOrderTxt(order, items) : "";
  const factorySentAt = ((order as any).factory_sent_at ?? null) as string | null;
  // Só dá para marcar o envio quando o pedido já está no servidor.
  const canMarkSent = isConfirmed && !(order as any).__pending && !id.startsWith("local-order-");

  const downloadTxt = () => {
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pedido-${orderFileNumber(order)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Planilha de pedido da fábrica (Excel), preenchida com este pedido.
  const downloadFactorySheet = async () => {
    setBuildingSheet(true);
    try {
      const cash = Number((order as any).cash_discount_percent ?? 0);
      const pickup = Number((order as any).pickup_discount_percent ?? 0);
      const policy = resolveOrderPriceTable((order as any).price_table, items as any[], cash, pickup);
      if (!policy) {
        throw new Error("O pedido está sem política comercial válida.");
      }
      const customer = (order as any).customer;
      const taxFree = customer?.customer_type === "construtora";
      const uf = String(customer?.state ?? "").trim().toUpperCase();
      if (!taxFree && !uf) {
        throw new Error("O cliente está sem estado cadastrado.");
      }
      if (!taxFree && !FACTORY_SHEET_UFS.includes(uf)) {
        throw new Error(`O estado ${uf} não existe na tabela de ST da planilha da fábrica.`);
      }

      const template = await loadFactoryTemplate();
      const result = await fillFactorySheet({
        template: template.bytes,
        customerName: String(customer?.name ?? ""),
        policyFraction: politicaFraction(policy),
        uf: uf || null,
        taxFree,
        paymentTerm: ((order as any).payment_term ?? null) as string | null,
        items: (items as any[]).map((item) => ({
          code: String(item.code ?? ""),
          quantity: Number(item.quantity ?? 0),
          discountFraction: combinedDiscountFraction(
            Number(item.discount_percent ?? 0),
            cash,
            pickup
          ),
        })),
      });
      if (result.missingCodes.length > 0) {
        throw new Error(
          `Estes códigos não existem no modelo da fábrica: ${result.missingCodes.join(", ")}. ` +
            "Envie a planilha mais recente em Configurações → Planilha da fábrica."
        );
      }

      const blob = new Blob([result.bytes as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pedido-${orderFileNumber(order)}-fabrica.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Planilha da fábrica gerada. Abra no Excel para conferir.");
      if (result.paymentTermWritten && !result.paymentTermMatched) {
        toast.warning(
          `O prazo "${result.paymentTermWritten}" não está na lista da planilha da fábrica: foi escrito como está, mas a planilha não calcula as parcelas.`
        );
      }
      if (!result.paymentTermWritten) {
        toast.warning("Este pedido está sem prazo de pagamento; o campo ficou vazio na planilha.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível gerar a planilha da fábrica.");
    } finally {
      setBuildingSheet(false);
    }
  };

  const copyTxt = async () => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("TXT copiado!");
    } catch {
      toast.error("Não foi possível copiar. Use o botão Baixar TXT.");
    }
  };

  const toggleFactorySent = async (sent: boolean) => {
    setMarkingSent(true);
    try {
      await setOrderFactorySent({ data: { id, sent } });
      toast.success(sent ? "Pedido marcado como enviado à fábrica." : "Marcação removida.");
      await queryClient.invalidateQueries({ queryKey: ["order", id] });
    } catch (err: any) {
      toast.error(err?.message || "Erro ao atualizar o pedido");
    } finally {
      setMarkingSent(false);
    }
  };

  const handleConfirmOrder = async () => {
    setConfirming(true);
    const isOnline = typeof navigator === "undefined" || navigator.onLine;
    const isPending = id.startsWith("local-order-");
    try {
      if (isOnline && !isPending) {
        await updateOrderStatus({ data: { id, status: "pedido" } });
        toast.success("Orçamento confirmado como pedido!");
      } else {
        const orderPayload = {
          customer_id: order.customer_id as string,
          status: "pedido" as any,
          price_table: (order as any).price_table,
          payment_term: (order as any).payment_term,
          cash_discount_percent: Number((order as any).cash_discount_percent ?? 0),
          pickup_discount_percent: Number((order as any).pickup_discount_percent ?? 0),
          notes: (order as any).notes ?? "",
          items: items.map((item: any) => ({
            catalog_product_id: item.catalog_product_id,
            code: item.code,
            description: item.description,
            image_url: item.image_url,
            quantity: item.quantity,
            table_price: Number(item.table_price ?? item.unit_price ?? 0),
            discount_percent: Number(item.discount_percent ?? 0),
            unit_price: Number(item.unit_price),
            ipi_percent: Number(item.ipi_percent ?? 0),
            st_percent: Number(item.st_percent ?? 0),
          })),
        };
        await queueOrderUpsert(id, orderPayload, (order as any).customer ?? null);
        toast.success(
          isOnline
            ? "Sem conexão com o servidor — confirmação salva no aparelho e será enviada automaticamente."
            : "Você está offline — confirmação salva no aparelho e será enviada quando a internet voltar."
        );
      }
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao confirmar pedido");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {isConfirmed && (
        <div className="flex items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            <strong>Pedido confirmado.</strong> Ele não pode mais ser
            alterado. Baixe o PDF e a planilha da fábrica para enviar.
          </p>
        </div>
      )}
      {canMarkSent && (
        <div
          className={
            factorySentAt
              ? "flex flex-col gap-3 rounded-md border border-sky-300 bg-sky-50 px-4 py-3 text-sky-800 sm:flex-row sm:items-center sm:justify-between"
              : "flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800 sm:flex-row sm:items-center sm:justify-between"
          }
        >
          <p className="text-sm">
            {factorySentAt ? (
              <>
                <strong>Enviado à fábrica</strong> em{" "}
                {new Date(factorySentAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                .
              </>
            ) : (
              <>
                <strong>Ainda não enviado à fábrica.</strong> Depois de enviar
                o e-mail, marque aqui.
              </>
            )}
          </p>
          {factorySentAt ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markingSent}
              onClick={() => toggleFactorySent(false)}
            >
              <Undo2 className="mr-2 h-4 w-4" /> Desmarcar
            </Button>
          ) : (
            <Button size="sm" disabled={markingSent} onClick={() => toggleFactorySent(true)}>
              <Send className="mr-2 h-4 w-4" /> Marcar como enviado
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link to="/pedidos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {isConfirmed ? "Pedido" : "Orçamento"}{" "}
              {orderNumberLabel(order as any) === "—"
                ? "(sem número ainda)"
                : orderNumberLabel(order as any)}
              {(order as any).__pending && (
                <span className="ml-3 align-middle rounded bg-amber-100 px-2 py-1 text-xs font-normal text-amber-700">
                  aguardando sincronização
                </span>
              )}
            </h1>
            <p className="text-muted-foreground">
              Criado em {formatDate(order.created_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await generateOrderPdf(order, items);
              } catch (err: any) {
                toast.error(err?.message || "Erro ao gerar o PDF");
              }
            }}
          >
            <FileDown className="mr-2 h-4 w-4" /> Baixar PDF
          </Button>
          {isConfirmed && (
            <Button variant="outline" onClick={() => setTxtOpen(true)}>
              <FileText className="mr-2 h-4 w-4" /> TXT do pedido
            </Button>
          )}
          {isConfirmed && (
            <Button variant="outline" onClick={downloadFactorySheet} disabled={buildingSheet}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {buildingSheet ? "Gerando..." : "Planilha da fábrica"}
            </Button>
          )}
          {!isConfirmed && (
            <>
              <Button asChild variant="outline">
                <Link to="/pedidos/$id/editar" params={{ id }}>
                  Editar orçamento
                </Link>
              </Button>
              <Button onClick={() => setConfirmOpen(true)}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar pedido
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {order.customer_name || "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderStatusBadge status={order.status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Política comercial</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {priceTableLabel((order as any).price_table)}
            </p>
          </CardContent>
        </Card>
      </div>

      {(order as any).notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{(order as any).notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Itens do pedido</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Foto</TableHead>
                <TableHead className="w-24">Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Unitário</TableHead>
                <TableHead className="text-right">ST</TableHead>
                <TableHead className="text-right">Unit. c/ impostos</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <ProductImage
                      src={item.image_url}
                      alt={item.description ?? "Produto"}
                      className="h-10 w-10"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.code || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.description || "—"}
                  </TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency3(effectiveUnitPrice(order as any, item))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(item.st_value)}
                    <span className="block text-xs text-muted-foreground">
                      {item.st_percent}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-bold text-primary">
                    {formatCurrency3(
                      effectiveUnitPrice(order as any, item) *
                        (1 +
                          (Number(item.ipi_percent) + Number(item.st_percent)) /
                            100)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(item.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(order.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">IPI</span>
                <span>{formatCurrency(order.ipi_total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ST (valor aprox.)</span>
                <span>{formatCurrency(order.st_total)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total</span>
                <span>{formatCurrency(order.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar pedido</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ao confirmar, este orçamento vira um pedido oficial.{" "}
            <strong>Não será mais possível editar</strong> depois de
            confirmado. Em seguida, baixe o TXT e envie o pedido para a
            fábrica.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmOrder} disabled={confirming}>
              {confirming ? "Confirmando..." : "Confirmar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={txtOpen} onOpenChange={setTxtOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>TXT do Pedido</DialogTitle>
          </DialogHeader>
          <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-4 font-mono text-sm text-slate-50">
            {txt || "Sem itens."}
          </pre>
          <p className="text-xs text-muted-foreground">
            Formato: código;quantidade;preço unitário sem impostos.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={downloadTxt} disabled={!txt}>
              <FileDown className="mr-2 h-4 w-4" /> Baixar TXT
            </Button>
            <Button variant="outline" onClick={copyTxt} disabled={!txt}>
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <Button variant="outline" onClick={() => setTxtOpen(false)}>
              Fechar
            </Button>
          </div>
          {canMarkSent && !factorySentAt && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm text-muted-foreground">
                Depois de enviar para a fábrica, marque o pedido como enviado.
              </p>
              <Button
                variant="secondary"
                className="w-full"
                disabled={markingSent}
                onClick={() => toggleFactorySent(true)}
              >
                <Send className="mr-2 h-4 w-4" /> Marcar como enviado à fábrica
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
