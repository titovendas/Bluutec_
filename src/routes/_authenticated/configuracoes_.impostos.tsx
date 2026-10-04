import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  Percent,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  importTaxRates,
  listTaxRatesSummary,
  listTaxRatesByUf,
  updateTaxRate,
  deleteTaxRate,
} from "@/lib/sales.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracoes_/impostos")({
  component: TaxRatesSettingsPage,
  head: () => ({
    meta: [
      { title: "Impostos | Força de Vendas" },
      {
        name: "description",
        content: "Configure IPI e ST por estado, por produto.",
      },
    ],
  }),
});

const BRAZIL_STATES = [
  { uf: "AC", name: "Acre" },
  { uf: "AL", name: "Alagoas" },
  { uf: "AP", name: "Amapá" },
  { uf: "AM", name: "Amazonas" },
  { uf: "BA", name: "Bahia" },
  { uf: "CE", name: "Ceará" },
  { uf: "DF", name: "Distrito Federal" },
  { uf: "ES", name: "Espírito Santo" },
  { uf: "GO", name: "Goiás" },
  { uf: "MA", name: "Maranhão" },
  { uf: "MT", name: "Mato Grosso" },
  { uf: "MS", name: "Mato Grosso do Sul" },
  { uf: "MG", name: "Minas Gerais" },
  { uf: "PA", name: "Pará" },
  { uf: "PB", name: "Paraíba" },
  { uf: "PR", name: "Paraná" },
  { uf: "PE", name: "Pernambuco" },
  { uf: "PI", name: "Piauí" },
  { uf: "RJ", name: "Rio de Janeiro" },
  { uf: "RN", name: "Rio Grande do Norte" },
  { uf: "RS", name: "Rio Grande do Sul" },
  { uf: "RO", name: "Rondônia" },
  { uf: "RR", name: "Roraima" },
  { uf: "SC", name: "Santa Catarina" },
  { uf: "SP", name: "São Paulo" },
  { uf: "SE", name: "Sergipe" },
  { uf: "TO", name: "Tocantins" },
];

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

type TaxColumnField = "code" | "ipi_percent" | "st_percent";

const TAX_COLUMN_FIELDS: { key: TaxColumnField; label: string; required: boolean }[] = [
  { key: "code", label: "Código do produto", required: true },
  { key: "ipi_percent", label: "IPI (%)", required: false },
  { key: "st_percent", label: "ST (%)", required: false },
];

