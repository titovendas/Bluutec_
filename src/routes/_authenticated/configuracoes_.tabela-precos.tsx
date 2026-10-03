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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  importPriceTable,
  getPriceTableSummary,
  listCatalogProductCodes,
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

type ProductRow = {
  code: string;
  description: string;
  color: string;
  package_qty?: number;
  table_price: number;
  family: string;
};

type StRow = {
  code: string;
  uf: string;
  st_percent: number;
};

type ParsedPriceTable = {
  products: ProductRow[];
  stRates: StRow[];
  missingGeral: boolean;
  missingTabelaSt: boolean;
};

/** Remove acentos e deixa maiúsculo, para comparar cabeçalhos sem depender
 * de acentuação exata (ex: "Descrição" ou "DESCRICAO" batem igual). */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/** Acha a linha de cabeçalho de uma aba (a linha que contém "CÓDIGO") e
 * devolve os cabeçalhos normalizados + as linhas de dados abaixo dela. */
function findHeaderAndRows(sheet: XLSX.WorkSheet) {
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  const headerIndex = raw.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "CODIGO")
  );
  const headerRow = headerIndex === -1 ? undefined : raw[headerIndex];
  if (!headerRow) return { headers: [] as string[], rows: [] as any[][] };
  const headers = headerRow.map((h) => normalizeHeader(h));
  const rows = raw.slice(headerIndex + 1);
  return { headers, rows };
}

const KNOWN_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

function parseWorkbook(data: ArrayBuffer): ParsedPriceTable {
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = (name: string) =>
    workbook.SheetNames.find((n) => normalizeHeader(n) === normalizeHeader(name));

  const geralName = sheetName("GERAL");
  const stName = sheetName("TABELA ST");
  const geralSheet = geralName ? workbook.Sheets[geralName] : undefined;
  const stSheet = stName ? workbook.Sheets[stName] : undefined;

  const products: ProductRow[] = [];
  if (geralSheet) {
    const { headers, rows } = findHeaderAndRows(geralSheet);
    const idx = (label: string) => headers.indexOf(label);
    const codeIdx = idx("CODIGO");
    const descIdx = idx("DESCRICAO");
    const colorIdx = idx("COR");
    const packIdx = idx("EMBALAGEM");
    const priceIdx = idx("TABELA");
    const familyIdx = idx("FAMILIA");

    for (const row of rows) {
      const code = String(row[codeIdx] ?? "").trim();
      if (!code) continue;
      const price = Number(row[priceIdx]);
      const packRaw = row[packIdx];
      const product: ProductRow = {
        code,
        description: String(row[descIdx] ?? "").trim(),
        color: String(row[colorIdx] ?? "").trim(),
        table_price: Number.isFinite(price) ? price : 0,
        family: String(row[familyIdx] ?? "").trim(),
      };
      if (packRaw !== "" && packRaw !== undefined && packRaw !== null) {
        const packNum = Number(packRaw);
        if (Number.isFinite(packNum)) product.package_qty = packNum;
      }
      products.push(product);
    }
  }

  const stRates: StRow[] = [];
  if (stSheet) {
    const { headers, rows } = findHeaderAndRows(stSheet);
    const codeIdx = headers.indexOf("CODIGO");
    const ufColumns = headers
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i !== codeIdx && KNOWN_UFS.includes(h));

    for (const row of rows) {
      const code = String(row[codeIdx] ?? "").trim();
      if (!code) continue;
      for (const { h, i } of ufColumns) {
        const raw = row[i];
        if (raw === "" || raw === undefined || raw === null) continue;
        const percent = Number(raw);
        if (!Number.isFinite(percent)) continue;
        stRates.push({ code, uf: h, st_percent: percent * 100 });
      }
    }
  }

  return {
    products,
    stRates,
    missingGeral: !geralName,
    missingTabelaSt: !stName,
  };
}

/** Converte um arquivo escolhido no navegador para base64 (sem o prefixo
 * "data:image/...;base64,"), pra mandar pro servidor. */
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

type ImageRow = {
  file: File;
  fileName: string;
  code: string;
  previewUrl: string;
};

