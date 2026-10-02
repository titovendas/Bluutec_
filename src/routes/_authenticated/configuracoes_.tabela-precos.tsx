import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  Tags,
  CheckCircle2,
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
import { importPriceTable, getPriceTableSummary } from "@/lib/sales.functions";
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
    } catch (err: any) {
      toast.error(err.message || "Erro ao importar a planilha.");
    } finally {
      setImporting(false);
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
    </div>
  );
}
