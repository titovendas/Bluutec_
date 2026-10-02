// Política comercial da Bluutec.
//
// Cada política é um desconto fixo aplicado sobre o preço de tabela do
// produto. Esse desconto é o primeiro de uma cadeia: sobre o resultado
// ainda incidem o desconto do item (quando o vendedor concede algo a
// mais, ex: eletrodutos de um cliente específico) e os dois descontos do
// pedido (à vista / retirada), cada um multiplicando sobre o que sobrou.
export type PriceTable = "varejo" | "especialista" | "atacado";

export const PRICE_TABLES: {
  value: PriceTable;
  label: string;
  discountPercent: number;
}[] = [
  { value: "varejo", label: "Varejo (31,60%)", discountPercent: 31.6 },
  { value: "especialista", label: "Especialista (35,02%)", discountPercent: 35.02 },
  { value: "atacado", label: "Atacado (37,07%)", discountPercent: 37.07 },
];

export function priceTableLabel(table: string | null | undefined) {
  return PRICE_TABLES.find((t) => t.value === table)?.label ?? table ?? "—";
}

export function politicaDiscountPercent(table: PriceTable | string): number {
  return PRICE_TABLES.find((t) => t.value === table)?.discountPercent ?? 0;
}

/** Preço de tabela do produto, sem nenhum desconto aplicado ainda. */
export function catalogTablePrice(product: any): number {
  return Number(product?.table_price ?? product?.price_atacado ?? 0);
}

/**
 * Preço líquido final de um item: preço de tabela, com a política
 * comercial, o desconto do item e os dois descontos do pedido aplicados
 * em cadeia (cada um multiplica sobre o valor restante).
 */
export function computeNetUnitPrice(
  tablePrice: number,
  table: PriceTable | string,
  itemDiscountPercent: number,
  cashDiscountPercent: number,
  pickupDiscountPercent: number
): number {
  const factor =
    (1 - politicaDiscountPercent(table) / 100) *
    (1 - (itemDiscountPercent || 0) / 100) *
    (1 - (cashDiscountPercent || 0) / 100) *
    (1 - (pickupDiscountPercent || 0) / 100);
  return tablePrice * factor;
}
