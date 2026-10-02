import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const orderStatusSchema = z.enum(["orcamento", "pedido"]);

export const priceTableSchema = z.enum(["atacado", "varejo_10", "varejo_75"]);

// Optional UUID that also accepts an empty string (sent by forms when
// creating a new record) and normalizes it to undefined.
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
    message: "Invalid uuid",
  });

// Lista usada apenas como sugestão inicial (tela de Configurações) e como
// reserva quando ainda não há nada cadastrado nem em cache offline.
export const DEFAULT_PAYMENT_TERMS = [
  "À vista",
  "30 dias",
  "30/60 dias",
  "30/60/90 dias",
  "45 dias",
  "60 dias",
] as const;

const paymentTermSchema = z.object({
  id: optionalId,
  label: z.string().min(1),
  active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});

export const listPaymentTerms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("payment_terms")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Importa uma lista de prazos de pagamento de uma vez (usado pela tela de
 * Configurações após o usuário escolher a coluna da planilha). Prazos com
 * o mesmo nome já existentes são apenas atualizados, não duplicados.
 */
export const importPaymentTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ labels: z.array(z.string().min(1)) }).parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const uniqueLabels = Array.from(
      new Set(data.labels.map((l) => l.trim()).filter(Boolean))
    );
    if (uniqueLabels.length === 0) {
      throw new Error("Nenhum prazo de pagamento válido encontrado na coluna selecionada.");
    }
    const rows = uniqueLabels.map((label, index) => ({
      user_id: userId,
      label,
      active: true,
      sort_order: index,
    }));
    const { error } = await supabase
      .from("payment_terms")
      .upsert(rows, { onConflict: "user_id,label" });
    if (error) throw new Error(error.message);
    return { imported: rows.length };
  });

export const deletePaymentTerm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("payment_terms")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

/** Remove todos os prazos de pagamento do usuário (usado antes de uma
 * reimportação, quando o usuário escolhe "substituir tudo"). */
export const clearPaymentTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("payment_terms")
      .delete()
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

const customerSchema = z.object({
  id: optionalId,
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  document: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  neighborhood: z.string().optional().or(z.literal("")),
  zip_code: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
});

const productSchema = z.object({
  id: optionalId,
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  sku: z.string().optional().or(z.literal("")),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0).default(0),
  stock: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

const sellerSchema = z.object({
  id: optionalId,
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  active: z.boolean().default(true),
});

const orderItemSchema = z.object({
  catalog_product_id: z.string().uuid(),
  code: z.string(),
  description: z.string(),
  image_url: z.string().nullable().optional(),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number().min(0),
  ipi_percent: z.coerce.number().min(0).default(0),
  st_percent: z.coerce.number().min(0).default(0),
});

const orderSchema = z.object({
  id: optionalId,
  customer_id: z.string().uuid(),
  seller_id: optionalId,
  status: orderStatusSchema.default("orcamento"),
  price_table: priceTableSchema.default("varejo_10"),
  payment_term: z.string().optional().or(z.literal("")),
  items: z.array(orderItemSchema).min(1),
});

// Dashboard stats
export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { count: customersCount } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: productsCount } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: sellersCount } = await supabase
      .from("sellers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: ordersCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { data: recentOrders } = await supabase
      .from("order_summary")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);

    return {
      customersCount: customersCount ?? 0,
      productsCount: productsCount ?? 0,
      sellersCount: sellersCount ?? 0,
      ordersCount: ordersCount ?? 0,
      recentOrders: recentOrders ?? [],
    };
  });