function PriceTableSettingsPage() {
  const queryClient = useQueryClient();
  const { data: summary } = useQuery({
    queryKey: ["price-table-summary"],
    queryFn: () => getPriceTableSummary(),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedPriceTable | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    importedProducts: number;
    importedStRates: number;
  } | null>(null);

  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const result = parseWorkbook(buffer);
      if (result.missingGeral) {
        toast.error('Não encontrei uma aba "GERAL" nessa planilha.');
        return;
      }
      if (result.products.length === 0) {
        toast.error('Não encontrei produtos na aba "GERAL" (procure a coluna CÓDIGO).');
        return;
      }
      setFileName(file.name);
      setParsed(result);
      setConfirmOpen(true);
    } catch {
      toast.error("Não consegui abrir esse arquivo. Confira se é um .xlsx válido.");
    } finally {
      e.target.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      const result = await importPriceTable({
        data: { products: parsed.products, stRates: parsed.stRates },
      });
      toast.success(
        `${result.importedProducts} produto(s) importado(s)${
          result.importedStRates > 0
            ? ` · ${result.importedStRates} alíquota(s) de ST`
            : ""
        }.`
      );
      setLastResult(result);
      setConfirmOpen(false);
      setParsed(null);
      queryClient.invalidateQueries({ queryKey: ["price-table-summary"] });
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-product-codes"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao importar a planilha.");
    } finally {
      setImporting(false);
    }
  };

  // --- Imagens dos produtos ---
  const { data: catalogProducts = [] } = useQuery({
    queryKey: ["catalog-product-codes"],
    queryFn: () => listCatalogProductCodes(),
  });
  const codeToProduct = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of catalogProducts as any[]) map.set(p.code, p);
    return map;
  }, [catalogProducts]);

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
    setImageRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, code } : r))
    );
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
        const base64Data = await fileToBase64(row.file);
        const result = await uploadProductImage({
          data: {
            code: row.code,
            fileName: row.fileName,
            contentType: row.file.type || "image/jpeg",
            base64Data,
          },
        });
        if (result.matched) sent++;
        else notFound.push(row.code);
      } catch (err: any) {
        // Um erro no envio (ex: o espaço de armazenamento das imagens
        // ainda não foi criado no Supabase) é bem diferente de "código
        // não encontrado" — mostrar separado evita confundir as duas
        // coisas na hora de resolver.
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

  // --- Painel retrátil: imagens já cadastradas (editar código / remover) ---
  const [imagesListOpen, setImagesListOpen] = useState(false);
  const [codeEdits, setCodeEdits] = useState<Record<string, string>>({});
  const [savingCodeFor, setSavingCodeFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
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
    if (!deleteTarget) return;
    setDeletingImage(true);
    try {
      await deleteProductImage({ data: { code: deleteTarget.code } });
      toast.success("Imagem removida.");
      setDeleteTarget(null);
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
          <h1 className="text-2xl font-bold tracking-tight">
            Tabela de preços
          </h1>
          <p className="text-muted-foreground">
            Importe a planilha de preços da Bluutec sempre que ela for
            atualizada.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar planilha</CardTitle>
          <CardDescription>
            Envie o arquivo Excel completo da Bluutec (com as abas GERAL e
            TABELA ST). Produtos com o mesmo código são atualizados — nada é
            duplicado.
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
              A importação precisa de internet — tente novamente quando
              estiver online.
            </p>
          )}
          {summary && (
            <p className="text-sm text-muted-foreground">
              {summary.productsWithPrice} produto(s) com preço cadastrado
              hoje.
            </p>
          )}
          {lastResult && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Última importação: {lastResult.importedProducts} produto(s)
              {lastResult.importedStRates > 0 &&
                ` · ${lastResult.importedStRates} alíquota(s) de ST`}
              .
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Imagens dos produtos</CardTitle>
          <CardDescription>
            Selecione várias fotos de uma vez — o nome de cada arquivo
            precisa ser o código do produto (ex: 70032001.jpg). Reenviar uma
            imagem com o mesmo código substitui a foto anterior. Se o nome
            do arquivo estiver errado ou repetido, corrija o código na
            tabela antes de enviar.
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
                              onChange={(e) =>
                                updateImageCode(index, e.target.value.trim())
                              }
                              disabled={uploadingImages}
                              className="h-8 w-36 font-mono text-xs"
                            />
                          </TableCell>
                          <TableCell className="text-sm">
                            {product ? (
                              <span className="truncate">
                                {product.description}
                              </span>
                            ) : (
                              <Badge variant="destructive">
                                código não encontrado
                              </Badge>
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
                  {matchedCount} de {imageRows.length} com produto
                  encontrado
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
                  <Button
                    type="button"
                    onClick={handleUploadImages}
                    disabled={uploadingImages}
                  >
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
                    Sem produto correspondente:{" "}
                    {uploadSummary.notFound.join(", ")}
                  </p>
                )}
              </div>
              {uploadSummary.failed.length > 0 && (
                <div className="space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  <p className="font-medium">
                    {uploadSummary.failed.length} imagem(ns) com erro no envio
                    (não é problema de código):
                  </p>
                  {uploadSummary.failed.slice(0, 5).map((f) => (
                    <p key={f.code} className="text-xs">
                      {f.code}: {f.error}
                    </p>
                  ))}
                  {uploadSummary.failed.length > 5 && (
                    <p className="text-xs">
                      + {uploadSummary.failed.length - 5} outra(s) com o
                      mesmo tipo de erro.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
                                  setCodeEdits((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.value,
                                  }))
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
                                    setDeleteTarget({
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
        <CardContent className="space-y-1 p-4 text-sm text-muted-foreground">
          <p>
            <strong>Estados sem alíquota de ST na planilha</strong> são
            tratados como isentos — não é preciso preencher todos os
            estados.
          </p>
          <p>
            Colunas lidas da aba GERAL: CÓDIGO, Descrição, COR, EMBALAGEM,
            TABELA (preço) e FAMÍLIA.
          </p>
        </CardContent>
      </Card>

      {/* Confirmação antes de importar */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {fileName}
            </DialogTitle>
          </DialogHeader>

          {parsed && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <p className="text-2xl font-bold">{parsed.products.length}</p>
                  <p className="text-muted-foreground">produtos (aba GERAL)</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-2xl font-bold">{parsed.stRates.length}</p>
                  <p className="text-muted-foreground">
                    alíquotas de ST {parsed.missingTabelaSt && "(aba não encontrada)"}
                  </p>
                </div>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Família</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.products.slice(0, 6).map((p) => (
                      <TableRow key={p.code}>
                        <TableCell>{p.code}</TableCell>
                        <TableCell className="max-w-[160px] truncate">
                          {p.description}
                        </TableCell>
                        <TableCell>{p.family || "—"}</TableCell>
                        <TableCell className="text-right">
                          {p.table_price.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsed.products.length > 6 && (
                  <p className="p-2 text-center text-xs text-muted-foreground">
                    + {parsed.products.length - 6} produto(s)
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmImport} disabled={importing}>
              {importing ? "Importando..." : "Confirmar importação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover imagem</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget &&
              `Remover a foto do produto ${deleteTarget.code} — ${deleteTarget.description}?`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
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
