import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertOrder } from "@/lib/sales.functions";
import { listCustomersMerged, queueOrder } from "@/lib/offline-queue";
import { OrderForm, type FormItem } from "@/components/orders/order-form";
import type { PriceTable } from "@/lib/price-tables";
import { readOrderDraft, saveOrderDraft, clearOrderDraft } from "@/lib/order-draft";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pedidos_/novo")({
  component: NewOrderPage,
  head: () => ({
    meta: [
      { title: "Novo Pedido | UZZY Ferramentas" },
      {
        name: "description",
        content:
          "Monte um pedido UZZY com catálogo, tabela de preço, IPI e ST calculados.",
      },
      { property: "og:title", content: "Novo Pedido | UZZY Ferramentas" },
      {
        property: "og:description",
        content: "Monte um pedido com catálogo e impostos calculados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => listCustomersMerged(),
  });

  // Lê um possível rascunho salvo antes de montar o estado inicial, para
  // restaurar automaticamente se o usuário saiu da página sem terminar.
  const initialDraft = useRef(readOrderDraft()).current;
  const [draftRestored] = useState(!!initialDraft);

  const [customerId, setCustomerId] = useState(initialDraft?.customerId ?? "");
  const [priceTable, setPriceTable] = useState<PriceTable>(
    (initialDraft?.priceTable as PriceTable) ?? "varejo_10"
  );
  const [paymentTerm, setPaymentTerm] = useState(initialDraft?.paymentTerm ?? "");
  const [items, setItems] = useState<FormItem[]>(initialDraft?.items ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (draftRestored) {
      toast.info("Rascunho restaurado — você pode continuar de onde parou.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salva o rascunho automaticamente a cada alteração, para não perder o
  // orçamento se sair da página sem querer.
  useEffect(() => {
    saveOrderDraft({ customerId, priceTable, paymentTerm, items });
  }, [customerId, priceTable, paymentTerm, items]);

  const handleDiscardDraft = () => {
    clearOrderDraft();
    setCustomerId("");
    setPriceTable("varejo_10");
    setPaymentTerm("");
    setItems([]);
    toast.success("Rascunho descartado");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      toast.error("Selecione o cliente");
      return;
    }
    if (items.length === 0) {
      toast.error("Adicione pelo menos um produto ao pedido");
      return;
    }
    setLoading(true);
    const orderPayload = {
      customer_id: customerId,
      status: "orcamento" as any,
      price_table: priceTable,
      payment_term: paymentTerm,
      items: items.map(({ prices, ...item }) => item),
    };
    const isOnline = typeof navigator === "undefined" || navigator.onLine;

    try {
      if (isOnline) {
        try {
          const result = await upsertOrder({ data: orderPayload });
          toast.success("Pedido criado com sucesso");
          clearOrderDraft();
          queryClient.invalidateQueries({ queryKey: ["orders"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
          navigate({ to: "/pedidos/$id", params: { id: result.id! } });
          return;
        } catch (err: any) {
          // Sem conexão com o servidor mesmo online (ex: instabilidade) —
          // guarda localmente e segue.
        }
      }

      const customerSnapshot =
        customers.find((c: any) => c.id === customerId) ?? null;
      const record = await queueOrder(orderPayload, customerSnapshot);
      clearOrderDraft();
      toast.success(
        isOnline
          ? "Sem conexão com o servidor — pedido salvo no aparelho e será enviado automaticamente."
          : "Você está offline — pedido salvo no aparelho e será enviado quando a internet voltar."
      );
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate({ to: "/pedidos/$id", params: { id: record.localId } });
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar pedido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Novo orçamento</h1>
          <p className="text-muted-foreground">
            Selecione a tabela de preço e monte o orçamento pelo catálogo.
          </p>
        </div>
        {draftRestored && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleDiscardDraft}
          >
            <X className="mr-1.5 h-3.5 w-3.5" /> Descartar rascunho
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <OrderForm
          customers={customers}
          customerId={customerId}
          setCustomerId={setCustomerId}
          priceTable={priceTable}
          setPriceTable={setPriceTable}
          paymentTerm={paymentTerm}
          setPaymentTerm={setPaymentTerm}
          items={items}
          setItems={setItems}
        />

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearOrderDraft();
              navigate({ to: "/pedidos" });
            }}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Salvando..." : "Salvar orçamento"}
          </Button>
        </div>
      </form>
    </div>
  );
}