// Customers
export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => customerSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      document: data.document || null,
      address: data.address || null,
      neighborhood: data.neighborhood || null,
      zip_code: data.zip_code || null,
      city: data.city || null,
      state: data.state || null,
    };

    if (data.id) {
      const { data: result, error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    }

    const { data: result, error } = await supabase
      .from("customers")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

async function fetchFromBrasilApi(digits: string) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    headers: {
      "User-Agent": "ForcaDeVendas/1.0 (+https://friendly-sales-win.lovable.app)",
      Accept: "application/json",
    },
  });
  if (res.status === 404) {
    throw new Error("NOT_FOUND");
  }
  if (!res.ok) {
    throw new Error(`BRASILAPI_HTTP_${res.status}`);
  }
  const info: any = await res.json();
  const street = [
    info.descricao_tipo_de_logradouro,
    info.logradouro,
    info.numero,
    info.complemento,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const phone = info.ddd_telefone_1 || info.telefone1 || "";
  return {
    document: digits,
    name: info.razao_social || info.nome_fantasia || "",
    email: info.email || "",
    phone,
    address: street,
    neighborhood: info.bairro || "",
    zip_code: info.cep || "",
    city: info.municipio || "",
    state: info.uf || "",
  };
}

async function fetchFromReceitaWs(digits: string) {
  const res = await fetch(`https://www.receitaws.com.br/v1/cnpj/${digits}`, {
    headers: {
      "User-Agent": "ForcaDeVendas/1.0 (+https://friendly-sales-win.lovable.app)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`RECEITAWS_HTTP_${res.status}`);
  }
  const info: any = await res.json();
  if (info.status === "ERROR") {
    throw new Error("NOT_FOUND");
  }
  const street = [info.logradouro, info.numero, info.complemento]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    document: digits,
    name: info.nome || info.fantasia || "",
    email: info.email || "",
    phone: info.telefone || "",
    address: street,
    neighborhood: info.bairro || "",
    zip_code: info.cep || "",
    city: info.municipio || "",
    state: info.uf || "",
  };
}

export const lookupCnpj = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ cnpj: z.string().min(1) }).parse(data)
  )
  .handler(async ({ data }) => {
    const digits = data.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) {
      throw new Error("CNPJ inválido. Digite os 14 números.");
    }

    let lastError: unknown = null;
    for (const fetcher of [fetchFromBrasilApi, fetchFromReceitaWs]) {
      try {
        return await fetcher(digits);
      } catch (err: any) {
        lastError = err;
        if (err?.message === "NOT_FOUND") {
          throw new Error("CNPJ não encontrado.");
        }
        // try next provider
      }
    }

    console.error("[lookupCnpj] all providers failed", lastError);
    throw new Error(
      "Não foi possível consultar o CNPJ agora. Você pode preencher os dados manualmente."
    );
  });

export const deleteCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// Products
export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => productSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      name: data.name,
      description: data.description || null,
      sku: data.sku || null,
      price: data.price,
      cost: data.cost,
      stock: data.stock,
      active: data.active,
    };

    if (data.id) {
      const { data: result, error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    }

    const { data: result, error } = await supabase
      .from("products")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// Sellers
export const listSellers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("sellers")
      .select("*")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => sellerSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      active: data.active,
    };

    if (data.id) {
      const { data: result, error } = await supabase
        .from("sellers")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    }

    const { data: result, error } = await supabase
      .from("sellers")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

export const deleteSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("sellers")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// Orders
export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("order_summary")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: order, error } = await supabase
      .from("orders")
      .select(
        "*, customer:customers(id, name, document, phone, email, address, neighborhood, zip_code, city, state, price_table), seller:sellers(id, name, phone, email)"
      )
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (error) throw new Error(error.message);

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", data.id)
      .order("code");
    if (itemsError) throw new Error(itemsError.message);

    return {
      order: {
        ...order,
        customer_name: order.customer?.name ?? null,
        seller_name: order.seller?.name ?? null,
      },
      items: items ?? [],
    };
  });

