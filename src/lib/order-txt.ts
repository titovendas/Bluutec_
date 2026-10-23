import { effectiveUnitPrice } from "@/lib/price-tables";

/**
 * Arquivo TXT do pedido para a fábrica.
 *
 * Uma linha por item: codigo;quantidade;preco_unitario_sem_impostos
 *  - vírgula decimal, preço com 3 casas, sem separador de milhar;
 *  - sem cabeçalho;
 *  - quebra de linha do Windows (CRLF), sem linha vazia no final.
 * O preço é o mesmo mostrado na tela e no PDF (effectiveUnitPrice).
 */
const priceFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  useGrouping: false,
});

const quantityFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
  useGrouping: false,
});

export function buildOrderTxt(order: any, items: any[]): string {
  return items
    .map((item) => {
      const code = String(item.code ?? "").trim();
      const quantity = quantityFormat.format(Number(item.quantity ?? 0));
      const price = priceFormat.format(effectiveUnitPrice(order, item));
      return `${code};${quantity};${price}`;
    })
    .join("\r\n");
}

export function orderFileNumber(order: any): string {
  return order?.order_number != null
    ? String(order.order_number).padStart(4, "0")
    : String(order?.id ?? "").slice(0, 8);
}
