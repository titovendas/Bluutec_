export type PriceTable = "atacado" | "varejo_10" | "varejo_75";

export const PRICE_TABLES: { value: PriceTable; label: string }[] = [
  { value: "atacado", label: "Atacado" },
  { value: "varejo_10", label: "Varejo 10" },
  { value: "varejo_75", label: "Varejo 7,5" },
];

export function priceTableLabel(table: string | null | undefined) {
  return PRICE_TABLES.find((t) => t.value === table)?.label ?? "—";
}

export function catalogPrice(product: any, table: PriceTable | string): number {
  const key =
    table === "atacado"
      ? "price_atacado"
      : table === "varejo_75"
        ? "price_varejo_75"
        : "price_varejo_10";
  return Number(product?.[key] ?? 0);
}
