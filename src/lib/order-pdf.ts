import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logo from "@/assets/uzzy-logo.png";
import { formatCurrency, formatDate } from "@/lib/sales-formatters";

// Proporção real do arquivo de logo (largura / altura), para nunca
// desenhá-lo achatado ou esticado no PDF.
const LOGO_ASPECT_RATIO = 392 / 180;
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
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();

  const logoData = await toDataUrl(logo);
  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", 40, 28, LOGO_WIDTH, LOGO_HEIGHT);
    } catch {
      /* ignore */
    }
  }

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("Cópia do pedido", pageWidth - 40, 44, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Nº ${String(order.id).slice(0, 8).toUpperCase()}`, pageWidth - 40, 60, {
    align: "right",
  });
  doc.text(formatDate(order.created_at), pageWidth - 40, 74, { align: "right" });

  doc.setDrawColor(200);
  doc.line(40, 90, pageWidth - 40, 90);

  doc.setTextColor(40);
  doc.setFontSize(10);
  const customer = order.customer ?? {};
  const cityState = [customer.city, customer.state].filter(Boolean).join("/");
  const infoLines = [
    `Cliente: ${order.customer_name ?? "—"}`,
    `CNPJ: ${formatCnpj(customer.document) || "—"}`,
    `Telefone: ${customer.phone ?? "—"}`,
    `Rua: ${customer.address || "—"}`,
    `Bairro: ${customer.neighborhood || "—"}    CEP: ${formatCep(customer.zip_code) || "—"}`,
    `Cidade/UF: ${cityState || "—"}`,
  ];
  infoLines.forEach((line, i) => doc.text(line, 40, 108 + i * 14));

  const images = await Promise.all(
    items.map((item) => (item.image_url ? toDataUrl(item.image_url) : null))
  );

  const tableStartY = 108 + infoLines.length * 14 + 16;

  autoTable(doc, {
    startY: tableStartY,
    head: [
      [
        "Foto",
        "Código",
        "Descrição",
        "Qtd",
        "Unitário",
        "IPI",
        "ST",
        "Unit. c/ impostos",
        "Total",
      ],
    ],
    body: items.map((item) => {
      const unitWithTaxes =
        Number(item.unit_price) *
        (1 + (Number(item.ipi_percent) + Number(item.st_percent)) / 100);
      return [
        "",
        item.code ?? "—",
        item.description ?? "—",
        String(item.quantity),
        formatCurrency(item.unit_price),
        `${formatCurrency(item.ipi_value)}\n(${item.ipi_percent}%)`,
        `${formatCurrency(item.st_value)}\n(${item.st_percent}%)`,
        formatCurrency(unitWithTaxes),
        formatCurrency(item.total),
      ];
    }),
    styles: { fontSize: 8, cellPadding: 5, valign: "middle" },
    headStyles: { fillColor: [200, 30, 35], textColor: 255, halign: "center" },
    columnStyles: {
      0: { cellWidth: 38, minCellHeight: 38, halign: "center" },
      1: { cellWidth: 50, halign: "left" },
      2: { halign: "left" },
      3: { cellWidth: 32, halign: "right" },
      4: { cellWidth: 65, halign: "right" },
      5: { cellWidth: 70, halign: "right" },
      6: { cellWidth: 70, halign: "right" },
      7: { cellWidth: 75, halign: "right", fontStyle: "bold", textColor: [200, 30, 35] },
      8: { cellWidth: 68, halign: "right" },
    },
    didDrawCell: (data: any) => {
      if (data.section === "body" && data.column.index === 0) {
        const img = images[data.row.index];
        if (img) {
          try {
            doc.addImage(img, "JPEG", data.cell.x + 3, data.cell.y + 3, 32, 32);
          } catch {
            /* ignore */
          }
        }
      }
    },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 20;

  // Totais alinhados à direita
  const totalsRows: [string, number][] = [
    ["Subtotal", Number(order.subtotal ?? 0)],
    ["IPI", Number(order.ipi_total ?? 0)],
    ["ST (valor aprox.)", Number(order.st_total ?? 0)],
  ];
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  totalsRows.forEach(([label, value], i) => {
    doc.text(label, pageWidth - 200, finalY + i * 15);
    doc.text(formatCurrency(value), pageWidth - 40, finalY + i * 15, {
      align: "right",
    });
  });
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Total", pageWidth - 200, finalY + 55);
  doc.text(formatCurrency(Number(order.total ?? 0)), pageWidth - 40, finalY + 55, {
    align: "right",
  });

  // Vendedor e condição de pagamento, no rodapé do orçamento
  const footerY = finalY + 90;
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

  doc.save(`pedido-${String(order.id).slice(0, 8)}.pdf`);
}
