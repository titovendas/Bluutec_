import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Upload,
  Trash2,
  FileSpreadsheet,
  ChevronDown,
  CreditCard,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
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
  listPaymentTerms,
  importPaymentTerms,
  deletePaymentTerm,
} from "@/lib/sales.functions";
import { toast } from "sonner";

export const Route = createFileRoute(
  "/_authenticated/configuracoes_/prazos-pagamento"
)({
  component: PaymentTermsSettingsPage,
  head: () => ({
    meta: [
      { title: "Prazos de pagamento | Força de Vendas" },
      { name: "description", content: "Importe e gerencie os prazos de pagamento." },
    ],
  }),
});

type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

function parseWorkbook(data: ArrayBuffer): ParsedSheet {
  const workbook = XLSX.read(data, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return { headers: [], rows: [] };
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (raw.length === 0) return { headers: [], rows: [] };
  const headerRow = raw[0] ?? [];
  const headers = headerRow.map((h: any, i: number) =>
    h === "" || h === undefined ? `Coluna ${i + 1}` : String(h)
  );
  const rows = raw
    .slice(1)
    .map((r) => headers.map((_: string, i: number) => String(r?.[i] ?? "")));
  return { headers, rows };
}

function PaymentTermsSettingsPage() {
  const queryClient = useQueryClient();
  const { data: paymentTerms = [], isLoading } = useQuery({
    queryKey: ["payment-terms-admin"],
    queryFn: () => listPaymentTerms(),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const result = parseWorkbook(buffer);
      if (result.headers.length === 0) {
        toast.error("Não consegui ler nenhuma linha nessa planilha.");
        return;
      }
      setFileName(file.name);
      setParsed(result);
      setSelectedColumn("");
      setImportOpen(true);
    } catch {
      toast.error("Não consegui abrir esse arquivo. Confira se é um .xlsx ou .xls válido.");
    } finally {
      e.target.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!parsed || !selectedColumn) return;
    const columnIndex = parsed.headers.indexOf(selectedColumn);
    if (columnIndex === -1) return;

    const labels = parsed.rows
      .map((row) => row[columnIndex]?.trim())
      .filter((v): v is string => !!v);

    if (labels.length === 0) {
      toast.error("Essa coluna não tem valores para importar.");
      return;
    }

    setImporting(true);
    try {
      const result = await importPaymentTerms({ data: { labels } });
      toast.success(`${result.imported} prazo(s) de pagamento importado(s).`);
      setImportOpen(false);
      setParsed(null);
      setListOpen(true);
      queryClient.invalidateQueries({ queryKey: ["payment-terms-admin"] });
      queryClient.invalidateQueries({ queryKey: ["payment-terms"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao importar a planilha.");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deletePaymentTerm({ data: { id: deleteId } });
      toast.success("Prazo removido");
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["payment-terms-admin"] });
      queryClient.invalidateQueries({ queryKey: ["payment-terms"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
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
        <CreditCard className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Prazos de pagamento
          </h1>
          <p className="text-muted-foreground">
            Importe e gerencie os prazos usados nos pedidos.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar planilha</CardTitle>
          <CardDescription>
            Envie um Excel com os prazos de pagamento. Você escolhe qual
            coluna da planilha contém os prazos antes de confirmar.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            <p className="mt-2 text-xs text-amber-700">
              A importação precisa de internet — tente novamente quando
              estiver online.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <Collapsible open={listOpen} onOpenChange={setListOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <div>
                <p className="font-medium">
                  Prazos cadastrados
                  {!isLoading && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({paymentTerms.length})
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {listOpen ? "Toque para recolher" : "Toque para ver a lista"}
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  listOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prazo</TableHead>
                    <TableHead className="w-16 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-20 text-center text-muted-foreground">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : paymentTerms.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-20 text-center text-muted-foreground">
                        Nenhum prazo cadastrado ainda. Importe uma planilha
                        para começar.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paymentTerms.map((term: any) => (
                      <TableRow key={term.id}>
                        <TableCell>{term.label}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(term.id)}
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
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Diálogo: escolher a coluna da planilha */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {fileName}
            </DialogTitle>
          </DialogHeader>

          {parsed && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Em qual coluna estão os prazos de pagamento?
              </p>
              <RadioGroup value={selectedColumn} onValueChange={setSelectedColumn}>
                <div className="space-y-2">
                  {parsed.headers.map((header) => (
                    <div key={header} className="flex items-center gap-2">
                      <RadioGroupItem value={header} id={`col-${header}`} />
                      <Label htmlFor={`col-${header}`} className="cursor-pointer font-normal">
                        {header}
                      </Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>

              {selectedColumn && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Prévia dos valores dessa coluna:
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">
                    {parsed.rows
                      .slice(0, 8)
                      .map((row) => row[parsed.headers.indexOf(selectedColumn)])
                      .filter(Boolean)
                      .map((v, i) => (
                        <li key={i}>• {v}</li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={!selectedColumn || importing}
            >
              {importing ? "Importando..." : "Confirmar importação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão de um prazo */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover prazo de pagamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza? Pedidos que já usam esse prazo não serão alterados.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
