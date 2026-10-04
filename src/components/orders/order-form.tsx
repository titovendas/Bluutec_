import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2, ArrowLeft, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { ProductImage } from "@/components/products/product-image";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { searchCatalog } from "@/lib/offline-catalog";
import { formatCurrency } from "@/lib/sales-formatters";
import {
  PRICE_TABLES,
  catalogTablePrice,
  computeNetUnitPrice,
  type PriceTable,
} from "@/lib/price-tables";
import { getPaymentTermsOfflineAware } from "@/lib/offline-customers";
import { listTaxRatesByUf } from "@/lib/sales.functions";

/** Mostra sempre com 2 casas decimais e vírgula (padrão BR), ex: 4,80. */
function formatDecimalInput(value: number) {
  if (Number.isNaN(value)) return "0,00";
  return value.toFixed(2).replace(".", ",");
}

/** Converte o texto digitado (aceita vírgula ou ponto) de volta em número. */
function parseDecimalInput(text: string) {
  const normalized = text.replace(/[^\d,.-]/g, "").replace(",", ".");
  const value = parseFloat(normalized);
  return Number.isNaN(value) ? 0 : value;
}

export type FormItem = {
  catalog_product_id: string;
  code: string;
  description: string;
  image_url: string | null;
  quantity: number;
  table_price: number;
  discount_percent: number;
  ipi_percent: number;
  st_percent: number;
};

type Props = {
  customers: any[];
  customerId: string;
  setCustomerId: (v: string) => void;
  priceTable: PriceTable;
  setPriceTable: (v: PriceTable) => void;
  paymentTerm: string;
  setPaymentTerm: (v: string) => void;
  cashDiscountPercent: number;
  setCashDiscountPercent: (v: number) => void;
  pickupDiscountPercent: number;
  setPickupDiscountPercent: (v: number) => void;
  items: FormItem[];
  setItems: React.Dispatch<React.SetStateAction<FormItem[]>>;
};

