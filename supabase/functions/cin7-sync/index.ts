// Supabase Edge Function "cin7-sync". Secrets: CIN7_USER, CIN7_KEY, SYNC_SECRET, SUPABASE_ANON_KEY.
// "Verify JWT" must be OFF (this file checks who's calling itself, see authorised() below).
//
// Called two ways:
//  - The 10-min schedule, with header x-sync-secret matching SYNC_SECRET.
//  - The "Force sync" button in the app, as the signed-in user (no secret exposed to the browser).
//
// Body: {"job": "orders" | "products" | "all", "force": true|false}
//  - orders (default): import new/changed Cin7 sales orders containing a repair item.
//  - products: refresh the copy of the Cin7 product/category list (paged, 1500 per call).
//  - all: both of the above. Force sync uses this.
//  - force: true also makes "orders" look further back and "products" restart from scratch.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_REPAIR_CODES = ["CA11001", "CA11002"];
const isRepair = (code: string, repairCodes: string[]) =>
  repairCodes.some((prefix) => code.toUpperCase().startsWith(prefix));
const nzDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
const nm = (a?: string, b?: string) => [a, b].filter(Boolean).join(" ").trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

// deno-lint-ignore no-explicit-any
async function authorised(req: Request): Promise<boolean> {
  if (req.headers.get("x-sync-secret") === Deno.env.get("SYNC_SECRET")) return true; // the scheduled job
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await userClient.auth.getUser(token);
  return !error && Boolean(data.user); // any signed-in staff member
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await authorised(req))) return new Response("unauthorised", { status: 401, headers: CORS });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = "Basic " + btoa(`${Deno.env.get("CIN7_USER")}:${Deno.env.get("CIN7_KEY")}`);
  const body = await req.json().catch(() => ({}));
  const job = body?.job ?? "orders";
  const force = Boolean(body?.force);
  const { data: settings, error: settingsError } = await sb
    .from("cin7_settings")
    .select("repair_codes")
    .eq("singleton", true)
    .maybeSingle();
  if (settingsError) return json({ error: "Could not load Cin7 repair-code settings." }, 500);
  const repairCodes = Array.isArray(settings?.repair_codes)
    ? settings.repair_codes.filter((code: unknown) => typeof code === "string").map((code: string) => code.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_REPAIR_CODES;

  if (job === "all") {
    if (force) await sb.from("sync_state").update({ last_modified: null }).eq("id", 1);
    const ordersRes = await syncOrders(sb, auth, repairCodes);
    if (ordersRes.status !== 200) return ordersRes;
    if (force) await sb.from("sync_state").update({ products_page: 1, products_done: null }).eq("id", 2);
    const productsRes = await syncProducts(sb, auth, repairCodes);
    if (productsRes.status !== 200) return productsRes;
    return json({ orders: await ordersRes.json(), products: await productsRes.json() });
  }
  return job === "products" ? await syncProducts(sb, auth, repairCodes) : await syncOrders(sb, auth, repairCodes);
});

