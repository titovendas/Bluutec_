import { get, set, del } from "idb-keyval";
import {
  listCatalog,
  listCatalogAll,
  getCatalogProductsByIds,
} from "@/lib/sales.functions";

const CATALOG_KEY = "fv:catalog:v1";
const SYNCED_AT_KEY = "fv:catalog:syncedAt";

export type CatalogItem = {
  id: string;
  code: string;
  ref: string | null;
  description: string;
  barcode: string | null;
  ncm: string | null;
  category: string | null;
  image_url: string | null;
  ipi_percent: number;
  st_percent: number;
  price_atacado: number | null;
  price_varejo_10: number | null;
  price_varejo_75: number | null;
  active: boolean;
};

let syncInFlight: Promise<CatalogItem[]> | null = null;

/** Baixa o catálogo completo do servidor e grava no dispositivo. */
export async function syncCatalog(): Promise<CatalogItem[]> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const rows = (await listCatalogAll()) as CatalogItem[];
    await set(CATALOG_KEY, rows);
    await set(SYNCED_AT_KEY, new Date().toISOString());
    return rows;
  })();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

/** Sincroniza em segundo plano, sem travar a tela, se estiver online. */
export function syncCatalogInBackground() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  syncCatalog().catch(() => {
    /* sem internet ou erro momentâneo: mantém a cópia local existente */
  });
}

export async function getCatalogSyncedAt(): Promise<string | null> {
  return (await get(SYNCED_AT_KEY)) ?? null;
}

const IMAGE_CACHE_NAME = "fv-images-v1";

/**
 * Baixa as fotos de todos os produtos do catálogo local e guarda no mesmo
 * "cofre" de imagens que o service worker usa, para ficarem disponíveis
 * offline mesmo sem o vendedor ter visto o produto antes. Roda aos poucos
 * (em lotes), e chama onProgress a cada lote para atualizar algum
 * indicador na tela, se quiser.
 */
export async function prefetchAllProductImages(
  onProgress?: (done: number, total: number) => void
): Promise<{ downloaded: number; total: number }> {
  if (typeof caches === "undefined") return { downloaded: 0, total: 0 };

  const items = (await get<CatalogItem[]>(CATALOG_KEY)) ?? [];
  const urls = Array.from(
    new Set(items.map((i) => i.image_url).filter((u): u is string => !!u))
  );
  if (urls.length === 0) return { downloaded: 0, total: 0 };

  const cache = await caches.open(IMAGE_CACHE_NAME);
  const BATCH_SIZE = 8;
  let done = 0;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) break;
    const batch = urls.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (url) => {
        try {
          const existing = await cache.match(url);
          if (!existing) {
            const res = await fetch(url);
            if (res.ok) await cache.put(url, res.clone());
          }
        } catch {
          /* imagem específica falhou — segue para as próximas */
        } finally {
          done++;
        }
      })
    );
    onProgress?.(done, urls.length);
  }

  return { downloaded: done, total: urls.length };
}

export async function getOfflineCatalogCount(): Promise<number> {
  const rows = (await get<CatalogItem[]>(CATALOG_KEY)) ?? [];
  return rows.length;
}

export async function clearOfflineCatalog() {
  await del(CATALOG_KEY);
  await del(SYNCED_AT_KEY);
}

function matchesSearch(item: CatalogItem, term: string) {
  const t = term.toLowerCase();
  return (
    item.code?.toLowerCase().includes(t) ||
    item.ref?.toLowerCase().includes(t) ||
    item.description?.toLowerCase().includes(t) ||
    item.barcode?.toLowerCase().includes(t)
  );
}

/**
 * Prioriza quem bate exatamente com o termo digitado (mesmo critério usado
 * na busca online), em vez de só filtrar mantendo a ordem alfabética.
 */
function sortByRelevance(items: CatalogItem[], term: string) {
  const t = term.trim().toLowerCase();
  const score = (item: CatalogItem) => {
    const code = (item.code ?? "").toLowerCase();
    const ref = (item.ref ?? "").toLowerCase();
    const description = (item.description ?? "").toLowerCase();
    const barcode = (item.barcode ?? "").toLowerCase();
    if (code === t || barcode === t) return 0;
    if (code.startsWith(t)) return 1;
    if (ref === t) return 2;
    if (ref.startsWith(t)) return 3;
    if (code.includes(t) || barcode.includes(t)) return 4;
    if (ref.includes(t)) return 5;
    if (description.startsWith(t)) return 6;
    return 7;
  };
  return [...items].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return (a.code ?? "").localeCompare(b.code ?? "");
  });
}

/**
 * Busca produtos no catálogo. Tenta o servidor primeiro (dados sempre
 * atualizados); se estiver offline ou a chamada falhar, cai para a cópia
 * local salva no aparelho. Também mantém a cópia local sempre em dia
 * quando a busca acontece com internet.
 */
export async function searchCatalog(search: string): Promise<{
  items: CatalogItem[];
  fromCache: boolean;
}> {
  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  if (isOnline) {
    try {
      const rows = (await listCatalog({ data: { search } })) as CatalogItem[];
      return { items: rows, fromCache: false };
    } catch {
      // segue para o fallback local abaixo
    }
  }

  const cached = (await get<CatalogItem[]>(CATALOG_KEY)) ?? [];
  const term = search.trim();
  const filtered = term
    ? sortByRelevance(cached.filter((item) => matchesSearch(item, term)), term)
    : cached.slice(0, 60);
  return { items: filtered, fromCache: true };
}

/**
 * Busca os dados completos do catálogo (preços das 3 tabelas, IPI, ST)
 * para uma lista de ids de produto. Tenta o servidor; se offline ou a
 * chamada falhar, usa a cópia local do catálogo salva no aparelho.
 */
export async function getCatalogProductsByIdsOfflineAware(
  ids: string[]
): Promise<Map<string, CatalogItem>> {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  const map = new Map<string, CatalogItem>();
  if (uniqueIds.length === 0) return map;

  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  if (isOnline) {
    try {
      const rows = (await getCatalogProductsByIds({
        data: { ids: uniqueIds },
      })) as CatalogItem[];
      rows.forEach((row) => map.set(row.id, row));
      if (map.size === uniqueIds.length) return map;
    } catch {
      // segue para o fallback local abaixo
    }
  }

  const cached = (await get<CatalogItem[]>(CATALOG_KEY)) ?? [];
  for (const item of cached) {
    if (uniqueIds.includes(item.id) && !map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return map;
}
