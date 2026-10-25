// Preenche a planilha de pedido da fábrica (modelo enviado por eles) com os
// dados do pedido, alterando SOMENTE as células de entrada:
//   B3  razão social        I3  estado (UF)       O4  política comercial
//   E   quantidade (por código)    M   desconto do item (combinado)
//   J   ST (zerado só para cliente construtora)
// Todo o resto — fórmulas, proteção, listas de opções, imagens — é copiado
// do arquivo original sem mexer. A planilha recalcula tudo ao abrir no Excel.
import {
  inflateEntry,
  makeEntry,
  readZip,
  writeZip,
  type ZipEntry,
} from "@/lib/zip-lite";

export const FACTORY_SHEET_NAME = "GERAL";

/** Estados que a aba de ST da fábrica sabe calcular. */
export const FACTORY_SHEET_UFS = ["PR", "SC", "RS", "SP", "RJ", "MG", "MS", "GO", "DF", "ES", "PE", "MA"];
const FIRST_ITEM_ROW = 10;

export type FactorySheetItem = {
  code: string;
  quantity: number;
  /** Desconto combinado em fração (0,0591 = 5,91%). */
  discountFraction: number;
};

export type FactorySheetInput = {
  template: Uint8Array;
  customerName: string;
  policyFraction: number;
  uf: string | null;
  taxFree: boolean;
  items: FactorySheetItem[];
};

export type FactorySheetResult = {
  bytes: Uint8Array;
  /** Códigos do pedido que não existem na planilha da fábrica. */
  missingCodes: string[];
};

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function colToNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function normalizeCode(value: string): string {
  const trimmed = value.trim();
  // O Excel guarda o código como número, às vezes em notação científica
  // (7.0012003E7): converte para "70012003".
  if (/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isInteger(n)) return String(n);
  }
  return trimmed;
}

function parseSharedStrings(xml: string): string[] {
  const result: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRegex.exec(xml))) {
    let text = "";
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRegex.exec(m[1]!))) text += t[1]!;
    result.push(xmlUnescape(text));
  }
  return result;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

function cellRegex(ref: string) {
  return new RegExp(`<c r="${ref}"([^>/]*)(?:/>|>([\\s\\S]*?)</c>)`);
}

/** Cria/substitui uma célula dentro do texto de uma linha, mantendo o estilo. */
function setCell(rowXml: string, ref: string, build: (style: string) => string): string {
  const existing = cellRegex(ref).exec(rowXml);
  if (existing) {
    const style = attr(existing[1] ?? "", "s");
    return rowXml.replace(cellRegex(ref), build(style ? ` s="${style}"` : ""));
  }
  // Célula ausente: insere na ordem certa das colunas.
  const colNum = colToNumber(/^[A-Z]+/.exec(ref)![0]);
  const cellRe = /<c r="([A-Z]+)\d+"[^>/]*(?:\/>|>[\s\S]*?<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowXml))) {
    if (colToNumber(m[1]!) > colNum) {
      return rowXml.slice(0, m.index) + build("") + rowXml.slice(m.index);
    }
  }
  return rowXml.replace(/<\/row>$/, build("") + "</row>");
}

const textCell = (ref: string, value: string) => (style: string) =>
  `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
const numberCell = (ref: string, value: number) => (style: string) =>
  `<c r="${ref}"${style}><v>${value}</v></c>`;
const emptyCell = (ref: string) => (style: string) => `<c r="${ref}"${style}/>`;

/** Edita uma linha (r="N") do XML da planilha. */
function editRow(
  xml: string,
  rowNumber: number,
  edit: (rowXml: string) => string
): string {
  const re = new RegExp(`<row r="${rowNumber}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
  const m = re.exec(xml);
  if (!m) return xml;
  let rowXml = m[0];
  if (rowXml.endsWith("/>")) {
    rowXml = rowXml.replace(/\/>$/, "></row>");
  }
  return xml.slice(0, m.index) + edit(rowXml) + xml.slice(m.index + m[0].length);
}

/** Descobre o arquivo XML da aba "GERAL". */
async function findSheetPath(entries: ZipEntry[], sheetName: string): Promise<string> {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const wbEntry = byName.get("xl/workbook.xml");
  const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
  if (!wbEntry || !relsEntry) throw new Error("Planilha inválida (sem workbook).");
  const wb = decoder.decode(await inflateEntry(wbEntry));
  const rels = decoder.decode(await inflateEntry(relsEntry));

  const sheetTags = wb.match(/<sheet\b[^>]*\/>/g) ?? [];
  const tag = sheetTags.find((t) => xmlUnescape(attr(t, "name") ?? "") === sheetName);
  if (!tag) throw new Error(`A planilha não tem a aba "${sheetName}".`);
  const rid = attr(tag, "r:id");
  const relTags = rels.match(/<Relationship\b[^>]*\/>/g) ?? [];
  const rel = relTags.find((t) => attr(t, "Id") === rid);
  const target = rel ? attr(rel, "Target") : null;
  if (!target) throw new Error("Planilha inválida (aba sem arquivo).");
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

type ItemRow = { row: number; code: string };

/** Linhas de produto do modelo: as que têm um código numérico na coluna A. */
function listItemRows(sheetXml: string, shared: string[]): ItemRow[] {
  const rows: ItemRow[] = [];
  const rowRe = /<row r="(\d+)"[^>]*?>([\s\S]*?)<\/row>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheetXml))) {
    const rowNumber = Number(m[1]);
    if (rowNumber < FIRST_ITEM_ROW) continue;
    const a = cellRegex(`A${rowNumber}`).exec(m[2]!);
    if (!a || !a[2] || a[2].includes("<f")) continue;
    const type = attr(a[1] ?? "", "t");
    const v = /<v>([\s\S]*?)<\/v>/.exec(a[2]);
    if (!v) continue;
    const raw = type === "s" ? (shared[Number(v[1])] ?? "") : xmlUnescape(v[1]!);
    const code = normalizeCode(raw);
    if (/^\d+$/.test(code)) rows.push({ row: rowNumber, code });
  }
  return rows;
}