// deno-lint-ignore no-explicit-any
async function syncOrders(sb: any, auth: string, repairCodes: string[]) {
  const { data: st } = await sb.from("sync_state").select("last_modified").eq("id", 1).maybeSingle();
  const since = new Date(st?.last_modified ?? Date.now() - 30 * 864e5).toISOString().replace(/\.\d{3}Z$/, "Z");
  let newest = new Date(since).getTime(), added = 0, updated = 0;
  const noName: unknown[] = [];

  for (let page = 1; page <= 20; page++) {
    const where = encodeURIComponent(`modifiedDate>'${since}'`);
    const res = await fetch(`https://api.cin7.com/api/v1/SalesOrders?where=${where}&order=modifiedDate&rows=250&page=${page}`, { headers: { Authorization: auth } });
    if (!res.ok) return json(`Cin7 ${res.status}: ${await res.text()}`, 502);
    const orders = await res.json();

    for (const o of orders) {
      newest = Math.max(newest, new Date(o.modifiedDate).getTime());
      if (o.isVoid) continue;
      const customer = nm(o.firstName, o.lastName) || o.company || nm(o.deliveryFirstName, o.deliveryLastName)
        || nm(o.billingFirstName, o.billingLastName) || o.deliveryCompany || o.billingCompany || null;
      const comments = [
        o.internalComments && `Internal comments: ${o.internalComments}`,
        o.deliveryInstructions && `Delivery instructions: ${o.deliveryInstructions}`,
      ].filter(Boolean).join("\n\n") || null;

      for (const [i, l] of (o.lineItems ?? []).entries()) {
        const code: string = l.code ?? "";
        if (!isRepair(code, repairCodes)) continue;
        if (!customer && noName.length < 3) noName.push({ ref: o.reference, memberId: o.memberId, firstName: o.firstName, lastName: o.lastName, company: o.company, deliveryFirstName: o.deliveryFirstName, billingFirstName: o.billingFirstName });
        const key = `${o.id}-${l.id ?? i}`;

        const { data: ex } = await sb.from("repairs").select("id, item, customer_name, cin7_comments").eq("cin7_key", key).maybeSingle();
        if (ex) { // already imported: refresh Cin7-owned info only, never touch lab data
          const patch: Record<string, unknown> = {};
          if (ex.item !== code) patch.item = code;
          if ((ex.cin7_comments ?? null) !== comments) patch.cin7_comments = comments;
          if (!ex.customer_name && customer) patch.customer_name = customer;
          if (Object.keys(patch).length) {
            await sb.from("repairs").update(patch).eq("id", ex.id);
            if ("cin7_comments" in patch) await sb.from("repair_events").insert({ repair_id: ex.id, text: "Cin7 order comments updated", source: "Cin7 API" });
            updated++;
          }
          continue;
        }

        const { data: row, error } = await sb.from("repairs").insert({
          cin7_key: key,
          invoice_number: o.reference ?? String(o.id),
          customer_name: customer,
          order_created: o.createdDate ? nzDate(o.createdDate) : null,
          item: code,
          qty: l.qty ?? 1,
          status: "Created in Cin7",
          payment_status: code === "CA11002" ? "Waived" : "Unpaid",
          cin7_comments: comments,
        }).select("id").single();
        if (error) return json(error.message, 500);
        added++;
        await sb.from("repair_events").insert({ repair_id: row.id, text: `Repair added via Cin7 API (order ${o.reference ?? o.id})`, source: "Cin7 API" });
      }
    }
    if (orders.length < 250) break;
  }
  await sb.from("sync_state").upsert({ id: 1, last_modified: new Date(newest).toISOString() });
  return json({ added, updated, ...(noName.length ? { noCustomerName: noName } : {}) });
}

// deno-lint-ignore no-explicit-any
async function syncProducts(sb: any, auth: string, repairCodes: string[]) {
  const { data: st } = await sb.from("sync_state").select("products_page, products_done").eq("id", 2).maybeSingle();
  const start = st?.products_page ?? 1;
  const doneAt = st?.products_done ? new Date(st.products_done).getTime() : 0;
  if (start === 1 && Date.now() - doneAt < 36e5) return json({ skipped: "catalogue refreshed within the last hour" });

  let page = start, count = 0, finished = false;
  for (let n = 0; n < 6; n++, page++) { // 6 pages x 250 products per run
    const res = await fetch(`https://api.cin7.com/api/v1/Products?order=id&rows=250&page=${page}`, { headers: { Authorization: auth } });
    if (!res.ok) return json(`Cin7 ${res.status}: ${await res.text()}`, 502);
    const products = await res.json();
    const rows: { code: string; label: string; style_code: string | null; category: string | null }[] = [];
    for (const p of products) {
      if (p.status === "Inactive") continue;
      for (const o of p.productOptions ?? []) {
        if (o.status === "Disabled") continue;
        const code: string = o.productOptionCode ?? o.code ?? "";
        if (!code || isRepair(code, repairCodes)) continue;
        const opts = [o.option1, o.option2, o.option3].filter(Boolean).join(" / ");
        rows.push({ code, label: opts ? `${p.name} – ${opts}` : p.name, style_code: p.styleCode ?? null, category: p.category || null });
      }
    }
    const unique = [...new Map(rows.map((r) => [r.code, r])).values()]; // Cin7 can return the same SKU twice
    for (let i = 0; i < unique.length; i += 500) {
      const { error } = await sb.from("products").upsert(unique.slice(i, i + 500), { onConflict: "code" });
      if (error) return json(error.message, 500);
    }
    count += unique.length;
    if (products.length < 250) { finished = true; break; }
  }
  await sb.from("sync_state").upsert({ id: 2, products_page: finished ? 1 : page, products_done: finished ? new Date().toISOString() : (st?.products_done ?? null) });
  return json({ productsSaved: count, finished, nextPage: finished ? 1 : page });
}
