export function formatCurrency(value: number | string | null | undefined) {
  const num = typeof value === "string" ? parseFloat(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

/** Valor unitário com 3 casas decimais (R$ 12,630): com só 2, a conta
 * "total ÷ quantidade" não batia com o unitário mostrado. */
export function formatCurrency3(value: number | string | null | undefined) {
  const num = typeof value === "string" ? parseFloat(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(num);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    orcamento: "Orçamento",
    pedido: "Pedido",
  };
  return labels[status] ?? status;
}

export function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  const variants: Record<string, any> = {
    orcamento: "warning",
    pedido: "success",
  };
  return variants[status] ?? "default";
}

/** Pedido criado sem internet ainda não tem número: ele só é numerado
 * quando chega ao servidor, na sincronização. */
export function isPendingOrderId(id: string | null | undefined) {
  return !!id && id.startsWith("local-order-");
}

/** Número real do pedido, sequencial (ex: "#0012"). Pedidos que ainda
 * não sincronizaram aparecem como "—". */
export function orderNumberLabel(order: { id?: string | null; order_number?: number | null }) {
  if (isPendingOrderId(order?.id) || order?.order_number == null) return "—";
  return `#${String(order.order_number).padStart(4, "0")}`;
}
