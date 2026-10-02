const DRAFT_KEY = "fv:draft:novo-orcamento";

export type OrderDraft = {
  customerId: string;
  priceTable: string;
  paymentTerm: string;
  items: any[];
  savedAt: string;
};

export function readOrderDraft(): OrderDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderDraft;
    if (!parsed || (!parsed.customerId && (!parsed.items || parsed.items.length === 0))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveOrderDraft(draft: Omit<OrderDraft, "savedAt">) {
  if (typeof window === "undefined") return;
  const isEmpty = !draft.customerId && draft.items.length === 0;
  if (isEmpty) {
    clearOrderDraft();
    return;
  }
  try {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() })
    );
  } catch {
    /* aparelho sem espaço de armazenamento — ignora silenciosamente */
  }
}

export function clearOrderDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_KEY);
}