export type FactoryTemplateInfo = {
  itemRows: number;
  codes: string[];
};

/** Confere se o arquivo parece o modelo da fábrica e lista os códigos dele. */
export async function inspectFactoryTemplate(template: Uint8Array): Promise<FactoryTemplateInfo> {
  const entries = readZip(template);
  const sheetPath = await findSheetPath(entries, FACTORY_SHEET_NAME);
  const sheetEntry = entries.find((e) => e.name === sheetPath);
  if (!sheetEntry) throw new Error("Planilha inválida (aba GERAL ausente).");
  const sstEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = sstEntry ? parseSharedStrings(decoder.decode(await inflateEntry(sstEntry))) : [];
  const sheetXml = decoder.decode(await inflateEntry(sheetEntry));
  const rows = listItemRows(sheetXml, shared);
  if (rows.length < 10) {
    throw new Error(
      "Esta planilha não parece o modelo de pedido da fábrica (poucos produtos encontrados na aba GERAL)."
    );
  }
  if (!/<c r="O4"/.test(sheetXml) || !/<c r="I3"/.test(sheetXml)) {
    throw new Error("Esta planilha não tem as células esperadas (O4 e I3).");
  }
  return { itemRows: rows.length, codes: rows.map((r) => r.code) };
}

export async function fillFactorySheet(input: FactorySheetInput): Promise<FactorySheetResult> {
  const entries = readZip(input.template);
  const sheetPath = await findSheetPath(entries, FACTORY_SHEET_NAME);
  const sheetEntry = entries.find((e) => e.name === sheetPath)!;
  const workbookEntry = entries.find((e) => e.name === "xl/workbook.xml")!;
  const sstEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");

  const shared = sstEntry ? parseSharedStrings(decoder.decode(await inflateEntry(sstEntry))) : [];
  let xml = decoder.decode(await inflateEntry(sheetEntry));
  const itemRows = listItemRows(xml, shared);
  const rowByCode = new Map(itemRows.map((r) => [r.code, r.row]));

  // Soma quantidades se o mesmo código aparecer mais de uma vez no pedido.
  const wanted = new Map<string, { quantity: number; discountFraction: number }>();
  const missing: string[] = [];
  for (const item of input.items) {
    const code = normalizeCode(item.code);
    if (!rowByCode.has(code)) {
      if (!missing.includes(code)) missing.push(code);
      continue;
    }
    const prev = wanted.get(code);
    wanted.set(code, {
      quantity: (prev?.quantity ?? 0) + item.quantity,
      discountFraction: item.discountFraction,
    });
  }

  // Cabeçalho: razão social, UF e política comercial.
  xml = editRow(xml, 3, (row) => {
    let r = setCell(row, "B3", textCell("B3", input.customerName));
    if (input.uf) r = setCell(r, "I3", textCell("I3", input.uf));
    return r;
  });
  xml = editRow(xml, 4, (row) => setCell(row, "O4", numberCell("O4", input.policyFraction)));

  // Itens: limpa o que veio de exemplo no modelo e grava o pedido.
  for (const { row, code } of itemRows) {
    const w = wanted.get(code);
    xml = editRow(xml, row, (r) => {
      let out = setCell(r, `E${row}`, w ? numberCell(`E${row}`, w.quantity) : emptyCell(`E${row}`));
      out = setCell(
        out,
        `M${row}`,
        w && w.discountFraction > 0
          ? numberCell(`M${row}`, w.discountFraction)
          : emptyCell(`M${row}`)
      );
      if (input.taxFree) out = setCell(out, `J${row}`, numberCell(`J${row}`, 0));
      return out;
    });
  }

  // Tira os resultados antigos guardados nas fórmulas (eram do pedido de
  // exemplo); o Excel recalcula tudo ao abrir.
  xml = xml.replace(/<c\s[^>/]*>[\s\S]*?<\/c>/g, (cell) => {
    if (!cell.includes("<f")) return cell;
    return cell
      .replace(/<v>[\s\S]*?<\/v>/, "")
      .replace(/^(<c\s[^>]*?)\st="[^"]*"/, "$1");
  });

  let workbookXml = decoder.decode(await inflateEntry(workbookEntry));
  if (!/fullCalcOnLoad/.test(workbookXml)) {
    workbookXml = /<calcPr\b[^>]*\/>/.test(workbookXml)
      ? workbookXml.replace(/<calcPr\b([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
      : workbookXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  }

  const newSheet = await makeEntry(sheetEntry.name, encoder.encode(xml), sheetEntry);
  const newWorkbook = await makeEntry(workbookEntry.name, encoder.encode(workbookXml), workbookEntry);
  const out = entries.map((e) =>
    e.name === sheetEntry.name ? newSheet : e.name === workbookEntry.name ? newWorkbook : e
  );
  return { bytes: writeZip(out), missingCodes: missing };
}
