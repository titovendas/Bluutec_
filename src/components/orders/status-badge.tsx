import { CheckCircle2, FilePenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { statusLabel, statusVariant } from "@/lib/sales-formatters";

/** Pedido confirmado (verde, travado) x orçamento ainda em aberto (amarelo)
 * — os dois ficam bem diferentes à primeira vista. */
export function OrderStatusBadge({ status }: { status: string | null | undefined }) {
  if (status === "pedido") {
    return (
      <Badge className="gap-1 border-transparent bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        Pedido confirmado
      </Badge>
    );
  }
  if (status === "orcamento") {
    return (
      <Badge variant="warning" className="gap-1">
        <FilePenLine className="h-3 w-3" />
        Orçamento em aberto
      </Badge>
    );
  }
  return <Badge variant={statusVariant(status ?? "")}>{statusLabel(status ?? "")}</Badge>;
}

/** Faixa colorida na lateral da linha, pra diferenciar sem precisar ler. */
export function orderRowClass(status: string | null | undefined) {
  if (status === "pedido") return "border-l-4 border-l-emerald-500 bg-emerald-50/70";
  if (status === "orcamento") return "border-l-4 border-l-amber-400";
  return "border-l-4 border-l-transparent";
}
