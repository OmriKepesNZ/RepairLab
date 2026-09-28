// Everything that talks to Supabase. The rest of the app only uses these functions.
import { showBanner, today, STATUSES } from "./util.js";

export const state = { repairs: [], me: { name: "Someone" }, view: "board" };

let db;
let onChange = () => {};

// App field name -> database column name.
const COLUMNS = {
  invoiceNumber: "invoice_number", customerName: "customer_name", orderCreated: "order_created",
  dateReceivedLab: "date_received_lab", dateOut: "date_out", item: "item", qty: "qty", category: "category",
  description: "description", status: "status", paymentStatus: "payment_status", repairTime: "repair_time",
  materialCost: "material_cost", productCode: "product_code", productName: "product_name",
  cin7Comments: "cin7_comments", cin7Key: "cin7_key",
};

const toRow = (fields) =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => COLUMNS[key]).map(([key, value]) => [COLUMNS[key], value === "" ? null : value]));

const fromRow = (row) => ({
  id: row.id,
  ...Object.fromEntries(Object.entries(COLUMNS).map(([key, column]) => [key, row[column] ?? ""])),
  events: (row.repair_events || []).map((e) => ({ type: e.type, text: e.text, by: e.by_name, source: e.source, at: e.created_at })),
});

export function connect(onDataChanged) {
  onChange = onDataChanged;
  db = supabase.createClient(APP_CONFIG.url, APP_CONFIG.key);
  return db.auth;
}

export async function loadRepairs() {
  const { data, error } = await db.from("repairs").select("*, repair_events(*)").order("created_at", { ascending: false }).limit(1000);
  if (error) return showBanner("Could not load repairs: " + error.message);
  state.repairs = data.map(fromRow);
  onChange();
}

// Reload whenever anyone changes a repair, so everyone sees updates live.
export function watchChanges() {
  let timer;
  const reload = () => { clearTimeout(timer); timer = setTimeout(loadRepairs, 300); };
  const channel = db.channel("repair-lab");
  for (const table of ["repairs", "repair_events"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, reload);
  channel.subscribe();
}

export const newEvent = (type, text) => ({ type, text, by_name: state.me.name, source: null });

async function insertEvents(repairId, events) {
  if (!events.length) return;
  const rows = events.map((e) => ({ repair_id: repairId, type: e.type, text: e.text, by_name: e.by_name, source: e.source }));
  const { error } = await db.from("repair_events").insert(rows);
  if (error) throw error;
}

export async function createRepair(fields, events) {
  const { data, error } = await db.from("repairs").insert(toRow(fields)).select("id").single();
  if (error) throw error;
  await insertEvents(data.id, events);
  await loadRepairs();
}

export async function saveRepair(id, changes, events) {
  if (Object.keys(changes).length) {
    const { error } = await db.from("repairs").update(toRow(changes)).eq("id", id);
    if (error) throw error;
  }
  await insertEvents(id, events);
  await loadRepairs();
}

export async function deleteRepair(id) {
  const { error } = await db.from("repairs").delete().eq("id", id);
  if (error) throw error;
  await loadRepairs();
}

// Moving a repair into "Received" fills in today's date as "received in lab" (if not already set).
// Moving it into "Ready for Pickup" fills in today's date as "date completed" (if not already set).
export function withLabDate(repair, changes) {
  const newStatus = changes.status ?? repair.status;
  if (newStatus === STATUSES[1] && !repair.dateReceivedLab && !changes.dateReceivedLab) changes.dateReceivedLab = today();
  if (newStatus === STATUSES[3] && !repair.dateOut && !changes.dateOut) changes.dateOut = today();
  return changes;
}

export async function moveStatus(repair, status) {
  const changes = withLabDate(repair, { status });
  const note = `Status: ${repair.status} → ${status}` + (changes.dateReceivedLab ? ` (received in lab ${changes.dateReceivedLab})` : "");
  await saveRepair(repair.id, changes, [newEvent("event", note)]);
}

// Search the Cin7 product list (copied into the "products" table by the sync function).
export async function searchProducts(text) {
  let query = db.from("products").select("code, label, category").limit(15);
  for (const word of text.toLowerCase().split(/\s+/)) {
    const clean = word.replace(/[%_*,()\\]/g, "");
    if (clean) query = query.ilike("search", `%${clean}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// The categories that exist in Cin7 (taken from the copied product list). Loaded once.
let categoryCache = null;
export async function loadCategories() {
  if (!categoryCache) {
    const { data, error } = await db.from("product_categories").select("category").order("category");
    if (!error) categoryCache = data.map((row) => row.category);
  }
  return categoryCache || [];
}

// Ask the server to re-check everything with Cin7 right now: orders, then the full product/category list.
// Runs as the signed-in user (no secret needed in the browser).
async function invokeEdgeFunction(name, body) {
  const { data, error } = await db.functions.invoke(name, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (error) throw error;
  return data;
}

export async function forceSync() {
  const result = await invokeEdgeFunction("cin7-sync", { job: "all", force: true });
  let products = result?.products;
  for (let guard = 0; products?.finished === false && guard < 8; guard++) {
    const step = await invokeEdgeFunction("cin7-sync", { job: "products" });
    if (step?.error) throw new Error(step.error.message || step.error);
    products = step?.data ?? step;
  }
  await loadRepairs();
  return { orders: result?.orders, products };
}
