import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logo from "@/assets/bluutec-logo.png";
import { formatCurrency, formatDate, orderNumberLabel } from "@/lib/sales-formatters";

// Paleta Bluutec: azul da marca (#008ECA).
const BRAND_COLOR: [number, number, number] = [0, 142, 202];

// Dados da empresa que aparecem no topo do PDF.
const COMPANY = {
  legalName: "BLUUTEC PLÁSTICOS LTDA",
  cnpj: "58.380.453/0001-70",
  // Cada item é uma linha no PDF
  addressLines: [
    "R. Pedro de Alcântara Meira, 445 - Fazenda Velha",
    "Araucária - PR, 83708-132",
  ],
  site: "www.bluutec.com.br",
};

/** 21.3499999 -> "21,35" (sem casas sobrando). */
const fmtPct = (n: unknown) =>
  Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

// Proporção real do arquivo de logo (largura / altura), para nunca
// desenhá-lo achatado ou esticado no PDF.
const LOGO_ASPECT_RATIO = 702 / 206;
const LOGO_HEIGHT = 34;
const LOGO_WIDTH = LOGO_HEIGHT * LOGO_ASPECT_RATIO;

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Busca a foto do produto e já reduz pra miniatura (lado maior até
 * 160px, JPEG 80%) antes de embutir no PDF — a foto original pode ter
 * vários MB, e no PDF ela aparece do tamanho de um selo postal. Sem
 * isso, um pedido com poucos itens já gerava um PDF de dezenas de MB.
 * Devolve também a proporção real da imagem, pra desenhar sem esticar.
 */
async function toThumbnail(
  url: string,
  maxDimension = 160,
  quality = 0.8
): Promise<{ dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" } | null> {
  const original = await toDataUrl(url);
  if (!original) return null;
  try {
    const img = await loadImage(original);
    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);

    // Foto com fundo transparente (PNG/WEBP) precisa continuar em PNG —
    // JPEG não tem transparência e pintaria o fundo de preto.
    const originalMime = original.slice(5, original.indexOf(";"));
    const preserveTransparency = /png|webp|gif/i.test(originalMime);
    if (preserveTransparency) {
      return { dataUrl: canvas.toDataURL("image/png"), width, height, format: "PNG" };
    }
    return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height, format: "JPEG" };
  } catch {
    return null;
  }
}

function formatCep(cep?: string | null) {
  if (!cep) return "";
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return cep;
  return digits.replace(/(\d{5})(\d{3})/, "$1-$2");
}

function formatCnpj(doc?: string | null) {
  if (!doc) return "";
  const digits = doc.replace(/\D/g, "");
  if (digits.length !== 14) return doc;
  return digits.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5"
  );
}

