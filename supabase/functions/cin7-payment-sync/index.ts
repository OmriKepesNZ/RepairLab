import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BATCH_SIZE = 400;
const PAGE_SIZE = 250;
const API_BASE = "https://api.cin7.com/api/v1";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type Repair = { id: string; cin7_key: string | null; payment_status: string | null; cin7_price: number | null };
type RepairLink = { repair: Repair; lineRef: number };
type SalesOrder = { id: number; total: number; isVoid: boolean; lineItems?: { id: number; code: string; unitPrice?: number | string | null }[] };
type Payment = { id?: number; orderId: number; amount: number; direction?: number; orderType?: number | string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const username = Deno.env.get("CIN7_USER");
  const apiKey = Deno.env.get("CIN7_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !username || !apiKey) {
    return json({ error: "Cin7 payment sync is not configured." }, 500);
  }

  let isScheduled = false;
  const cronSecret = Deno.env.get("SYNC_SECRET");
  const providedCronSecret = req.headers.get("x-sync-secret");
  if (cronSecret && providedCronSecret && cronSecret === providedCronSecret) {
    isScheduled = true;
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign-in is required." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data.user) return json({ error: "Your session is invalid or expired." }, 401);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  if (!isScheduled && body.job !== "payments") return json({ error: "Unknown sync job." }, 400);

  const { data: cursorRow, error: cursorError } = await service
    .from("cin7_payment_sync_state")
    .select("batch_offset")
    .eq("singleton", true)
    .maybeSingle();
  if (cursorError) return json({ error: "Could not load payment sync cursor." }, 500);

  let offset = body.restart === true ? 0 : Number(cursorRow?.batch_offset ?? 0);
  const { data: repairs, error: repairsError } = await service
    .from("repairs")
    .select("id, cin7_key, payment_status, cin7_price")
    .not("cin7_key", "is", null)
    .order("id")
    .range(offset, offset + BATCH_SIZE - 1);
  if (repairsError) return json({ error: "Could not load Cin7-linked repairs." }, 500);

  if (!repairs?.length) {
    const { error } = await service.from("cin7_payment_sync_state").upsert({ singleton: true, batch_offset: 0 });
    if (error) return json({ error: "Could not reset payment sync cursor." }, 500);
    return json({ processed: 0, updated: 0, finished: true });
  }

  const linked = new Map<number, RepairLink[]>();
  let invalidKeys = 0;
  for (const repair of repairs as Repair[]) {
    const key = /^(\d+)-(\d+)$/.exec(repair.cin7_key ?? "");
    const orderId = Number(key?.[1]);
    const lineRef = Number(key?.[2]);
    if (!key || !Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(lineRef)) {
      invalidKeys++;
      continue;
    }
    linked.set(orderId, [...(linked.get(orderId) ?? []), { repair, lineRef }]);
  }

  let lastApiRequest = 0;
  const cin7Get = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    const delay = Math.max(0, 1100 - (Date.now() - lastApiRequest));
    if (delay) await wait(delay);
    lastApiRequest = Date.now();

    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${btoa(`${username}:${apiKey}`)}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const details = (await response.text()).trim().slice(0, 300);
      throw new Error(`Cin7 Omni returned HTTP ${response.status}${details ? `: ${details}` : ""}`);
    }
    return await response.json() as T;
  };

  try {
    const orderIds = [...linked.keys()];
    let orders: SalesOrder[] = [];
    let payments: Payment[] = [];
    if (orderIds.length) {
      const where = `id IN (${orderIds.join(",")})`;
      for (let page = 1; ; page++) {
        const result = await cin7Get<SalesOrder[]>("SalesOrders", {
          where,
          fields: "id,total,isVoid,lineItems(id,code,unitPrice)",
          page: String(page),
          rows: String(PAGE_SIZE),
        });
        orders.push(...result);
        if (result.length < PAGE_SIZE) break;
      }

      const paymentWhere = `orderId IN (${orderIds.join(",")})`;
      for (let page = 1; ; page++) {
        const result = await cin7Get<Payment[]>("Payments", {
          where: paymentWhere,
          fields: "id,orderId,amount,direction,orderType",
          page: String(page),
          rows: String(PAGE_SIZE),
        });
        payments.push(...result);
        if (result.length < PAGE_SIZE) break;
      }
    }

    const orderById = new Map(orders.map((order) => [Number(order.id), order]));
    const netPaidByOrder = new Map<number, number>();
    for (const payment of payments) {
      if (payment.orderType != null && String(payment.orderType) !== "SalesOrder") continue;
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount)) continue;
      const direction = Number(payment.direction);
      const signedAmount = direction === 1 || direction === -1 ? Math.abs(amount) * direction : amount;
      netPaidByOrder.set(Number(payment.orderId), (netPaidByOrder.get(Number(payment.orderId)) ?? 0) + signedAmount);
    }

    let updated = 0;
    for (const [orderId, linkedRepairs] of linked) {
      const order = orderById.get(orderId);
      if (!order) continue;
      const total = Number(order.total);
      const netPaid = netPaidByOrder.get(orderId) ?? 0;
      const orderPaymentStatus = order.isVoid === true || total <= 0 || netPaid <= 0
        ? "Unpaid"
        : netPaid >= total - 0.005
        ? "Paid"
        : "Partial";

      for (const { repair, lineRef } of linkedRepairs) {
        const line = order.lineItems?.find((item) => Number(item.id) === lineRef) ?? order.lineItems?.[lineRef];
        if (line) {
          const rawPrice = line.unitPrice == null || line.unitPrice === "" ? null : Number(line.unitPrice);
          const price = rawPrice !== null && Number.isFinite(rawPrice) ? rawPrice : null;
          const existingPrice = repair.cin7_price == null ? null : Number(repair.cin7_price);
          if (existingPrice !== price) {
            const { error } = await service.from("repairs").update({ cin7_price: price }).eq("id", repair.id);
            if (error) throw new Error("Could not save a synced repair price.");
          }
        }
        const paymentStatus = line?.code === "CA11002" ? "Waived" : orderPaymentStatus;
        if (repair.payment_status === paymentStatus) continue;
        const { data, error } = await service.rpc("sync_cin7_payment_status", {
          p_repair_id: String(repair.id),
          p_payment_status: paymentStatus,
        });
        if (error) throw new Error("Could not save a synced payment status.");
        if (data === true) updated++;
      }
    }

    const finished = repairs.length < BATCH_SIZE;
    const nextOffset = finished ? 0 : offset + repairs.length;
    const { error: saveCursorError } = await service.from("cin7_payment_sync_state").upsert({
      singleton: true,
      batch_offset: nextOffset,
      updated_at: new Date().toISOString(),
    });
    if (saveCursorError) return json({ error: "Could not save payment sync cursor." }, 500);

    return json({ processed: repairs.length, updated, invalidKeys, finished, nextOffset });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Payment sync failed." }, 502);
  }
});