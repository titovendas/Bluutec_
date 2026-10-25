import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowLeft, FileSpreadsheet, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { bytesToBase64 } from "@/lib/base64";
import { inspectFactoryTemplate, FACTORY_SHEET_NAME } from "@/lib/factory-sheet";
import { normalizeZip } from "@/lib/zip-lite";
import { cacheFactoryTemplate } from "@/lib/factory-template-client";
import {
  getFactoryTemplateInfo,
  saveFactoryTemplate,
} from "@/lib/factory-template.functions";
import { importPriceTable } from "@/lib/sales.functions";

export const Route = createFileRoute("/_authenticated/configuracoes_/planilha-fabrica")({
  component: FactorySheetPage,
  head: () => ({
    meta: [
      { title: "Planilha da fábrica | Força de Vendas" },
      { name: "description", content: "Modelo de pedido da fábrica." },
    ],
  }),
});

type PriceRow = {
  code: string;
  description: string;
  family: string;
  color: string;
  package_qty?: number;
  table_price: number;
};

type Pending = {
  fileName: string;
  bytes: Uint8Array;
  itemRows: number;
  products: PriceRow[];
};

/** Lê os produtos e preços direto da aba GERAL do modelo da fábrica:
 * A código, B descrição, C cor, D embalagem, F tabela, P família. */
function readProducts(bytes: Uint8Array): PriceRow[] {
  const workbook = XLSX.read(normalizeZip(bytes), { type: "array" });
  const sheet = workbook.Sheets[FACTORY_SHEET_NAME];
  if (!sheet) return [];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: true,
    raw: true,
  });
  const products: PriceRow[] = [];
  for (let i = 9; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const codeNumber = Number(row[0]);
    const price = Number(row[5]);
    if (!Number.isInteger(codeNumber) || codeNumber <= 0 || !(price > 0)) continue;
    const pack = Number(row[3]);
    products.push({
      code: String(codeNumber),
      description: String(row[1] ?? "").trim(),
      family: String(row[15] ?? "").trim(),
      color: String(row[2] ?? "").trim(),
      ...(Number.isInteger(pack) && pack > 0 ? { package_qty: pack } : {}),
      table_price: price,
    });
  }
  return products;
}

function FactorySheetPage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [alsoPrices, setAlsoPrices] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: info, refetch } = useQuery({
    queryKey: ["factory-template-info"],
    queryFn: () => getFactoryTemplateInfo(),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = await inspectFactoryTemplate(bytes);
      const products = readProducts(bytes);
      setPending({ fileName: file.name, bytes, itemRows: check.itemRows, products });
    } catch (err: any) {
      setPending(null);
      toast.error(err?.message || "Não consegui abrir essa planilha.");
    } finally {
      e.target.value = "";
    }
  };

  const handleSave = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const saved = await saveFactoryTemplate({
        data: { fileName: pending.fileName, contentBase64: bytesToBase64(pending.bytes) },
      });
      await cacheFactoryTemplate({
        id: saved.id,
        fileName: pending.fileName,
        uploadedAt: saved.uploadedAt,
        bytes: pending.bytes,
      });

      if (alsoPrices && pending.products.length > 0) {
        const result = await importPriceTable({
          data: { fileName: pending.fileName, products: pending.products },
        });
        toast.success(
          `Modelo guardado e ${result.importedProducts} produtos atualizados na tabela de preços.`
        );
      } else {
        toast.success("Modelo da fábrica guardado.");
      }
      setPending(null);
      await refetch();
      await queryClient.invalidateQueries();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao guardar o modelo.");
    } finally {
      setSaving(false);
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
        <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Planilha da fábrica</h1>
          <p className="text-muted-foreground">
            Modelo de pedido que a fábrica usa. O sistema preenche sozinho.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelo atual</CardTitle>
          <CardDescription>
            {info
              ? `${info.fileName} — enviado em ${new Date(info.uploadedAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}`
              : "Nenhum modelo enviado ainda."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={handleFile}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {info ? "Enviar nova versão" : "Enviar planilha da fábrica"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Quando a fábrica mandar uma versão nova da planilha (preços ou produtos),
            envie aqui de novo. A proteção e as fórmulas dela não são alteradas.
          </p>
        </CardContent>
      </Card>

      {pending && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Planilha reconhecida
            </CardTitle>
            <CardDescription>
              {pending.fileName} — {pending.itemRows} produtos no modelo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="also-prices"
                checked={alsoPrices}
                onCheckedChange={(v) => setAlsoPrices(v === true)}
              />
              <Label htmlFor="also-prices" className="text-sm leading-snug">
                Atualizar também a tabela de preços com os {pending.products.length} produtos
                e preços desta planilha (código, descrição, cor, embalagem, família e preço).
              </Label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : "Guardar modelo"}
              </Button>
              <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
