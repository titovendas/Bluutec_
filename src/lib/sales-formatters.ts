export function formatCurrency(value: number | string | null | undefined) {
  const num = typeof value === "string" ? parseFloat(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
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