export async function generateOrderPdf(order: any, items: any[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();

  const logoData = await toDataUrl(logo);
  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", 40, 28, LOGO_WIDTH, LOGO_HEIGHT);
    } catch {
      /* ignore */
    }
  }

  const isConfirmed = order.status === "pedido";
  const numberLabel = orderNumberLabel(order);
  const numberText = numberLabel === "—" ? "" : `Nº ${String(order.order_number).padStart(4, "0")}`;

  // Dados da empresa, ao lado do logo (quebra de linha automática pra não
  // encostar no título, à direita)
  const companyX = 40 + LOGO_WIDTH + 18;
  const companyMaxWidth = pageWidth - 40 - 105 - companyX;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(40);
  doc.text(COMPANY.legalName, companyX, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  const companyLines = [
    `CNPJ: ${COMPANY.cnpj}`,
    ...COMPANY.addressLines,
    COMPANY.site,
  ]
    .filter(Boolean)
    .flatMap((l) => doc.splitTextToSize(l, companyMaxWidth) as string[]);
  companyLines.forEach((line, i) => doc.text(line, companyX, 47 + i * 10));
  const headerBottom = Math.max(90, 47 + (companyLines.length - 1) * 10 + 14);

  // Título, número e data, à direita
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20);
  doc.text(isConfirmed ? "Pedido" : "Orçamento", pageWidth - 40, 44, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  if (numberText) doc.text(numberText, pageWidth - 40, 60, { align: "right" });
  doc.text(formatDate(order.created_at), pageWidth - 40, numberText ? 74 : 60, {
    align: "right",
  });

  doc.setDrawColor(200);
  doc.line(40, headerBottom, pageWidth - 40, headerBottom);
  const infoStartY = headerBottom + 16;

  // Dados do cliente: fonte menor e em duas colunas (ocupa metade da altura)
  doc.setTextColor(40);
  doc.setFontSize(8.5);
  const customer = order.customer ?? {};
  const cityState = [customer.city, customer.state].filter(Boolean).join("/");
  const colWidth = pageWidth / 2 - 50;
  const wrap = (lines: string[]) =>
    lines.flatMap((l) => doc.splitTextToSize(l, colWidth) as string[]);
  const leftLines = wrap([
    `Cliente: ${order.customer_name ?? "—"}`,
    `CNPJ: ${formatCnpj(customer.document) || "—"}`,
    `Telefone: ${customer.phone ?? "—"}`,
  ]);
  const rightLines = wrap([
    `Rua: ${customer.address || "—"}`,
    `Bairro: ${customer.neighborhood || "—"}    CEP: ${formatCep(customer.zip_code) || "—"}`,
    `Cidade/UF: ${cityState || "—"}`,
  ]);
  const leading = 11.5;
  leftLines.forEach((line, i) => doc.text(line, 40, infoStartY + i * leading));
  rightLines.forEach((line, i) => doc.text(line, pageWidth / 2, infoStartY + i * leading));
  const infoRows = Math.max(leftLines.length, rightLines.length);

  const images = await Promise.all(
    items.map((item) => (item.image_url ? toThumbnail(item.image_url) : null))
  );

  const tableStartY = infoStartY + infoRows * leading + 8;

  // Nenhum produto da tabela atual tem IPI: a coluna (e a linha do total)
  // só aparece se algum item do pedido tiver IPI, pra nunca esconder imposto.
  const showIpi = items.some((i: any) => Number(i.ipi_percent) > 0);

  // Larguras pensadas para a página em pé (515pt úteis): a descrição fica
  // com o que sobra e quebra em duas linhas quando necessário.
  const colStyles: Record<number, any> = {
    0: { cellWidth: 38, minCellHeight: 38, halign: "center" },
    1: { cellWidth: 48, halign: "left" },
    2: { halign: "left" },
    3: { cellWidth: 30, halign: "right" },
    4: { cellWidth: 54, halign: "right" },
  };
  let col = 5;
  if (showIpi) colStyles[col++] = { cellWidth: 56, halign: "right" };
  colStyles[col++] = { cellWidth: 56, halign: "right" }; // ST
  colStyles[col++] = { cellWidth: 60, halign: "right", fontStyle: "bold", textColor: BRAND_COLOR };
  colStyles[col++] = { cellWidth: 64, halign: "right" }; // Total

  autoTable(doc, {
    startY: tableStartY,
    head: [
      [
        "Foto",
        "Código",
        "Descrição",
        "Qtd",
        "Unitário",
        ...(showIpi ? ["IPI"] : []),
        "ST",
        "Unit. c/ impostos",
        "Total",
      ],
    ],
    body: items.map((item: any) => {
      const unitWithTaxes =
        Number(item.unit_price) *
        (1 + (Number(item.ipi_percent) + Number(item.st_percent)) / 100);
      return [
        "",
        item.code ?? "—",
        item.description ?? "—",
        String(item.quantity),
        formatCurrency(item.unit_price),
        ...(showIpi
          ? [`${formatCurrency(item.ipi_value)}\n(${fmtPct(item.ipi_percent)}%)`]
          : []),
        `${formatCurrency(item.st_value)}\n(${fmtPct(item.st_percent)}%)`,
        formatCurrency(unitWithTaxes),
        formatCurrency(item.total),
      ];
    }),
    styles: { fontSize: 8, cellPadding: { top: 4, bottom: 4, left: 3, right: 3 }, valign: "middle" },
    headStyles: { fillColor: BRAND_COLOR, textColor: 255, halign: "center", fontSize: 7.5 },
    margin: { left: 40, right: 40 },
    columnStyles: colStyles,
    didDrawCell: (data: any) => {
      if (data.section === "body" && data.column.index === 0) {
        const img = images[data.row.index];
        if (img) {
          try {
            // Encaixa dentro da célula mantendo a proporção real da
            // foto (nunca estica pra virar quadrado) e centraliza.
            const maxBox = 32;
            const scale = Math.min(maxBox / img.width, maxBox / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = data.cell.x + (data.cell.width - w) / 2;
            const y = data.cell.y + (data.cell.height - h) / 2;
            doc.addImage(img.dataUrl, img.format, x, y, w, h);
          } catch {
            /* ignore */
          }
        }
      }
    },
  });

  const pageHeight = doc.internal.pageSize.getHeight();
  let finalY = (doc as any).lastAutoTable.finalY + 20;

  // Observações do pedido (quebra de linha automática)
  const notesText = String(order.notes ?? "").trim();
  doc.setFontSize(9);
  const notesLines = notesText
    ? (doc.splitTextToSize(notesText, pageWidth - 80) as string[])
    : [];

  // Se não couber o restante na página, continua numa página nova
  const needed = 105 + (notesLines.length ? 26 + notesLines.length * 11 : 0);
  if (finalY + needed > pageHeight - 30) {
    doc.addPage();
    finalY = 50;
  }

  // Totais alinhados à direita
  const totalsRows: [string, number][] = [
    ["Subtotal", Number(order.subtotal ?? 0)],
    ...(showIpi ? ([["IPI", Number(order.ipi_total ?? 0)]] as [string, number][]) : []),
    ["ST (valor aprox.)", Number(order.st_total ?? 0)],
  ];
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40);
  totalsRows.forEach(([label, value], i) => {
    doc.text(label, pageWidth - 200, finalY + i * 15);
    doc.text(formatCurrency(value), pageWidth - 40, finalY + i * 15, {
      align: "right",
    });
  });
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND_COLOR);
  doc.text("Total", pageWidth - 200, finalY + totalsRows.length * 15 + 10);
  doc.text(formatCurrency(Number(order.total ?? 0)), pageWidth - 40, finalY + totalsRows.length * 15 + 10, {
    align: "right",
  });
  doc.setTextColor(40);

  // Vendedor e condição de pagamento, no rodapé do orçamento
  const footerY = finalY + totalsRows.length * 15 + 45;
  doc.setDrawColor(220);
  doc.line(40, footerY - 16, pageWidth - 40, footerY - 16);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40);
  doc.text(`Vendedor: ${order.seller_name ?? "—"}`, 40, footerY);
  doc.text(
    `Condição de pagamento: ${order.payment_term ?? "—"}`,
    40,
    footerY + 16
  );
  doc.text("Frete: CIF", 40, footerY + 32);

  if (notesLines.length > 0) {
    const notesY = footerY + 56;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Observações:", 40, notesY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    notesLines.forEach((line, i) => doc.text(line, 40, notesY + 14 + i * 11));
  }

  const fileNumber = order.order_number != null && numberText
    ? String(order.order_number).padStart(4, "0")
    : String(order.id).slice(0, 8);
  doc.save(`${isConfirmed ? "pedido" : "orcamento"}-${fileNumber}.pdf`);
}