function TaxRatesSettingsPage() {
  const queryClient = useQueryClient();
  const [uf, setUf] = useState("");

  const { data: summary = {} } = useQuery({
    queryKey: ["tax-rates-summary"],
    queryFn: () => listTaxRatesSummary(),
  });

  const { data: rates = [], isLoading: ratesLoading } = useQuery({
    queryKey: ["tax-rates", uf],
    queryFn: () => listTaxRatesByUf({ data: { uf } }),
    enabled: !!uf,
  });

  // --- Importar planilha de impostos (assistente de mapeamento) ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [allRows, setAllRows] = useState<any[][]>([]);
  const [headerRow, setHeaderRow] = useState(1);
  const [columnMap, setColumnMap] = useState<Record<TaxColumnField, number | null>>({
    code: null,
    ipi_percent: null,
    st_percent: null,
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

  const resetColumnMap = () =>
    setColumnMap({ code: null, ipi_percent: null, st_percent: null });

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
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
      resetColumnMap();
      (window as any).__taxRatesWorkbook = workbook;
      setWizardOpen(true);
    } catch {
      toast.error("Não consegui abrir esse arquivo. Confira se é um .xlsx válido.");
    } finally {
      e.target.value = "";
    }
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    const workbook = (window as any).__taxRatesWorkbook as XLSX.WorkBook | undefined;
    if (workbook) readSheet(workbook, sheetName);
    setHeaderRow(1);
    resetColumnMap();
  };

  const columnCount = useMemo(
    () => Math.max(0, ...allRows.slice(0, 30).map((r) => r.length)),
    [allRows]
  );
  const headerRowIndex = headerRow - 1;
  const headerCells = allRows[headerRowIndex] ?? [];
  const dataRows = useMemo(() => allRows.slice(headerRowIndex + 1), [allRows, headerRowIndex]);

  const columnOptionLabel = (colIndex: number) => {
    const headerText = String(headerCells[colIndex] ?? "").trim();
    return headerText ? `${columnLetter(colIndex)} — ${headerText}` : `Coluna ${columnLetter(colIndex)}`;
  };

  const previewRates = useMemo(() => {
    if (columnMap.code === null) return [];
    return dataRows
      .map((row) => {
        const code = String(row[columnMap.code as number] ?? "").trim();
        if (!code) return null;
        return {
          code,
          ipi_percent:
            columnMap.ipi_percent !== null ? toNumber(row[columnMap.ipi_percent]) : 0,
          st_percent:
            columnMap.st_percent !== null ? toNumber(row[columnMap.st_percent]) : 0,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  }, [dataRows, columnMap]);

  const canImport =
    !!uf && columnMap.code !== null && (columnMap.ipi_percent !== null || columnMap.st_percent !== null);

  const handleConfirmImport = async () => {
    if (!canImport || previewRates.length === 0) return;
    setImporting(true);
    try {
      const result = await importTaxRates({ data: { uf, rates: previewRates } });
      toast.success(
        `${result.imported} imposto(s) importado(s) para ${result.uf}.${
          result.notFound.length > 0
            ? ` ${result.notFound.length} código(s) não encontrado(s) no catálogo.`
            : ""
        }`
      );
      setWizardOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tax-rates-summary"] });
      queryClient.invalidateQueries({ queryKey: ["tax-rates", uf] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao importar os impostos.");
    } finally {
      setImporting(false);
    }
  };

  // --- Impostos cadastrados no estado selecionado (editar / excluir) ---
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, Record<string, any>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    code: string;
    description: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredRates = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rates as any[];
    return (rates as any[]).filter(
      (r) => r.code?.toLowerCase().includes(term) || r.description?.toLowerCase().includes(term)
    );
  }, [rates, search]);

  const getValue = (row: any, field: string) => edits[row.id]?.[field] ?? row[field] ?? "";
  const setValue = (id: string, field: string, value: any) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  const isDirty = (row: any) => !!edits[row.id];

  const handleSaveRate = async (row: any) => {
    const rowEdits = edits[row.id] as Record<string, any> | undefined;
    if (!rowEdits) return;
    setSavingId(row.id);
    try {
      await updateTaxRate({
        data: {
          id: row.id,
          ...(rowEdits["ipi_percent"] !== undefined && {
            ipi_percent: toNumber(rowEdits["ipi_percent"]),
          }),
          ...(rowEdits["st_percent"] !== undefined && {
            st_percent: toNumber(rowEdits["st_percent"]),
          }),
        },
      });
      toast.success(`Imposto do produto ${row.code} atualizado.`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["tax-rates", uf] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar.");
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTaxRate({ data: { id: deleteTarget.id } });
      toast.success("Imposto removido.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["tax-rates", uf] });
      queryClient.invalidateQueries({ queryKey: ["tax-rates-summary"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover.");
    } finally {
      setDeleting(false);
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
        <Percent className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Impostos</h1>
          <p className="text-muted-foreground">
            IPI e ST variam por estado — configure um estado por vez.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado</CardTitle>
          <CardDescription>
            Ao montar um orçamento, o sistema identifica o estado do cliente e
            já aplica os impostos configurados aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={uf} onValueChange={setUf}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue placeholder="Selecione o estado" />
            </SelectTrigger>
            <SelectContent>
              {BRAZIL_STATES.map((s) => (
                <SelectItem key={s.uf} value={s.uf}>
                  {s.uf} — {s.name}
                  {(summary as any)[s.uf] ? ` (${(summary as any)[s.uf]})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {uf && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Importar impostos — {uf}</CardTitle>
              <CardDescription>
                Envie a planilha desse estado — na próxima tela você indica em
                qual coluna está o Código, o IPI e o ST. Reimportar atualiza os
                produtos já cadastrados nesse estado.
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
                Importar planilha de impostos
              </Button>
              <p className="text-sm text-muted-foreground">
                {(rates as any[]).length} produto(s) com imposto cadastrado em {uf}.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Impostos cadastrados — {uf}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por código ou descrição..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-[32rem] overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead className="min-w-[160px]">Descrição</TableHead>
                      <TableHead className="w-24">IPI (%)</TableHead>
                      <TableHead className="w-24">ST (%)</TableHead>
                      <TableHead className="w-20 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ratesLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    ) : filteredRates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                          Nenhum imposto cadastrado em {uf} ainda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRates.map((row: any) => {
                        const dirty = isDirty(row);
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-mono text-xs">{row.code}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm">
                              {row.description}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={getValue(row, "ipi_percent")}
                                onChange={(e) => setValue(row.id, "ipi_percent", e.target.value)}
                                className="h-8 w-20 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={getValue(row, "st_percent")}
                                onChange={(e) => setValue(row.id, "st_percent", e.target.value)}
                                className="h-8 w-20 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {dirty && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSaveRate(row)}
                                    disabled={savingId === row.id}
                                  >
                                    {savingId === row.id ? "..." : "Salvar"}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    setDeleteTarget({
                                      id: row.id,
                                      code: row.code,
                                      description: row.description,
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
          </Card>
        </>
      )}

      {/* Assistente de importação: mapear colunas */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
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
              <Label>Em qual linha está o cabeçalho?</Label>
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
              {TAX_COLUMN_FIELDS.map((field) => (
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
                {previewRates.length} linha(s) encontrada(s) com esse mapeamento.
              </p>
              {!canImport && (
                <p className="text-amber-700">
                  Selecione a coluna de Código e pelo menos uma de IPI ou ST.
                </p>
              )}
            </div>

            {canImport && previewRates.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead className="text-right">IPI</TableHead>
                      <TableHead className="text-right">ST</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRates.slice(0, 5).map((r, i) => (
                      <TableRow key={r.code + i}>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell className="text-right text-xs">{r.ipi_percent}%</TableCell>
                        <TableCell className="text-right text-xs">{r.st_percent}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {previewRates.length > 5 && (
                  <p className="p-2 text-center text-xs text-muted-foreground">
                    + {previewRates.length - 5} linha(s)
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWizardOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmImport} disabled={!canImport || previewRates.length === 0 || importing}>
              {importing ? "Importando..." : `Importar ${previewRates.length} linha(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover imposto</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget &&
              `Remover o imposto de ${deleteTarget.code} — ${deleteTarget.description} em ${uf}?`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
