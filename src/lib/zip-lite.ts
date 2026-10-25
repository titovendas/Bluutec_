// Leitor/gravador de ZIP mínimo, sem dependências, usado para preencher a
// planilha da fábrica (.xlsx é um ZIP) SEM perder nada do arquivo original
// (proteção, listas de opções, imagens). Só mexemos nos arquivos que
// precisam; os demais são copiados exatamente como estão.
//
// Lê pelo "diretório central" do ZIP, por isso funciona também com planilhas
// que vêm de outros programas (com "data descriptor"), que o leitor do
// SheetJS recusa ("Bad compressed size").

export type ZipEntry = {
  name: string;
  method: number; // 0 = sem compressão, 8 = deflate
  crc: number;
  compressedSize: number;
  size: number;
  /** Bytes como estão no arquivo (comprimidos, se method = 8). */
  raw: Uint8Array;
  time: number;
  date: number;
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Arquivo inválido: não parece uma planilha .xlsx.");

  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new Error("Arquivo inválido: diretório do ZIP corrompido.");
    }
    const method = view.getUint16(pos + 10, true);
    const time = view.getUint16(pos + 12, true);
    const date = view.getUint16(pos + 14, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error("Arquivo inválido: cabeçalho de arquivo interno corrompido.");
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({
      name,
      method,
      crc,
      compressedSize,
      size,
      raw: bytes.subarray(dataStart, dataStart + compressedSize),
      time,
      date,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function pipeThrough(
  data: Uint8Array,
  stream: { writable: WritableStream; readable: ReadableStream }
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data as any);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    total += (value as Uint8Array).length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Conteúdo (descomprimido) de um arquivo do ZIP. */
export async function inflateEntry(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.method === 0) return entry.raw;
  if (entry.method !== 8) throw new Error(`Compressão não suportada (${entry.method}).`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador não consegue abrir planilhas. Atualize o navegador.");
  }
  return pipeThrough(entry.raw, new DecompressionStream("deflate-raw") as any);
}

/** Cria um arquivo novo para o ZIP a partir de bytes, comprimindo se o
 * navegador permitir (senão grava sem compressão — também é válido). */
export async function makeEntry(
  name: string,
  data: Uint8Array,
  like?: ZipEntry
): Promise<ZipEntry> {
  let method = 0;
  let raw = data;
  if (typeof CompressionStream !== "undefined") {
    try {
      raw = await pipeThrough(data, new CompressionStream("deflate-raw") as any);
      method = 8;
    } catch {
      raw = data;
      method = 0;
    }
  }
  return {
    name,
    method,
    crc: crc32(data),
    compressedSize: raw.length,
    size: data.length,
    raw,
    time: like?.time ?? 0,
    date: like?.date ?? 0x21,
  };
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = entries.map((e) => encoder.encode(e.name));
  let total = 22;
  entries.forEach((e, i) => {
    total += 30 + names[i]!.length + e.raw.length; // local
    total += 46 + names[i]!.length; // central
  });
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  const offsets: number[] = [];

  entries.forEach((e, i) => {
    offsets.push(pos);
    const nameBytes = names[i]!;
    const utf8 = /[^\x00-\x7f]/.test(e.name) ? 0x0800 : 0;
    view.setUint32(pos, SIG_LOCAL, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, utf8, true);
    view.setUint16(pos + 8, e.method, true);
    view.setUint16(pos + 10, e.time, true);
    view.setUint16(pos + 12, e.date, true);
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.raw.length, true);
    view.setUint32(pos + 22, e.size, true);
    view.setUint16(pos + 26, nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(nameBytes, pos + 30);
    out.set(e.raw, pos + 30 + nameBytes.length);
    pos += 30 + nameBytes.length + e.raw.length;
  });

  const centralStart = pos;
  entries.forEach((e, i) => {
    const nameBytes = names[i]!;
    const utf8 = /[^\x00-\x7f]/.test(e.name) ? 0x0800 : 0;
    view.setUint32(pos, SIG_CENTRAL, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, utf8, true);
    view.setUint16(pos + 10, e.method, true);
    view.setUint16(pos + 12, e.time, true);
    view.setUint16(pos + 14, e.date, true);
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.raw.length, true);
    view.setUint32(pos + 24, e.size, true);
    view.setUint16(pos + 28, nameBytes.length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, offsets[i]!, true);
    out.set(nameBytes, pos + 46);
    pos += 46 + nameBytes.length;
  });

  view.setUint32(pos, SIG_EOCD, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  return out;
}

/** Reescreve o ZIP com cabeçalhos "limpos". Usado só para o leitor de
 * planilhas (SheetJS) conseguir abrir arquivos vindos de outros programas. */
export function normalizeZip(bytes: Uint8Array): Uint8Array {
  return writeZip(readZip(bytes));
}

/** Prepara o conteúdo de um arquivo .xlsx para o leitor de planilhas
 * (SheetJS). Se não for um ZIP válido (ex.: .xls, .csv), devolve igual. */
export function normalizeXlsxBuffer(buffer: ArrayBuffer): ArrayBuffer | Uint8Array {
  try {
    return normalizeZip(new Uint8Array(buffer));
  } catch {
    return buffer;
  }
}