export const upsertOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => orderSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const computed = data.items.map((item) => {
      const base = item.quantity * item.unit_price;
      const ipi_value = (base * item.ipi_percent) / 100;
      const st_value = (base * item.st_percent) / 100;
      return { item, base, ipi_value, st_value };
    });

    const subtotal = computed.reduce((s, c) => s + c.base, 0);
    const ipi_total = computed.reduce((s, c) => s + c.ipi_value, 0);
    const st_total = computed.reduce((s, c) => s + c.st_value, 0);
    const total = subtotal + ipi_total + st_total;

    // Se nenhum vendedor foi informado, usa automaticamente o vendedor
    // cadastrado para este usuário (o representante logado no sistema).
    let sellerId = data.seller_id ?? null;
    if (!sellerId) {
      const { data: defaultSeller } = await supabase
        .from("sellers")
        .select("id")
        .eq("user_id", userId)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      sellerId = defaultSeller?.id ?? null;
    }

    const orderPayload = {
      user_id: userId,
      customer_id: data.customer_id,
      seller_id: sellerId,
      status: data.status,
      price_table: data.price_table,
      payment_term: data.payment_term || null,
      subtotal,
      ipi_total,
      st_total,
      total,
    };

    let orderId = data.id;

    if (orderId) {
      const { error } = await supabase
        .from("orders")
        .update(orderPayload)
        .eq("id", orderId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);

      await supabase.from("order_items").delete().eq("order_id", orderId);
    } else {
      const { data: inserted, error } = await supabase
        .from("orders")
        .insert(orderPayload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      orderId = inserted.id;
    }

    const itemsPayload = computed.map(({ item, base, ipi_value, st_value }) => ({
      order_id: orderId!,
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
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(itemsPayload);
    if (itemsError) throw new Error(itemsError.message);

    return { id: orderId };
  });

// Catalog
export const listCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ search: z.string().optional() }).parse(data ?? {})
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let query = supabase
      .from("catalog_products")
      .select("*")
      .eq("active", true)
      .order("code")
      .limit(60);
    const term = (data.search ?? "").trim();
    if (term) {
      query = query.or(
        `code.ilike.%${term}%,ref.ilike.%${term}%,description.ilike.%${term}%,barcode.ilike.%${term}%`
      );
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return term ? sortCatalogByRelevance(rows ?? [], term) : rows ?? [];
  });

/**
 * Reordena os resultados da busca priorizando quem bate exatamente com o
 * termo digitado (ex: buscar "2088" mostra primeiro o produto de código
 * 2088, em vez de ordenar tudo apenas alfabeticamente).
 */
function sortCatalogByRelevance(rows: any[], term: string) {
  const t = term.trim().toLowerCase();
  const score = (row: any) => {
    const code = String(row.code ?? "").toLowerCase();
    const ref = String(row.ref ?? "").toLowerCase();
    const description = String(row.description ?? "").toLowerCase();
    const barcode = String(row.barcode ?? "").toLowerCase();
    if (code === t || barcode === t) return 0;
    if (code.startsWith(t)) return 1;
    if (ref === t) return 2;
    if (ref.startsWith(t)) return 3;
    if (code.includes(t) || barcode.includes(t)) return 4;
    if (ref.includes(t)) return 5;
    if (description.startsWith(t)) return 6;
    return 7; // description.includes(t) ou outro campo
  };
  return [...rows].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return String(a.code ?? "").localeCompare(String(b.code ?? ""));
  });
}

// Retorna o catálogo completo (sem limite), usado para sincronizar a
// cópia local que permite consultar preços e montar pedidos offline.
export const listCatalogAll = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const pageSize = 500;
    let from = 0;
    const all: any[] = [];
    while (true) {
      const { data: rows, error } = await supabase
        .from("catalog_products")
        .select("*")
        .eq("active", true)
        .order("code")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  });

/**
 * Busca o registro completo do catálogo (preços das 3 tabelas, IPI, ST)
 * para uma lista de produtos, por id. Usado ao abrir um pedido para editar,
 * para recalcular corretamente o preço de cada item se o usuário trocar a
 * tabela de preço.
 */
export const getCatalogProductsByIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ ids: z.array(z.string().uuid()) }).parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    if (data.ids.length === 0) return [];
    const { data: rows, error } = await supabase
      .from("catalog_products")
      .select("*")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        status: orderStatusSchema,
      })
      .parse(data)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("orders")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
