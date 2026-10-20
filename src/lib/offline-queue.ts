import { get, set } from "idb-keyval";
import { resolveOrderPriceTable } from "@/lib/price-tables";
import {
  listCustomers,
  listOrders,
  upsertCustomer,
  upsertOrder,
  deleteCustomer,
  deleteOrder,
  findLegacyDuplicateOrder,
} from "@/lib/sales.functions";
import { formatCurrency } from "@/lib/sales-formatters";
import {
  getOfflineCustomers,
  syncCustomers,
  getDefaultSellerNameOffline,
} from "@/lib/offline-customers";

const PENDING_CUSTOMERS_KEY = "fv:pending:customers:v2";
const PENDING_ORDERS_KEY = "fv:pending:orders:v2";

export type OrderItemPayload = {
  catalog_product_id: string;
  code: string;
  description: string;
  image_url: string | null;
  quantity: number;
  table_price: number;
  discount_percent: number;
  unit_price: number;
  ipi_percent: number;
  st_percent: number;
};

export type OrderPayload = {
  customer_id: string;
  status: string;
  price_table: string;
  payment_term?: string;
  cash_discount_percent?: number;
  pickup_discount_percent?: number;
  notes?: string;
  items: OrderItemPayload[];
};

export type CustomerPayload = {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  document?: string;
  address?: string;
  neighborhood?: string;
  zip_code?: string;
  city?: string;
  state?: string;
};

type OrderTotals = {
  subtotal: number;
  ipi_total: number;
  st_total: number;
  total: number;
};

export type PendingCustomerOp =
  | { type: "create"; localId: string; payload: CustomerPayload; createdAt: string; lastError?: string }
  | { type: "update"; id: string; payload: CustomerPayload; createdAt: string; lastError?: string }
  | { type: "delete"; id: string; createdAt: string; lastError?: string };

export type PendingOrderOp =
  | {
      type: "create";
      localId: string;
      /** Identificador enviado ao servidor pra não duplicar o pedido num reenvio.
       * Pedidos guardados por versões antigas não têm. */
      clientRef?: string;
      payload: OrderPayload;
      customerSnapshot: CustomerPayload | null;
      sellerNameSnapshot: string | null;
      totals: OrderTotals;
      createdAt: string;
      lastError?: string;
    }
  | {
      type: "update";
      id: string;
      payload: OrderPayload;
      customerSnapshot: CustomerPayload | null;
      sellerNameSnapshot: string | null;
      totals: OrderTotals;
      createdAt: string;
      lastError?: string;
    }
  | { type: "delete"; id: string; createdAt: string; lastError?: string };

