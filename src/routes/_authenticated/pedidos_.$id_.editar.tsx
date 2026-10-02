import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Lock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getOrder, upsertOrder } from "@/lib/sales.functions";
import {
  listCustomersMerged,
  getOrderForDisplay,
  queueOrderUpsert,
} from "@/lib/offline-queue";
import { getCatalogProductsByIdsOfflineAware } from "@/lib/offline-catalog";
import { OrderForm, type FormItem } from "@/components/orders/order-form";
import { computeNetUnitPrice, type PriceTable } from "@/lib/price-tables";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pedidos_/$id_/editar")({
  component: EditOrderPage,
  head: ({ params }) => ({
    meta: [
      { title: `Editar Orçamento #${params.id.slice(0, 8)} | Força de Vendas` },
      { name: "description", content: "Edite o orçamento Bluutec." },
      { property: "og:title", content: "Editar Orçamento | Força de Vendas" },
      { property: "og:description", content: "Edite o orçamento Bluutec." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function EditOrderPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: orderData, isLoading: orderLoading } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const local = await getOrderForDisplay(id);
      if (local) return local;
      return getOrder({ data: { id } });
    },
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => listCustomersMerged(),
  });
  const [customerId, setCustomerId] = useState("");
  const [originalStatus, setOriginalStatus] = useState("orcamento");
  const [priceTable, setPriceTable] = useState<PriceTable>("varejo");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [cashDiscountPercent, setCashDiscountPercent] = useState(0);
  const [pickupDiscountPercent, setPickupDiscountPercent] = useState(0);
  const [items, setItems] = useState<FormItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderData) return;
    const order: any = orderData.order;
    setCustomerId(order.customer_id || "");
    setOriginalStatus(order.status || "orcamento");
    setPriceTable((order.price_table as PriceTable) || "varejo");
    setPaymentTerm(order.payment_term || "");
    setCashDiscountPercent(Number(order.cash_discount_percent ?? 0));
    setPickupDiscountPercent(Number(order.pickup_discount_percent ?? 0));

    const rawItems = orderData.items;
    setItems(
      rawItems.map((item: any) => ({
        catalog_product_id: item.catalog_product_id,
        code: item.code ?? "",
        description: item.description ?? "",
        image_url: item.image_url ?? null,
        quantity: item.quantity,
        // Pedidos criados antes da tabela de preços da Bluutec não têm
        // table_price salvo — nesse caso, usa o próprio unit_price como
        // provisório até o catálogo real ser buscado abaixo.
        table_price: Number(item.table_price ?? item.unit_price ?? 0),
        discount_percent: Number(item.discount_percent ?? 0),
        ipi_percent: Number(item.ipi_percent ?? 0),
        st_percent: Number(item.st_percent ?? 0),
      }))
    );

    // Busca o preço de tabela atual no catálogo, para refletir eventuais
    // atualizações de preço desde que o orçamento foi criado.
    const ids = rawItems
      .map((item: any) => item.catalog_product_id)
      .filter(Boolean);
    if (ids.length > 0) {
      getCatalogProductsByIdsOfflineAware(ids).then((catalogMap) => {
        setItems((prev) =>
          prev.map((item) => {
            const product = catalogMap.get(item.catalog_product_id);
            if (!product) return item;
            return {
              ...item,
              table_price: Number(
                product.table_price ?? product.price_atacado ?? item.table_price
              ),
            };
          })
        );
      });
    }
  }, [orderData]);

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
    const isOnline = typeof navigator === "undefined" || navigator.onLine;
    const isPending = id.startsWith("local-order-");
    const orderPayload = {
      customer_id: customerId,
      status: originalStatus as any,
      price_table: priceTable,
      payment_term: paymentTerm,
      cash_discount_percent: cashDiscountPercent,
      pickup_discount_percent: pickupDiscountPercent,
      items: items.map((item) => ({
        ...item,
        unit_price: computeNetUnitPrice(
          item.table_price,
          priceTable,
          item.discount_percent,
          cashDiscountPercent,
          pickupDiscountPercent
        ),
      })),
    };

    const saveLocally = async () => {
      const customerSnapshot =
        customers.find((c: any) => c.id === customerId) ?? null;
      await queueOrderUpsert(id, orderPayload, customerSnapshot);
    };

    try {
      if (isOnline && !isPending) {
        try {
          await upsertOrder({ data: { id, ...orderPayload } });
          toast.success("Orçamento atualizado com sucesso");
        } catch (err: any) {
          await saveLocally();
          toast.success(
            "Sem conexão com o servidor — edição salva no aparelho e será enviada automaticamente."
          );
        }
      } else {
        await saveLocally();
        toast.success(
          isOnline
            ? "Orçamento atualizado (ainda aguardando sincronização)"
            : "Você está offline — edição salva no aparelho e será enviada quando a internet voltar."
        );
      }
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      navigate({ to: "/pedidos/$id", params: { id } });
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar orçamento");
    } finally {
      setLoading(false);
    }
  };

  if (orderLoading || !orderData) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (originalStatus === "pedido") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-lg font-medium">Este pedido já foi confirmado</p>
          <p className="text-muted-foreground">
            Pedidos confirmados e enviados para faturamento não podem mais
            ser editados.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/pedidos/$id" params={{ id }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao pedido
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Editar orçamento</h1>
        <p className="text-muted-foreground">Atualize os dados do orçamento.</p>
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
          cashDiscountPercent={cashDiscountPercent}
          setCashDiscountPercent={setCashDiscountPercent}
          pickupDiscountPercent={pickupDiscountPercent}
          setPickupDiscountPercent={setPickupDiscountPercent}
          items={items}
          setItems={setItems}
        />

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/pedidos/$id", params: { id } })}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Salvando..." : "Atualizar orçamento"}
          </Button>
        </div>
      </form>
    </div>
  );
}