export function OrderForm({
  customers,
  customerId,
  setCustomerId,
  priceTable,
  setPriceTable,
  paymentTerm,
  setPaymentTerm,
  cashDiscountPercent,
  setCashDiscountPercent,
  pickupDiscountPercent,
  setPickupDiscountPercent,
  items,
  setItems,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [selectedQty, setSelectedQty] = useState(1);

  const { data: catalogResult, isLoading: catalogLoading } = useQuery({
    queryKey: ["catalog", search],
    queryFn: () => searchCatalog(search),
    enabled: pickerOpen,
  });
  const catalog = catalogResult?.items ?? [];
  const catalogFromCache = catalogResult?.fromCache ?? false;

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ["payment-terms"],
    queryFn: () => getPaymentTermsOfflineAware(),
  });

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.document || c.city || undefined,
      })),
    [customers]
  );

  const paymentTermOptions = useMemo(
    () => paymentTerms.map((t) => ({ value: t.label, label: t.label })),
    [paymentTerms]
  );

  // Impostos (IPI/ST) variam por estado — assim que o cliente é
  // selecionado, busca os impostos configurados pra esse estado e já
  // aplica em todos os itens do pedido.
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId]
  );
  const customerUf: string = selectedCustomer?.state || "";

  const { data: taxRates = [] } = useQuery({
    queryKey: ["tax-rates-for-order", customerUf],
    queryFn: () => listTaxRatesByUf({ data: { uf: customerUf } }),
    enabled: !!customerUf,
  });
  const taxRateByCode = useMemo(() => {
    const map = new Map<string, { ipi_percent: number; st_percent: number }>();
    for (const r of taxRates as any[]) {
      map.set(r.code, { ipi_percent: Number(r.ipi_percent), st_percent: Number(r.st_percent) });
    }
    return map;
  }, [taxRates]);

  // Se o cliente (e portanto o estado) mudar com itens já no pedido,
  // atualiza o IPI/ST de cada item para o que está cadastrado no novo
  // estado. Itens cujo código não tem imposto configurado nesse estado
  // mantêm o valor que já tinham.
  useEffect(() => {
    if (!customerUf || taxRateByCode.size === 0) return;
    setItems((prev) =>
      prev.map((item) => {
        const rate = taxRateByCode.get(item.code);
        if (!rate) return item;
        return { ...item, ipi_percent: rate.ipi_percent, st_percent: rate.st_percent };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerUf, taxRateByCode]);

  /** Preço líquido final de um item, com política + desconto do item +
   * os dois descontos do pedido já aplicados em cadeia. */
  const netUnitPrice = (item: FormItem) =>
    computeNetUnitPrice(
      item.table_price,
      priceTable,
      item.discount_percent,
      cashDiscountPercent,
      pickupDiscountPercent
    );

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (s, i) => s + i.quantity * netUnitPrice(i),
      0
    );
    const ipi = items.reduce((s, i) => {
      const unit = netUnitPrice(i);
      return s + (i.quantity * unit * i.ipi_percent) / 100;
    }, 0);
    const st = items.reduce((s, i) => {
      const unit = netUnitPrice(i);
      return s + (i.quantity * unit * i.st_percent) / 100;
    }, 0);
    return { subtotal, ipi, st, total: subtotal + ipi + st };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, priceTable, cashDiscountPercent, pickupDiscountPercent]);

  const addProduct = (product: any, quantity: number) => {
    const stateRate = taxRateByCode.get(product.code);
    setItems((prev) => {
      const existing = prev.find((i) => i.catalog_product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.catalog_product_id === product.id
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      }
      return [
        ...prev,
        {
          catalog_product_id: product.id,
          code: product.code,
          description: product.description,
          image_url: product.image_url ?? null,
          quantity,
          table_price: catalogTablePrice(product),
          discount_percent: 0,
          // Usa o imposto cadastrado para o estado do cliente; se esse
          // produto não tiver imposto configurado nesse estado, cai no
          // valor cadastrado direto no produto (se houver).
          ipi_percent: stateRate ? stateRate.ipi_percent : Number(product.ipi_percent ?? 0),
          st_percent: stateRate ? stateRate.st_percent : Number(product.st_percent ?? 0),
        },
      ];
    });
  };

  const handlePickProduct = (product: any) => {
    setSelectedProduct(product);
    setSelectedQty(1);
  };

  const handleConfirmAdd = () => {
    if (!selectedProduct) return;
    addProduct(selectedProduct, Math.max(1, selectedQty));
    setSelectedProduct(null);
    setSelectedQty(1);
    setSearch("");
    setPickerOpen(false);
  };

  const closePicker = () => {
    setPickerOpen(false);
    setSelectedProduct(null);
    setSelectedQty(1);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid min-w-0 gap-2">
          <Label>Cliente *</Label>
          <Combobox
            options={customerOptions}
            value={customerId}
            onValueChange={setCustomerId}
            placeholder="Selecione o cliente"
            searchPlaceholder="Buscar por nome ou CNPJ..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="grid gap-2">
          <Label>Política comercial *</Label>
          <Select
            value={priceTable}
            onValueChange={(v) => setPriceTable(v as PriceTable)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRICE_TABLES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Condição de pagamento</Label>
          <Combobox
            options={paymentTermOptions}
            value={paymentTerm}
            onValueChange={setPaymentTerm}
            placeholder="Selecione"
            searchPlaceholder="Buscar prazo..."
            emptyText="Nenhum prazo cadastrado. Cadastre em Configurações."
          />
        </div>
        <div className="grid gap-2">
          <Label>Desconto à vista (%)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={formatDecimalInput(cashDiscountPercent)}
            onFocus={(e) => e.target.select()}
            onChange={(e) =>
              setCashDiscountPercent(parseDecimalInput(e.target.value))
            }
          />
          <p className="text-xs text-muted-foreground">
            Aplica sobre todos os itens do pedido.
          </p>
        </div>
        <div className="grid gap-2">
          <Label>Desconto retirada (%)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={formatDecimalInput(pickupDiscountPercent)}
            onFocus={(e) => e.target.select()}
            onChange={(e) =>
              setPickupDiscountPercent(parseDecimalInput(e.target.value))
            }
          />
          <p className="text-xs text-muted-foreground">
            Aplica sobre todos os itens do pedido.
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Itens do pedido</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar produto
          </Button>
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Foto</TableHead>
                <TableHead className="w-24">Código</TableHead>
                <TableHead className="w-auto min-w-[160px]">Descrição</TableHead>
                <TableHead className="w-20">Qtd</TableHead>
                <TableHead className="w-24">Tabela</TableHead>
                <TableHead className="w-24">Desc. item (%)</TableHead>
                <TableHead className="w-28 text-right">Unit. líquido</TableHead>
                <TableHead className="w-28 text-right">IPI</TableHead>
                <TableHead className="w-28 text-right">ST</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                    Nenhum produto adicionado.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item, index) => {
                  const unit = netUnitPrice(item);
                  const base = item.quantity * unit;
                  const ipi = (base * item.ipi_percent) / 100;
                  const st = (base * item.st_percent) / 100;
                  return (
                    <TableRow key={item.catalog_product_id}>
                      <TableCell>
                        <ProductImage
                          src={item.image_url}
                          alt={item.description}
                          className="h-10 w-10"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm">
                        {item.description}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((i, idx) =>
                                idx === index
                                  ? { ...i, quantity: parseInt(e.target.value) || 1 }
                                  : i
                              )
                            )
                          }
                          className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatCurrency(item.table_price)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={formatDecimalInput(item.discount_percent)}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((i, idx) =>
                                idx === index
                                  ? {
                                      ...i,
                                      discount_percent: parseDecimalInput(
                                        e.target.value
                                      ),
                                    }
                                  : i
                              )
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {formatCurrency(unit)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(ipi)}
                        <span className="block text-xs text-muted-foreground">
                          {item.ipi_percent}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(st)}
                        <span className="block text-xs text-muted-foreground">
                          {item.st_percent}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(base + ipi + st)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setRemoveIndex(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Versão em cards para telas estreitas (celular) */}
        <div className="space-y-3 sm:hidden">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum produto adicionado.
            </p>
          ) : (
            items.map((item, index) => {
              const unit = netUnitPrice(item);
              const base = item.quantity * unit;
              const ipi = (base * item.ipi_percent) / 100;
              const st = (base * item.st_percent) / 100;
              return (
                <div
                  key={item.catalog_product_id}
                  className="space-y-3 rounded-md border p-3"
                >
                  <div className="flex items-start gap-3">
                    <ProductImage
                      src={item.image_url}
                      alt={item.description}
                      className="h-12 w-12 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.code}
                      </p>
                      <p className="text-sm font-medium leading-snug">
                        {item.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Tabela {formatCurrency(item.table_price)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setRemoveIndex(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground">Qtd</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((i, idx) =>
                              idx === index
                                ? { ...i, quantity: parseInt(e.target.value) || 1 }
                                : i
                            )
                          )
                        }
                        className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground">
                        Desc. item (%)
                      </Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={formatDecimalInput(item.discount_percent)}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((i, idx) =>
                              idx === index
                                ? {
                                    ...i,
                                    discount_percent: parseDecimalInput(
                                      e.target.value
                                    ),
                                  }
                                : i
                            )
                          )
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground">
                        Unit. líquido
                      </Label>
                      <p className="flex h-10 items-center text-sm font-semibold">
                        {formatCurrency(unit)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t pt-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        IPI ({item.ipi_percent}%)
                      </p>
                      <p>{formatCurrency(ipi)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        ST ({item.st_percent}%)
                      </p>
                      <p>{formatCurrency(st)}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-medium">
                        {formatCurrency(base + ipi + st)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end border-t pt-4">
          <div className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">IPI</span>
              <span>{formatCurrency(totals.ipi)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ST (valor aprox.)</span>
              <span>{formatCurrency(totals.st)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 text-lg font-bold">
              <span>Total</span>
              <span>{formatCurrency(totals.total)}</span>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={(open) => (open ? setPickerOpen(true) : closePicker())}>
        <DialogContent className="max-w-2xl">
          {selectedProduct ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-ml-2 h-7 w-7"
                    onClick={() => setSelectedProduct(null)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  Quantidade
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-3">
                <ProductImage
                  src={selectedProduct.image_url}
                  alt={selectedProduct.description}
                  className="h-16 w-16 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{selectedProduct.description}</p>
                  <p className="text-sm text-muted-foreground">
                    Cód. {selectedProduct.code} ·{" "}
                    {formatCurrency(
                      computeNetUnitPrice(
                        catalogTablePrice(selectedProduct),
                        priceTable,
                        0,
                        cashDiscountPercent,
                        pickupDiscountPercent
                      )
                    )}{" "}
                    / un.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedQty((q) => Math.max(1, q - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  value={selectedQty}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setSelectedQty(parseInt(e.target.value) || 1)}
                  className="w-24 text-center text-lg"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedQty((q) => q + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Subtotal:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(
                    computeNetUnitPrice(
                      catalogTablePrice(selectedProduct),
                      priceTable,
                      0,
                      cashDiscountPercent,
                      pickupDiscountPercent
                    ) * selectedQty
                  )}
                </span>
              </p>

              <Button type="button" onClick={handleConfirmAdd} className="w-full">
                Adicionar ao pedido
              </Button>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Buscar produto no catálogo</DialogTitle>
              </DialogHeader>
              {catalogFromCache && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Sem conexão — mostrando o catálogo salvo no aparelho.
                </p>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Código, referência, descrição ou código de barras..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                {catalogLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Carregando...
                  </p>
                ) : catalog.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum produto encontrado.
                  </p>
                ) : (
                  catalog.map((p: any) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handlePickProduct(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handlePickProduct(p);
                        }
                      }}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-md border p-2 text-left hover:bg-accent"
                    >
                      <ProductImage
                        src={p.image_url}
                        alt={p.description}
                        className="h-12 w-12 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.description}</p>
                        <p className="text-xs text-muted-foreground">
                          Cód. {p.code} · IPI {p.ipi_percent}% · ST {p.st_percent}%
                        </p>
                      </div>
                      <div className="text-right text-sm font-semibold">
                        {formatCurrency(
                          computeNetUnitPrice(
                            catalogTablePrice(p),
                            priceTable,
                            0,
                            cashDiscountPercent,
                            pickupDiscountPercent
                          )
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={removeIndex !== null} onOpenChange={(open) => !open && setRemoveIndex(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover produto</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {removeIndex !== null &&
              `Tem certeza que deseja remover "${items[removeIndex]?.description}" do orçamento?`}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveIndex(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setItems((prev) => prev.filter((_, i) => i !== removeIndex));
                setRemoveIndex(null);
              }}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