function genLocalId(prefix: string) {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

function isOnlineNow() {
  return typeof navigator === "undefined" || navigator.onLine;
}

async function getPendingCustomerOps(): Promise<PendingCustomerOp[]> {
  return (await get<PendingCustomerOp[]>(PENDING_CUSTOMERS_KEY)) ?? [];
}

async function getPendingOrderOps(): Promise<PendingOrderOp[]> {
  return (await get<PendingOrderOp[]>(PENDING_ORDERS_KEY)) ?? [];
}

export function computeOrderTotals(items: OrderItemPayload[]): OrderTotals {
  let subtotal = 0;
  let ipi_total = 0;
  let st_total = 0;
  for (const item of items) {
    const base = item.quantity * item.unit_price;
    subtotal += base;
    ipi_total += (base * (item.ipi_percent || 0)) / 100;
    st_total += (base * (item.st_percent || 0)) / 100;
  }
  return {
    subtotal,
    ipi_total,
    st_total,
    total: subtotal + ipi_total + st_total,
  };
}

// ---------- Clientes ----------

/** Cria um cliente novo offline (ainda sem id real no servidor). */
export async function queueCustomer(payload: CustomerPayload) {
  const pending = await getPendingCustomerOps();
  const record: PendingCustomerOp = {
    type: "create",
    localId: genLocalId("local-cust"),
    payload,
    createdAt: new Date().toISOString(),
  };
  await set(PENDING_CUSTOMERS_KEY, [...pending, record]);
  return record;
}

/**
 * Atualiza um cliente offline. Se `id` for de um cliente ainda não
 * sincronizado (prefixo local-cust-), substitui os dados da própria
 * criação pendente. Se for um cliente já existente no servidor, guarda uma
 * edição pendente para enviar quando a internet voltar.
 */
export async function queueCustomerUpsert(
  id: string,
  payload: CustomerPayload
) {
  const pending = await getPendingCustomerOps();

  if (id.startsWith("local-cust-")) {
    const next = pending.map((op): PendingCustomerOp =>
      op.type === "create" && op.localId === id
        ? { ...op, payload }
        : op
    );
    await set(PENDING_CUSTOMERS_KEY, next);
    return;
  }

  const withoutPreviousUpdate = pending.filter(
    (op) => !(op.type === "update" && op.id === id)
  );
  const record: PendingCustomerOp = {
    type: "update",
    id,
    payload,
    createdAt: new Date().toISOString(),
  };
  await set(PENDING_CUSTOMERS_KEY, [...withoutPreviousUpdate, record]);
}

/**
 * Remove um cliente. Se ele nunca chegou a ser sincronizado, simplesmente
 * cancela a criação pendente. Se já existe no servidor, guarda a exclusão
 * para quando a internet voltar.
 */
export async function queueCustomerDelete(id: string) {
  const pending = await getPendingCustomerOps();

  if (id.startsWith("local-cust-")) {
    await set(
      PENDING_CUSTOMERS_KEY,
      pending.filter((op) => !(op.type === "create" && op.localId === id))
    );
    return;
  }

  const withoutPreviousOps = pending.filter(
    (op) =>
      !((op.type === "update" || op.type === "delete") && op.id === id)
  );
  const record: PendingCustomerOp = {
    type: "delete",
    id,
    createdAt: new Date().toISOString(),
  };
  await set(PENDING_CUSTOMERS_KEY, [...withoutPreviousOps, record]);
}

// ---------- Pedidos ----------

/**
 * Garante que a política comercial do pedido seja válida antes de gravar
 * no aparelho ou enviar ao servidor. Se estiver em branco/inválida (pedidos
 * de versões antigas), deduz pelos preços dos itens; sem como deduzir,
 * mantém o valor como está (o servidor então usa "varejo", sem travar).
 */
function withValidPriceTable(payload: OrderPayload): OrderPayload {
  const resolved = resolveOrderPriceTable(
    payload.price_table,
    payload.items ?? [],
    payload.cash_discount_percent ?? 0,
    payload.pickup_discount_percent ?? 0
  );
  return resolved && resolved !== payload.price_table
    ? { ...payload, price_table: resolved }
    : payload;
}

export async function queueOrder(
  payload: OrderPayload,
  customerSnapshot: CustomerPayload | null
) {
  const pending = await getPendingOrderOps();
  const sellerNameSnapshot = await getDefaultSellerNameOffline();
  const localId = genLocalId("local-order");
  const record: PendingOrderOp = {
    type: "create",
    localId,
    clientRef: localId,
    payload: withValidPriceTable(payload),
    customerSnapshot,
    sellerNameSnapshot,
    totals: computeOrderTotals(payload.items ?? []),
    createdAt: new Date().toISOString(),
  };
  await set(PENDING_ORDERS_KEY, [...pending, record]);
  return record;
}

export async function queueOrderUpsert(
  id: string,
  payload: OrderPayload,
  customerSnapshot: CustomerPayload | null
) {
  const pending = await getPendingOrderOps();
  const sellerNameSnapshot = await getDefaultSellerNameOffline();
  payload = withValidPriceTable(payload);
  const totals = computeOrderTotals(payload.items ?? []);

  if (id.startsWith("local-order-")) {
    const next = pending.map((op): PendingOrderOp =>
      op.type === "create" && op.localId === id
        ? {
            ...op,
            payload,
            customerSnapshot: customerSnapshot ?? op.customerSnapshot,
            totals,
          }
        : op
    );
    await set(PENDING_ORDERS_KEY, next);
    return;
  }

  const withoutPreviousUpdate = pending.filter(
    (op) => !(op.type === "update" && op.id === id)
  );
  const record: PendingOrderOp = {
    type: "update",
    id,
    payload,
    customerSnapshot,
    sellerNameSnapshot,
    totals,
    createdAt: new Date().toISOString(),
  };
  await set(PENDING_ORDERS_KEY, [...withoutPreviousUpdate, record]);
}

export async function queueOrderDelete(id: string) {
  const pending = await getPendingOrderOps();

  if (id.startsWith("local-order-")) {
    await set(
      PENDING_ORDERS_KEY,
      pending.filter((op) => !(op.type === "create" && op.localId === id))
    );
    return;
  }

  const withoutPreviousOps = pending.filter(
    (op) =>
      !((op.type === "update" || op.type === "delete") && op.id === id)
  );
  const record: PendingOrderOp = {
    type: "delete",
    id,
    createdAt: new Date().toISOString(),
  };
  await set(PENDING_ORDERS_KEY, [...withoutPreviousOps, record]);
}

// ---------- Leitura para exibição/edição ----------

/**
 * Monta um pedido (com itens) para exibição/edição/PDF quando há uma
 * versão local (pendente) dele — seja recém-criado offline, seja uma
 * edição offline de um pedido que já existia no servidor. Retorna `null`
 * quando não há nada pendente para esse id, e quem chamou deve buscar no
 * servidor normalmente.
 */
export async function getOrderForDisplay(id: string) {
  const pending = await getPendingOrderOps();
  const op = pending.find(
    (o) =>
      (o.type === "create" && o.localId === id) ||
      (o.type === "update" && o.id === id)
  ) as Extract<PendingOrderOp, { type: "create" | "update" }> | undefined;

  if (!op) return null;

  const order = {
    id,
    created_at: op.createdAt,
    customer_id: op.payload.customer_id,
    customer_name: op.customerSnapshot?.name ?? "—",
    customer: op.customerSnapshot,
    seller_name: op.sellerNameSnapshot,
    status: op.payload.status,
    price_table: withValidPriceTable(op.payload).price_table,
    payment_term: op.payload.payment_term,
    cash_discount_percent: op.payload.cash_discount_percent ?? 0,
    pickup_discount_percent: op.payload.pickup_discount_percent ?? 0,
    notes: op.payload.notes ?? "",
    subtotal: op.totals.subtotal,
    ipi_total: op.totals.ipi_total,
    st_total: op.totals.st_total,
    total: op.totals.total,
    __pending: true,
  };

  const items = (op.payload.items ?? []).map(
    (item: OrderItemPayload, index: number) => {
      const base = item.quantity * item.unit_price;
      const ipi_value = (base * (item.ipi_percent || 0)) / 100;
      const st_value = (base * (item.st_percent || 0)) / 100;
      return {
        id: `${id}-item-${index}`,
        catalog_product_id: item.catalog_product_id,
        code: item.code,
        description: item.description,
        image_url: item.image_url ?? null,
        quantity: item.quantity,
        table_price: item.table_price,
        discount_percent: item.discount_percent,
        unit_price: item.unit_price,
        ipi_percent: item.ipi_percent,
        st_percent: item.st_percent,
        ipi_value,
        st_value,
        total: base + ipi_value + st_value,
      };
    }
  );

  return { order, items };
}

export async function pendingCount() {
  const [customers, orders] = await Promise.all([
    getPendingCustomerOps(),
    getPendingOrderOps(),
  ]);
  return customers.length + orders.length;
}

/**
 * Lista de clientes pronta para exibir/usar offline: tenta o servidor,
 * cai para a cópia local se falhar. Aplica por cima as edições/exclusões
 * pendentes e inclui os clientes criados offline.
 */
export async function listCustomersMerged(): Promise<any[]> {
  let base: any[] = [];
  if (isOnlineNow()) {
    try {
      base = await listCustomers();
    } catch {
      base = await getOfflineCustomers();
    }
  } else {
    base = await getOfflineCustomers();
  }

  const pending = await getPendingCustomerOps();
  const deletedIds = new Set(
    pending.filter((op) => op.type === "delete").map((op) => op.id)
  );
  const updates = new Map(
    pending
      .filter((op) => op.type === "update")
      .map((op) => [op.id, op.payload])
  );
  const creates = pending.filter((op) => op.type === "create");

  const merged = base
    .filter((c) => !deletedIds.has(c.id))
    .map((c) =>
      updates.has(c.id)
        ? { ...c, ...updates.get(c.id), id: c.id, __pending: true }
        : c
    );

  const createdAsCustomers = creates.map((op) =>
    op.type === "create"
      ? { id: op.localId, ...op.payload, __pending: true }
      : op
  );

  return [...createdAsCustomers, ...merged];
}

/**
 * Lista de pedidos pronta para exibir offline: pedidos do servidor (quando
 * online) com as edições/exclusões pendentes aplicadas por cima, mais os
 * pedidos criados offline.
 */
export async function listOrdersMerged(): Promise<any[]> {
  let base: any[] = [];
  if (isOnlineNow()) {
    try {
      base = await listOrders();
    } catch {
      base = [];
    }
  }

  const pending = await getPendingOrderOps();
  const deletedIds = new Set(
    pending.filter((op) => op.type === "delete").map((op) => op.id)
  );
  const updates = new Map(
    pending.filter((op) => op.type === "update").map((op) => [op.id, op])
  );
  const creates = pending.filter((op) => op.type === "create");

  const merged = base
    .filter((o) => !deletedIds.has(o.id))
    .map((o) => {
      const update = updates.get(o.id);
      if (!update || update.type !== "update") return o;
      return {
        ...o,
        customer_name: update.customerSnapshot?.name ?? o.customer_name,
        status: update.payload.status,
        payment_term: update.payload.payment_term,
        total: update.totals.total,
        __pending: true,
      };
    });

  const createdAsOrders = creates.map((op) =>
    op.type === "create"
      ? {
          id: op.localId,
          created_at: op.createdAt,
          customer_name: op.customerSnapshot?.name ?? "—",
          seller_name: op.sellerNameSnapshot,
          status: op.payload.status,
          payment_term: op.payload.payment_term,
          total: op.totals.total,
          __pending: true,
        }
      : op
  );

  return [...createdAsOrders, ...merged];
}

// ---------- Sincronização ----------

/**
 * Envia tudo que foi feito offline para o servidor: clientes primeiro
 * (criações, edições e exclusões, nessa ordem), depois pedidos, remapeando
 * o cliente local para o id real quando necessário. Itens que falharem
 * continuam na fila para a próxima tentativa.
 */
export async function syncPendingData(): Promise<{
  syncedCustomers: number;
  syncedOrders: number;
  alreadyOnServer: number;
  staleSkipped: number;
  failed: number;
  errors: string[];
}> {
  if (!isOnlineNow()) {
    return { syncedCustomers: 0, syncedOrders: 0, alreadyOnServer: 0, staleSkipped: 0, failed: 0, errors: [] };
  }

  let syncedCustomers = 0;
  let syncedOrders = 0;
  let alreadyOnServer = 0;
  let staleSkipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const idMap = new Map<string, string>();
  const pendingCustomerOps = await getPendingCustomerOps();
  let serverCustomers: any[] | null = null;

  for (const op of pendingCustomerOps) {
    try {
      if (op.type === "create") {
        // Se já existe no servidor um cliente com o mesmo CNPJ (por ex. numa
        // tentativa anterior que chegou lá), usa esse em vez de duplicar.
        let realId: string | undefined;
        if (op.payload.document) {
          if (serverCustomers === null) {
            serverCustomers = await listCustomers().catch(() => []);
          }
          realId = serverCustomers.find(
            (c: any) => c.document && c.document === op.payload.document
          )?.id as string | undefined;
        }
        if (!realId) {
          const result = await upsertCustomer({ data: op.payload });
          realId = result?.id;
          if (realId && serverCustomers) {
            serverCustomers.push({ id: realId, document: op.payload.document });
          }
        }
        if (realId) {
          idMap.set(op.localId, realId);
          // Grava o id real já nos pedidos pendentes que apontam pra esse
          // cliente local, para não ficarem órfãos caso falhem agora e só
          // sejam tentados de novo numa sincronização futura (quando esse
          // mapeamento em memória já não existiria mais).
          await remapCustomerIdInPendingOrders(op.localId, realId);
        }
        await removeCustomerOp(op);
        syncedCustomers++;
      } else if (op.type === "update") {
        await upsertCustomer({ data: { ...op.payload, id: op.id } });
        await removeCustomerOp(op);
        syncedCustomers++;
      } else {
        await deleteCustomer({ data: { id: op.id } });
        await removeCustomerOp(op);
        syncedCustomers++;
      }
    } catch (err: any) {
      failed++;
      const message = err?.message || "Erro ao sincronizar cliente";
      errors.push(message);
      await setCustomerOpError(op, message).catch(() => {});
    }
  }

  const pendingOrderOps = await getPendingOrderOps();
  let allCustomersCache: any[] | null = null;

  for (const op of pendingOrderOps) {
    try {
      if (op.type === "delete") {
        await deleteOrder({ data: { id: op.id } });
        await removeOrderOp(op);
        syncedOrders++;
        continue;
      }

      let customerId = op.payload.customer_id;
      if (customerId?.startsWith("local-cust-")) {
        let realId = idMap.get(customerId);

        // Cliente local que não estava (mais) na fila desta vez — provável
        // caso de já ter sincronizado numa tentativa anterior, deixando
        // esse pedido "órfão". Tenta recuperar procurando o cliente já
        // sincronizado pelo CNPJ ou nome salvos no momento da criação.
        if (!realId && op.customerSnapshot) {
          if (allCustomersCache === null) {
            allCustomersCache = await listCustomers().catch(() => []);
          }
          const snapshot = op.customerSnapshot;
          const match = allCustomersCache.find((c: any) =>
            snapshot.document
              ? c.document && c.document === snapshot.document
              : c.name === snapshot.name
          );
          if (match?.id) {
            realId = match.id as string;
            idMap.set(customerId, realId);
          }
        }

        if (!realId) {
          failed++;
          const message = `Aguardando o cliente "${op.customerSnapshot?.name ?? ""}" sincronizar primeiro.`;
          errors.push(`Pedido de "${op.customerSnapshot?.name ?? "cliente"}" aguardando o cliente sincronizar primeiro.`);
          await setOrderOpError(op, message).catch(() => {});
          continue;
        }
        customerId = realId;
      }

      // Pedidos guardados por versões antigas podem ter a política em
      // branco: corrige antes de enviar, pra não ficar preso na fila.
      const payload = withValidPriceTable(op.payload);
      if (op.type === "create") {
        if (!op.clientRef) {
          // Pedido guardado por versão antiga (sem identificador): como a
          // fila reenviava itens já sincronizados, confere se ele já está
          // no servidor antes de criar outro igual.
          const dup = await findLegacyDuplicateOrder({
            data: {
              customer_id: customerId,
              total: op.totals.total,
              createdAt: op.createdAt,
            },
          }).catch(() => ({ found: false }));
          if (dup.found) {
            await removeOrderOp(op);
            alreadyOnServer++;
            continue;
          }
        }
        await upsertOrder({
          data: {
            ...payload,
            customer_id: customerId,
            client_ref: op.clientRef ?? op.localId,
          },
        });
      } else {
        const res = await upsertOrder({
          data: { ...payload, customer_id: customerId, id: op.id, base_time: op.createdAt },
        });
        if (res?.skipped) {
          // O pedido já foi alterado no servidor depois dessa edição: a do
          // aparelho é antiga e é descartada (não sobrescreve o mais novo).
          await removeOrderOp(op);
          staleSkipped++;
          continue;
        }
      }
      await removeOrderOp(op);
      syncedOrders++;
    } catch (err: any) {
      failed++;
      const message = err?.message || "Erro ao sincronizar pedido";
      errors.push(message);
      await setOrderOpError(op, message).catch(() => {});
    }
  }

  if (syncedCustomers > 0) {
    syncCustomers().catch(() => {});
  }

  return { syncedCustomers, syncedOrders, alreadyOnServer, staleSkipped, failed, errors };
}

async function remapCustomerIdInPendingOrders(localId: string, realId: string) {
  const pending = await getPendingOrderOps();
  const next = pending.map((op): PendingOrderOp => {
    if (op.type === "delete") return op;
    if (op.payload.customer_id !== localId) return op;
    return { ...op, payload: { ...op.payload, customer_id: realId } };
  });
  await set(PENDING_ORDERS_KEY, next);
}

// Chave estável de cada item da fila. A remoção NÃO pode comparar os objetos
// em memória: o que se lê do armazenamento do navegador é sempre uma cópia
// nova, então a comparação nunca dava igual e o item nunca saía da fila —
// ficava "aguardando sincronização" para sempre e era reenviado a cada
// sincronização (podendo duplicar pedidos e clientes).
function customerOpKey(op: PendingCustomerOp) {
  return op.type === "create" ? `create:${op.localId}` : `${op.type}:${op.id}`;
}
function orderOpKey(op: PendingOrderOp) {
  return op.type === "create" ? `create:${op.localId}` : `${op.type}:${op.id}`;
}

async function removeCustomerOp(target: PendingCustomerOp) {
  const key = customerOpKey(target);
  const pending = await getPendingCustomerOps();
  await set(
    PENDING_CUSTOMERS_KEY,
    pending.filter((op) => customerOpKey(op) !== key)
  );
}

async function removeOrderOp(target: PendingOrderOp) {
  const key = orderOpKey(target);
  const pending = await getPendingOrderOps();
  await set(
    PENDING_ORDERS_KEY,
    pending.filter((op) => orderOpKey(op) !== key)
  );
}

async function setCustomerOpError(target: PendingCustomerOp, message: string) {
  const key = customerOpKey(target);
  const pending = await getPendingCustomerOps();
  await set(
    PENDING_CUSTOMERS_KEY,
    pending.map((op): PendingCustomerOp => (customerOpKey(op) === key ? { ...op, lastError: message } : op))
  );
}

async function setOrderOpError(target: PendingOrderOp, message: string) {
  const key = orderOpKey(target);
  const pending = await getPendingOrderOps();
  await set(
    PENDING_ORDERS_KEY,
    pending.map((op): PendingOrderOp => (orderOpKey(op) === key ? { ...op, lastError: message } : op))
  );
}

/** Remove da fila as edições pendentes de um pedido (usado quando a edição
 * foi salva direto no servidor — senão a versão antiga presa na fila
 * continuaria aparecendo no lugar da nova). */
export async function clearPendingOrderOpsFor(id: string) {
  const pending = await getPendingOrderOps();
  await set(
    PENDING_ORDERS_KEY,
    pending.filter((op) => !(op.type === "update" && op.id === id))
  );
}

export type PendingItemInfo = {
  key: string;
  kind: "pedido" | "cliente";
  action: "criar" | "editar" | "excluir";
  title: string;
  detail: string;
  createdAt: string;
  error: string | null;
};

/** O que está aguardando sincronização, com o último erro de cada item. */
export async function listPendingItems(): Promise<PendingItemInfo[]> {
  const customers = await getPendingCustomerOps();
  const orders = await getPendingOrderOps();
  const actionOf = (t: string): PendingItemInfo["action"] =>
    t === "create" ? "criar" : t === "update" ? "editar" : "excluir";

  const items: PendingItemInfo[] = [];
  for (const op of customers) {
    items.push({
      key: `cliente|${customerOpKey(op)}`,
      kind: "cliente",
      action: actionOf(op.type),
      title: op.type === "delete" ? "Cliente" : op.payload.name || "Cliente",
      detail: op.type === "delete" ? `Exclusão do cliente ${op.id.slice(0, 8)}` : op.payload.document ?? "",
      createdAt: op.createdAt,
      error: op.lastError ?? null,
    });
  }
  for (const op of orders) {
    if (op.type === "delete") {
      items.push({
        key: `pedido|${orderOpKey(op)}`,
        kind: "pedido",
        action: "excluir",
        title: "Pedido",
        detail: `Exclusão do pedido ${op.id.slice(0, 8)}`,
        createdAt: op.createdAt,
        error: op.lastError ?? null,
      });
      continue;
    }
    items.push({
      key: `pedido|${orderOpKey(op)}`,
      kind: "pedido",
      action: actionOf(op.type),
      title: op.customerSnapshot?.name || "Pedido",
      detail: `${op.payload.items?.length ?? 0} item(ns) · ${formatCurrency(op.totals.total)}`,
      createdAt: op.createdAt,
      error: op.lastError ?? null,
    });
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Tira um item da fila SEM enviá-lo (o que foi feito no aparelho se perde). */
export async function discardPendingItem(key: string) {
  const [kind, opKey] = key.split("|");
  if (kind === "cliente") {
    const pending = await getPendingCustomerOps();
    await set(PENDING_CUSTOMERS_KEY, pending.filter((op) => customerOpKey(op) !== opKey));
  } else {
    const pending = await getPendingOrderOps();
    await set(PENDING_ORDERS_KEY, pending.filter((op) => orderOpKey(op) !== opKey));
  }
}
