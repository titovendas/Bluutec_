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
  return PRICE_TABLES.find((t) => t.value === table)?.label ?? (table ? table : "—");
}

/** Devolve a política se for uma das três válidas; senão null (ex: valor
 * em branco ou de versões antigas do sistema, como "varejo_10"). */
export function normalizePriceTable(value: unknown): PriceTable | null {
  return PRICE_TABLES.some((t) => t.value === value) ? (value as PriceTable) : null;
}

export function politicaDiscountPercent(table: PriceTable | string): number {
  return PRICE_TABLES.find((t) => t.value === table)?.discountPercent ?? 0;
}

/** Preço de tabela do produto, sem nenhum desconto aplicado ainda. */
export function catalogTablePrice(product: any): number {
  return Number(product?.table_price ?? product?.price_atacado ?? 0);
}

/**
 * Arredonda PARA CIMA em 3 casas, igual ao ROUNDUP(x;3) da planilha da
 * fábrica. O toFixed(9) tira a "sujeira" de ponto flutuante (ex.:
 * 0.5110000000000001) para não subir 0,001 por engano.
 */
export function roundUp3(value: number): number {
  return Math.ceil(Number((value * 1000).toFixed(9))) / 1000;
}

/** Desconto combinado (em fração, ex.: 0,0591) de item + à vista +
 * retirada em cadeia: 1 − (1−item)(1−à vista)(1−retirada). É o valor que
 * vai na coluna DESCONTO da planilha da fábrica. */
export function combinedDiscountFraction(
  itemDiscountPercent: number,
  cashDiscountPercent: number,
  pickupDiscountPercent: number
): number {
  const factor =
    (1 - (itemDiscountPercent || 0) / 100) *
    (1 - (cashDiscountPercent || 0) / 100) *
    (1 - (pickupDiscountPercent || 0) / 100);
  return Number((1 - factor).toFixed(10));
}

/** Política em fração (35,02 → 0,3502), exatamente como na planilha. */
export function politicaFraction(table: PriceTable | string): number {
  return Math.round(politicaDiscountPercent(table) * 100) / 10000;
}

/**
 * Preço líquido final de um item, como a planilha da fábrica calcula:
 * ROUNDUP((tabela × (1 − política)) × (1 − desconto combinado); 3).
 * O desconto combinado junta item, à vista e retirada em cadeia.
 */
export function computeNetUnitPrice(
  tablePrice: number,
  table: PriceTable | string,
  itemDiscountPercent: number,
  cashDiscountPercent: number,
  pickupDiscountPercent: number
): number {
  const m = combinedDiscountFraction(
    itemDiscountPercent,
    cashDiscountPercent,
    pickupDiscountPercent
  );
  return roundUp3(tablePrice * (1 - politicaFraction(table)) * (1 - m));
}

/** Cálculo antigo (sem arredondar para cima). Só serve para pedidos
 * gravados antes do alinhamento com a planilha da fábrica. */
export function computeNetUnitPriceExact(
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

/**
 * Quando a política de um orçamento está em branco ou inválida, descobre
 * qual foi a usada refazendo a conta: a política certa é a única que
 * reproduz o preço unitário gravado em TODOS os itens. Se nenhuma (ou
 * mais de uma) bater, devolve null — e aí a tela pede pra escolher.
 */
export function inferPriceTable(
  items: { table_price?: number | null; discount_percent?: number | null; unit_price?: number | null }[],
  cashDiscountPercent = 0,
  pickupDiscountPercent = 0
): PriceTable | null {
  const usable = items.filter((i) => Number(i.table_price) > 0 && Number(i.unit_price) > 0);
  if (usable.length === 0) return null;
  const matches = PRICE_TABLES.filter((t) =>
    usable.every(
      (i) =>
        Math.abs(
          computeNetUnitPrice(
            Number(i.table_price),
            t.value,
            Number(i.discount_percent ?? 0),
            cashDiscountPercent,
            pickupDiscountPercent
          ) - Number(i.unit_price)
        ) < 0.0015
    )
  );
  return matches.length === 1 ? matches[0]!.value : null;
}

/** Política válida do pedido: a gravada, ou a deduzida pelos preços. */
export function resolveOrderPriceTable(
  priceTable: unknown,
  items: { table_price?: number | null; discount_percent?: number | null; unit_price?: number | null }[],
  cashDiscountPercent = 0,
  pickupDiscountPercent = 0
): PriceTable | null {
  return (
    normalizePriceTable(priceTable) ??
    inferPriceTable(items, cashDiscountPercent, pickupDiscountPercent)
  );
}

/**
 * Preço unitário líquido (sem impostos) de um item de pedido JÁ GRAVADO.
 *
 * O unitário guardado no banco pode ter sido arredondado em 2 casas (coluna
 * antiga), enquanto os totais foram calculados com o valor completo — isso
 * fazia o PDF mostrar, por exemplo, 8,650 quando o correto é 8,646. Aqui o
 * valor é refeito a partir do preço de tabela, da política e dos descontos
 * gravados no pedido. Se não der pra refazer, ou se o resultado se afastar
 * do gravado além de um arredondamento, usa o gravado.
 */
export function effectiveUnitPrice(
  order: { price_table?: unknown; cash_discount_percent?: unknown; pickup_discount_percent?: unknown } | null | undefined,
  item: { table_price?: unknown; discount_percent?: unknown; unit_price?: unknown }
): number {
  const stored = Number(item.unit_price ?? 0);
  const policy = normalizePriceTable(order?.price_table);
  const tablePrice = Number(item.table_price ?? 0);
  if (!policy || !(tablePrice > 0)) return stored;
  const args = [
    tablePrice,
    policy,
    Number(item.discount_percent ?? 0),
    Number(order?.cash_discount_percent ?? 0),
    Number(order?.pickup_discount_percent ?? 0),
  ] as const;
  // Pedido novo: o unitário gravado já segue a regra da planilha da fábrica
  // (para cima, 3 casas) — usa exatamente o gravado.
  if (Math.abs(computeNetUnitPrice(...args) - stored) < 1e-7) return stored;
  // Pedido antigo: refaz o valor completo (sem arredondar), como antes.
  const recomputed = computeNetUnitPriceExact(...args);
  return Math.abs(recomputed - stored) <= 0.0051 ? recomputed : stored;
}
