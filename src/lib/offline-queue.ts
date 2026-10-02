import { get, set } from "idb-keyval";
import {
  listCustomers,
  listOrders,
  upsertCustomer,
  upsertOrder,
  deleteCustomer,
  deleteOrder,
} from "@/lib/sales.functions";
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
  unit_price: number;
  ipi_percent: number;
  st_percent: number;
};

export type OrderPayload = {
  customer_id: string;
  status: string;
  price_table: string;
  payment_term?: string;
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
  | { type: "create"; localId: string; payload: CustomerPayload; createdAt: string }
  | { type: "update"; id: string; payload: CustomerPayload; createdAt: string }
  | { type: "delete"; id: string; createdAt: string };

export type PendingOrderOp =
  | {
      type: "create";
      localId: string;
      payload: OrderPayload;
      customerSnapshot: CustomerPayload | null;
      sellerNameSnapshot: string | null;
      totals: OrderTotals;
      createdAt: string;
    }
  | {
      type: "update";
      id: string;
      payload: OrderPayload;
      customerSnapshot: CustomerPayload | null;
      sellerNameSnapshot: string | null;
      totals: OrderTotals;
      createdAt: string;
    }
  | { type: "delete"; id: string; createdAt: string };

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

export async function queueOrder(
  payload: OrderPayload,
  customerSnapshot: CustomerPayload | null
) {
  const pending = await getPendingOrderOps();
  const sellerNameSnapshot = await getDefaultSellerNameOffline();
  const record: PendingOrderOp = {
    type: "create",
    localId: genLocalId("local-order"),
    payload,
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
    price_table: op.payload.price_table,
    payment_term: op.payload.payment_term,
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
  failed: number;
  errors: string[];
}> {
  if (!isOnlineNow()) {
    return { syncedCustomers: 0, syncedOrders: 0, failed: 0, errors: [] };
  }

  let syncedCustomers = 0;
  let syncedOrders = 0;
  let failed = 0;
  const errors: string[] = [];

  const idMap = new Map<string, string>();
  const pendingCustomerOps = await getPendingCustomerOps();

  for (const op of pendingCustomerOps) {
    try {
      if (op.type === "create") {
        const result = await upsertCustomer({ data: op.payload });
        if (result?.id) {
          idMap.set(op.localId, result.id);
          // Grava o id real já nos pedidos pendentes que apontam pra esse
          // cliente local, para não ficarem órfãos caso falhem agora e só
          // sejam tentados de novo numa sincronização futura (quando esse
          // mapeamento em memória já não existiria mais).
          await remapCustomerIdInPendingOrders(op.localId, result.id);
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
      errors.push(err?.message || "Erro ao sincronizar cliente");
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
          errors.push(
            `Pedido de "${op.customerSnapshot?.name ?? "cliente"}" aguardando o cliente sincronizar primeiro.`
          );
          continue;
        }
        customerId = realId;
      }

      if (op.type === "create") {
        await upsertOrder({ data: { ...op.payload, customer_id: customerId } });
      } else {
        await upsertOrder({
          data: { ...op.payload, customer_id: customerId, id: op.id },
        });
      }
      await removeOrderOp(op);
      syncedOrders++;
    } catch (err: any) {
      failed++;
      errors.push(err?.message || "Erro ao sincronizar pedido");
    }
  }

  if (syncedCustomers > 0) {
    syncCustomers().catch(() => {});
  }

  return { syncedCustomers, syncedOrders, failed, errors };
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

async function removeCustomerOp(target: PendingCustomerOp) {
  const pending = await getPendingCustomerOps();
  await set(
    PENDING_CUSTOMERS_KEY,
    pending.filter((op) => op !== target)
  );
}

async function removeOrderOp(target: PendingOrderOp) {
  const pending = await getPendingOrderOps();
  await set(
    PENDING_ORDERS_KEY,
    pending.filter((op) => op !== target)
  );
}
