import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  Tags,
  CheckCircle2,
  ImagePlus,
  ChevronDown,
  Trash2,
  History,
  ListChecks,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  importPriceTable,
  getPriceTableSummary,
  listPriceTableImports,
  deletePriceTableImport,
  listCatalogProductCodes,
  updateCatalogProduct,
  deleteCatalogProduct,
  uploadProductImage,
  deleteProductImage,
  reassignProductImage,
} from "@/lib/sales.functions";
import { toast } from "sonner";

export const Route = createFileRoute(
  "/_authenticated/configuracoes_/tabela-precos"
)({
  component: PriceTableSettingsPage,
  head: () => ({
    meta: [
      { title: "Tabela de preços | Força de Vendas" },
      {
        name: "description",
        content: "Importe a planilha de preços da Bluutec.",
      },
    ],
  }),
});

// --- Utilidades ---

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number) {
  return (value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Converte um índice de coluna (0, 1, 2...) em letra (A, B, C... AA, AB...). */
function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

type ColumnField = "code" | "description" | "family" | "color" | "package_qty" | "table_price";

const COLUMN_FIELDS: { key: ColumnField; label: string; required: boolean }[] = [
  { key: "code", label: "Código", required: true },
  { key: "description", label: "Descrição", required: false },
  { key: "family", label: "Família", required: false },
  { key: "color", label: "Cor", required: false },
  { key: "package_qty", label: "Embalagem", required: false },
  { key: "table_price", label: "Preço unitário", required: true },
];

function PriceTableSettingsPage() {
  const queryClient = useQueryClient();
  const { data: summary } = useQuery({
    queryKey: ["price-table-summary"],
    queryFn: () => getPriceTableSummary(),
  });

  // --- Importar planilha (assistente de mapeamento de colunas) ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [allRows, setAllRows] = useState<any[][]>([]);
  const [headerRow, setHeaderRow] = useState(1);
  const [columnMap, setColumnMap] = useState<Record<ColumnField, number | null>>({
    code: null,
    description: null,
    family: null,
    color: null,
    package_qty: null,
    table_price: null,
  });
  const [importing, setImporting] = useState(false);

  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  const readSheet = (workbook: XLSX.WorkBook, sheetName: string) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      setAllRows([]);
      return;
    }
    const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    setAllRows(raw);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      if (workbook.SheetNames.length === 0) {
        toast.error("Essa planilha não tem nenhuma aba.");
        return;
      }
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        toast.error("Essa planilha não tem nenhuma aba.");
        return;
      }
      setFileName(file.name);
      setSheetNames(workbook.SheetNames);
      setSelectedSheet(firstSheet);
      readSheet(workbook, firstSheet);
      setHeaderRow(1);
      setColumnMap({
        code: null,
        description: null,
        family: null,
        color: null,
        package_qty: null,
        table_price: null,
      });
      // guarda o workbook pra poder trocar de aba sem reler o arquivo
      (window as any).__priceTableWorkbook = workbook;
      setWizardOpen(true);
    } catch {
      toast.error("Não consegui abrir esse arquivo. Confira se é um .xlsx válido.");
    } finally {
      e.target.value = "";
    }
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    const workbook = (window as any).__priceTableWorkbook as XLSX.WorkBook | undefined;
    if (workbook) readSheet(workbook, sheetName);
    setHeaderRow(1);
    setColumnMap({
      code: null,
      description: null,
      family: null,
      color: null,
      package_qty: null,
      table_price: null,
    });
  };

  const columnCount = useMemo(
    () => Math.max(0, ...allRows.slice(0, 30).map((r) => r.length)),
    [allRows]
  );
  const headerRowIndex = headerRow - 1;
  const headerCells = allRows[headerRowIndex] ?? [];
  const dataRows = useMemo(
    () => allRows.slice(headerRowIndex + 1),
    [allRows, headerRowIndex]
  );

  const columnOptionLabel = (colIndex: number) => {
    const headerText = String(headerCells[colIndex] ?? "").trim();
    return headerText
      ? `${columnLetter(colIndex)} — ${headerText}`
      : `Coluna ${columnLetter(colIndex)}`;
  };

  const previewProducts = useMemo(() => {
    if (columnMap.code === null) return [];
    return dataRows
      .map((row) => {
        const code = String(row[columnMap.code as number] ?? "").trim();
        if (!code) return null;
        return {
          code,
          description:
            columnMap.description !== null
              ? String(row[columnMap.description] ?? "").trim()
              : "",
          family:
            columnMap.family !== null ? String(row[columnMap.family] ?? "").trim() : "",
          color:
            columnMap.color !== null ? String(row[columnMap.color] ?? "").trim() : "",
          package_qty:
            columnMap.package_qty !== null
              ? toNumber(row[columnMap.package_qty])
              : undefined,
          table_price:
            columnMap.table_price !== null ? toNumber(row[columnMap.table_price]) : 0,
        };
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
  }, [dataRows, columnMap]);

  const canImport = columnMap.code !== null && columnMap.table_price !== null;

  const handleConfirmImport = async () => {
    if (!canImport || previewProducts.length === 0) return;
    setImporting(true);
    try {
      const result = await importPriceTable({
        data: { fileName, products: previewProducts },
      });
      toast.success(`${result.importedProducts} produto(s) importado(s).`);
      setWizardOpen(false);
      queryClient.invalidateQueries({ queryKey: ["price-table-summary"] });
      queryClient.invalidateQueries({ queryKey: ["price-table-imports"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao importar a planilha.");
    } finally {
      setImporting(false);
    }
  };

  // --- Histórico de importações ---
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: importHistory = [] } = useQuery({
    queryKey: ["price-table-imports"],
    queryFn: () => listPriceTableImports(),
  });
  const [deleteImportTarget, setDeleteImportTarget] = useState<{
    id: string;
    file_name: string;
  } | null>(null);

  const handleDeleteImportLog = async () => {
    if (!deleteImportTarget) return;
    try {
      await deletePriceTableImport({ data: { id: deleteImportTarget.id } });
      toast.success("Registro removido do histórico.");
      setDeleteImportTarget(null);
      queryClient.invalidateQueries({ queryKey: ["price-table-imports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover do histórico.");
    }
  };

  // --- Produtos (editar / excluir itens já importados) ---
  const { data: catalogProducts = [] } = useQuery({
    queryKey: ["catalog-product-codes"],
    queryFn: () => listCatalogProductCodes(),
  });
  const [productsOpen, setProductsOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productEdits, setProductEdits] = useState<Record<string, Record<string, any>>>(
    {}
  );
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [deleteProductTarget, setDeleteProductTarget] = useState<{
    id: string;
    code: string;
    description: string;
  } | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    const list = catalogProducts as any[];
    if (!term) return list;
    return list.filter(
      (p) =>
        p.code?.toLowerCase().includes(term) ||
        p.description?.toLowerCase().includes(term)
    );
  }, [catalogProducts, productSearch]);

  const getFieldValue = (product: any, field: string) =>
    productEdits[product.id]?.[field] ?? product[field] ?? "";

  const setFieldValue = (productId: string, field: string, value: any) => {
    setProductEdits((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value },
    }));
  };

  const isProductDirty = (product: any) => !!productEdits[product.id];

  const handleSaveProduct = async (product: any) => {
    const edits = productEdits[product.id] as Record<string, any> | undefined;
    if (!edits) return;
    setSavingProductId(product.id);
    try {
      await updateCatalogProduct({
        data: {
          id: product.id,
          ...(edits["description"] !== undefined && {
            description: edits["description"],
          }),
          ...(edits["family"] !== undefined && { family: edits["family"] }),
          ...(edits["color"] !== undefined && { color: edits["color"] }),
          ...(edits["package_qty"] !== undefined && {
            package_qty: toNumber(edits["package_qty"]),
          }),
          ...(edits["table_price"] !== undefined && {
            table_price: toNumber(edits["table_price"]),
          }),
        },
      });
      toast.success(`Produto ${product.code} atualizado.`);
      setProductEdits((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["price-table-summary"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar o produto.");
    } finally {
      setSavingProductId(null);
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!deleteProductTarget) return;
    setDeletingProduct(true);
    try {
      await deleteCatalogProduct({ data: { id: deleteProductTarget.id } });
      toast.success("Produto excluído.");
      setDeleteProductTarget(null);
      queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["price-table-summary"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir o produto.");
    } finally {
      setDeletingProduct(false);
    }
  };

  // --- Imagens dos produtos (upload em massa) ---
  const codeToProduct = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of catalogProducts as any[]) map.set(p.code, p);
    return map;
  }, [catalogProducts]);

  type ImageRow = {
    file: File;
    fileName: string;
    code: string;
    previewUrl: string;
  };

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  /** Redimensiona a foto (lado maior até 1280px) e reexporta como JPEG
   * qualidade 85% antes de enviar — fotos de celular costumam vir com
   * vários MB, e isso não é necessário para a foto de um produto. Cai
   * para o arquivo original sem comprimir se, por algum motivo, não
   * conseguir processar (ex: formato que o navegador não decodifica). */
  type CompressedImage = { base64: string; extension: string; contentType: string };

  /** Redimensiona a foto (lado maior até 1280px) antes de enviar. Se o
   * arquivo original tem fundo transparente (PNG/WEBP/GIF), reexporta
   * como PNG pra manter a transparência — JPEG não suporta transparência
   * e pinta o fundo de preto. Fotos comuns (JPEG) continuam sendo
   * comprimidas como JPEG, que fica bem mais leve. */
  async function compressImageToBase64(
    file: File,
    maxDimension = 1280,
    quality = 0.85
  ): Promise<CompressedImage> {
    const fallback = async (): Promise<CompressedImage> => ({
      base64: await fileToBase64(file),
      extension: (file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".jpg").replace(".", ""),
      contentType: file.type || "image/jpeg",
    });
    try {
      const img = await loadImageFromFile(file);
      const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return fallback();
      ctx.drawImage(img, 0, 0, width, height);

      const preserveTransparency = /png|webp|gif/i.test(file.type);
      if (preserveTransparency) {
        const dataUrl = canvas.toDataURL("image/png");
        return { base64: dataUrl.split(",")[1] ?? "", extension: "png", contentType: "image/png" };
      }
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      return { base64: dataUrl.split(",")[1] ?? "", extension: "jpg", contentType: "image/jpeg" };
    } catch {
      return fallback();
    }
  }

  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageRows, setImageRows] = useState<ImageRow[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadSummary, setUploadSummary] = useState<{
    sent: number;
    notFound: string[];
    failed: { code: string; error: string }[];
  } | null>(null);

  const handleImagesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const rows: ImageRow[] = files.map((file) => ({
      file,
      fileName: file.name,
      code: file.name.replace(/\.[a-zA-Z0-9]+$/, "").trim(),
      previewUrl: URL.createObjectURL(file),
    }));
    setImageRows(rows);
    setUploadSummary(null);
    e.target.value = "";
  };

  const updateImageCode = (index: number, code: string) => {
    setImageRows((prev) => prev.map((r, i) => (i === index ? { ...r, code } : r)));
  };

  const handleUploadImages = async () => {
    if (imageRows.length === 0) return;
    setUploadingImages(true);
    setUploadProgress({ done: 0, total: imageRows.length });
    const notFound: string[] = [];
    const failed: { code: string; error: string }[] = [];
    let sent = 0;

    for (const row of imageRows) {
      try {
        const compressed = await compressImageToBase64(row.file);
        const result = await uploadProductImage({
          data: {
            code: row.code,
            fileName: `${row.code}.${compressed.extension}`,
            contentType: compressed.contentType,
            base64Data: compressed.base64,
          },
        });
        if (result.matched) sent++;
        else notFound.push(row.code);
      } catch (err: any) {
        failed.push({ code: row.code, error: err?.message || "Erro desconhecido" });
      }
      setUploadProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setUploadingImages(false);
    setUploadSummary({ sent, notFound, failed });
    setImageRows((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.previewUrl));
      return [];
    });
    queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
    queryClient.invalidateQueries({ queryKey: ["catalog"] });

    if (notFound.length === 0 && failed.length === 0) {
      toast.success(`${sent} imagem(ns) enviada(s) com sucesso.`);
    } else {
      toast.error(
        `${sent} enviada(s) · ${notFound.length} sem produto · ${failed.length} com erro de envio.`
      );
    }
  };

  const matchedCount = imageRows.filter((r) => codeToProduct.has(r.code)).length;

  // --- Imagens cadastradas (mover código / remover) ---
  const [imagesListOpen, setImagesListOpen] = useState(false);
  const [codeEdits, setCodeEdits] = useState<Record<string, string>>({});
  const [savingCodeFor, setSavingCodeFor] = useState<string | null>(null);
  const [deleteImageTarget, setDeleteImageTarget] = useState<{
    id: string;
    code: string;
    description: string;
  } | null>(null);
  const [deletingImage, setDeletingImage] = useState(false);

  const productsWithImages = useMemo(
    () =>
      (catalogProducts as any[])
        .filter((p) => !!p.image_url)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [catalogProducts]
  );

  const handleSaveCode = async (product: any) => {
    const newCode = (codeEdits[product.id] ?? product.code).trim();
    if (!newCode || newCode === product.code) return;
    setSavingCodeFor(product.id);
    try {
      const result = await reassignProductImage({
        data: { fromCode: product.code, toCode: newCode },
      });
      toast.success(`Imagem movida para o código ${result.toCode}.`);
      setCodeEdits((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao mover a imagem.");
    } finally {
      setSavingCodeFor(null);
    }
  };

  const handleConfirmDeleteImage = async () => {
    if (!deleteImageTarget) return;
    setDeletingImage(true);
    try {
      await deleteProductImage({ data: { code: deleteImageTarget.code } });
      toast.success("Imagem removida.");
      setDeleteImageTarget(null);
      queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover a imagem.");
    } finally {
      setDeletingImage(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/configuracoes">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Tags className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tabela de preços</h1>
          <p className="text-muted-foreground">
            Importe a planilha de preços sempre que ela for atualizada.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar planilha</CardTitle>
          <CardDescription>
            Envie qualquer planilha Excel — na próxima tela você indica em qual
            coluna está cada informação. Produtos com o mesmo código são
            atualizados, nada é duplicado. Impostos (ST) ficam para uma
            ferramenta separada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isOnline}
          >
            <Upload className="mr-2 h-4 w-4" />
            Importar planilha Excel
          </Button>
          {!isOnline && (
            <p className="text-xs text-amber-700">
              A importação precisa de internet — tente novamente quando estiver
              online.
            </p>
          )}
          {summary && (
            <p className="text-sm text-muted-foreground">
              {summary.productsWithPrice} produto(s) com preço cadastrado hoje.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Histórico de importações */}
      <Card>
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between p-6 text-left">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Histórico de importações</CardTitle>
                  <CardDescription>
                    {importHistory.length} importação(ões) registrada(s)
                  </CardDescription>
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                  historyOpen && "rotate-180"
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo</TableHead>
                      <TableHead className="w-24 text-right">Produtos</TableHead>
                      <TableHead className="w-44">Importado em</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importHistory.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                          Nenhuma importação registrada ainda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      importHistory.map((h: any) => (
                        <TableRow key={h.id}>
                          <TableCell className="max-w-[200px] truncate text-sm">
                            {h.file_name}
                          </TableCell>
                          <TableCell className="text-right">{h.products_count}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(h.imported_at)}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setDeleteImportTarget({ id: h.id, file_name: h.file_name })
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Produtos — editar ou excluir itens já importados */}
      <Card>
        <Collapsible open={productsOpen} onOpenChange={setProductsOpen}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between p-6 text-left">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Produtos</CardTitle>
                  <CardDescription>
                    {(catalogProducts as any[]).length} produto(s) — editar um
                    item sem reimportar a planilha inteira, ou excluir.
                  </CardDescription>
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                  productsOpen && "rotate-180"
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3 pt-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por código ou descrição..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-[32rem] overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead className="min-w-[160px]">Descrição</TableHead>
                      <TableHead className="w-28">Família</TableHead>
                      <TableHead className="w-20">Cor</TableHead>
                      <TableHead className="w-20">Emb.</TableHead>
                      <TableHead className="w-28">Preço</TableHead>
                      <TableHead className="w-36">Atualizado em</TableHead>
                      <TableHead className="w-20 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-16 text-center text-muted-foreground">
                          Nenhum produto encontrado.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredProducts.map((p: any) => {
                        const dirty = isProductDirty(p);
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.code}</TableCell>
                            <TableCell>
                              <Input
                                value={getFieldValue(p, "description")}
                                onChange={(e) =>
                                  setFieldValue(p.id, "description", e.target.value)
                                }
                                className="h-8 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={getFieldValue(p, "family")}
                                onChange={(e) => setFieldValue(p.id, "family", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={getFieldValue(p, "color")}
                                onChange={(e) => setFieldValue(p.id, "color", e.target.value)}
                                className="h-8 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                value={getFieldValue(p, "package_qty")}
                                onChange={(e) =>
                                  setFieldValue(p.id, "package_qty", e.target.value)
                                }
                                className="h-8 w-16 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={getFieldValue(p, "table_price")}
                                onChange={(e) =>
                                  setFieldValue(p.id, "table_price", e.target.value)
                                }
                                className="h-8 w-24 text-xs"
                              />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(p.price_updated_at)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {dirty && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSaveProduct(p)}
                                    disabled={savingProductId === p.id}
                                  >
                                    {savingProductId === p.id ? "..." : "Salvar"}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    setDeleteProductTarget({
                                      id: p.id,
                                      code: p.code,
                                      description: p.description,
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Imagens dos produtos</CardTitle>
          <CardDescription>
            Selecione várias fotos de uma vez — o nome de cada arquivo precisa
            ser o código do produto (ex: 70032001.jpg). Reenviar uma imagem com
            o mesmo código substitui a foto anterior. Se o nome do arquivo
            estiver errado ou repetido, corrija o código na tabela antes de
            enviar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImagesSelected}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImages}
          >
            <ImagePlus className="mr-2 h-4 w-4" />
            Selecionar imagens
          </Button>

          {imageRows.length > 0 && (
            <div className="space-y-3">
              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Foto</TableHead>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Código do produto</TableHead>
                      <TableHead>Produto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {imageRows.map((row, index) => {
                      const product = codeToProduct.get(row.code);
                      return (
                        <TableRow key={row.fileName + index}>
                          <TableCell>
                            <img
                              src={row.previewUrl}
                              alt={row.fileName}
                              className="h-10 w-10 rounded object-cover"
                            />
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                            {row.fileName}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.code}
                              onChange={(e) => updateImageCode(index, e.target.value.trim())}
                              disabled={uploadingImages}
                              className="h-8 w-36 font-mono text-xs"
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            {product ? (
                              <span className="truncate">{product.description}</span>
                            ) : (
                              <Badge variant="destructive">código não encontrado</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {matchedCount} de {imageRows.length} com produto encontrado
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setImageRows([])}
                    disabled={uploadingImages}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" onClick={handleUploadImages} disabled={uploadingImages}>
                    {uploadingImages
                      ? `Enviando ${uploadProgress.done}/${uploadProgress.total}...`
                      : "Enviar imagens"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {uploadSummary && (
            <div className="space-y-2">
              <div className="space-y-1 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <p>{uploadSummary.sent} imagem(ns) vinculada(s) com sucesso.</p>
                {uploadSummary.notFound.length > 0 && (
                  <p className="text-amber-700">
                    Sem produto correspondente: {uploadSummary.notFound.join(", ")}
                  </p>
                )}
              </div>
              {uploadSummary.failed.length > 0 && (
                <div className="space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  <p className="font-medium">
                    {uploadSummary.failed.length} imagem(ns) com erro no envio (não é
                    problema de código):
                  </p>
                  {uploadSummary.failed.slice(0, 5).map((f) => (
                    <p key={f.code} className="text-xs">
                      {f.code}: {f.error}
                    </p>
                  ))}
                  {uploadSummary.failed.length > 5 && (
                    <p className="text-xs">
                      + {uploadSummary.failed.length - 5} outra(s) com o mesmo tipo de
                      erro.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Imagens cadastradas — mover código / remover */}
      <Card>
        <Collapsible open={imagesListOpen} onOpenChange={setImagesListOpen}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between p-6 text-left">
              <div>
                <CardTitle className="text-base">Imagens cadastradas</CardTitle>
                <CardDescription>
                  {productsWithImages.length} produto(s) com foto — corrija o
                  código ou remova se alguma foi carregada errada.
                </CardDescription>
              </div>
              <ChevronDown
                className={cn(
                  "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                  imagesListOpen && "rotate-180"
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Foto</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-28 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productsWithImages.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                          Nenhuma imagem cadastrada ainda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      productsWithImages.map((p: any) => {
                        const editedCode = codeEdits[p.id] ?? p.code;
                        const dirty = editedCode.trim() !== p.code;
                        return (
                          <TableRow key={p.id}>
                            <TableCell>
                              <img
                                src={p.image_url}
                                alt={p.description}
                                className="h-10 w-10 rounded object-cover"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={editedCode}
                                onChange={(e) =>
                                  setCodeEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                className="h-8 w-36 font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm">
                              {p.description}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {dirty && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSaveCode(p)}
                                    disabled={savingCodeFor === p.id}
                                  >
                                    {savingCodeFor === p.id ? "..." : "Mover"}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    setDeleteImageTarget({
                                      id: p.id,
                                      code: p.code,
                                      description: p.description,
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Informações de impostos (ST) serão tratadas em outra ferramenta.
        </CardContent>
      </Card>

      {/* Assistente de importação: mapear colunas */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {fileName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {sheetNames.length > 1 && (
              <div className="grid gap-2">
                <Label>Aba da planilha</Label>
                <Select value={selectedSheet} onValueChange={handleSheetChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheetNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Em qual linha está o cabeçalho (nomes das colunas)?</Label>
              <Input
                type="number"
                min={1}
                value={headerRow}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setHeaderRow(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {COLUMN_FIELDS.map((field) => (
                <div key={field.key} className="grid gap-2">
                  <Label>
                    {field.label}
                    {field.required && " *"}
                  </Label>
                  <Select
                    value={columnMap[field.key] === null ? "none" : String(columnMap[field.key])}
                    onValueChange={(v) =>
                      setColumnMap((prev) => ({
                        ...prev,
                        [field.key]: v === "none" ? null : Number(v),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a coluna" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— não usar —</SelectItem>
                      {Array.from({ length: columnCount }).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {columnOptionLabel(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                {previewProducts.length} produto(s) encontrado(s) com esse
                mapeamento.
              </p>
              {!canImport && (
                <p className="text-amber-700">
                  Selecione pelo menos as colunas de Código e Preço unitário.
                </p>
              )}
            </div>

            {canImport && previewProducts.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Família</TableHead>
                      <TableHead>Cor</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewProducts.slice(0, 5).map((p, i) => (
                      <TableRow key={p.code + i}>
                        <TableCell className="font-mono text-xs">{p.code}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs">
                          {p.description || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{p.family || "—"}</TableCell>
                        <TableCell className="text-xs">{p.color || "—"}</TableCell>
                        <TableCell className="text-right text-xs">
                          {formatCurrency(p.table_price)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {previewProducts.length > 5 && (
                  <p className="p-2 text-center text-xs text-muted-foreground">
                    + {previewProducts.length - 5} produto(s)
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWizardOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={!canImport || previewProducts.length === 0 || importing}
            >
              {importing
                ? "Importando..."
                : `Importar ${previewProducts.length} produto(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmações de exclusão */}
      <Dialog
        open={!!deleteImportTarget}
        onOpenChange={(open) => !open && setDeleteImportTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover do histórico</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteImportTarget &&
              `Remover o registro de "${deleteImportTarget.file_name}" do histórico? Isso não desfaz os preços já importados.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteImportTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteImportLog}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteProductTarget}
        onOpenChange={(open) => !open && setDeleteProductTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir produto</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteProductTarget &&
              `Excluir o produto ${deleteProductTarget.code} — ${deleteProductTarget.description}? Se ele já foi usado em algum pedido, a exclusão será recusada.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProductTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteProduct}
              disabled={deletingProduct}
            >
              {deletingProduct ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteImageTarget}
        onOpenChange={(open) => !open && setDeleteImageTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover imagem</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteImageTarget &&
              `Remover a foto do produto ${deleteImageTarget.code} — ${deleteImageTarget.description}?`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteImageTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteImage}
              disabled={deletingImage}
            >
              {deletingImage ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
