// Shared constants and small helpers.
export const $ = (id) => document.getElementById(id);

export const esc = (text) =>
  (text ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
export const fmtDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso) => new Date(iso).toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export const STATUSES = ["Created in Cin7", "Received", "In Progress", "Ready for Pickup", "Completed"];
export const PAYMENTS = ["Unpaid", "Paid", "Waived"];
export const CATEGORIES = ["Jacket", "Pants", "Bag", "Boots/Footwear", "Vest", "Base Layer", "Other"];
const STATUS_CLASS = { "Created in Cin7": "cin7", Received: "recv", "In Progress": "prog", "Ready for Pickup": "ready", Completed: "done" };
const PAYMENT_CLASS = { Unpaid: "unpaid", Paid: "paid", Waived: "waived" };
export const statusPill = (status) => `<span class="pill ${STATUS_CLASS[status] || ""}">${esc(status)}</span>`;
export const paymentPill = (payment) => `<span class="pill ${PAYMENT_CLASS[payment] || ""}">${esc(payment)}</span>`;

// Names used when writing "what changed" into a repair's history.
const LABELS = {
  invoiceNumber: "Invoice #", customerName: "Customer", orderCreated: "Order created", dateReceivedLab: "Received in lab",
  dateOut: "Date out", item: "Class", qty: "Qty", category: "Category", description: "Description", status: "Status",
  paymentStatus: "Payment", repairTime: "Repair time", materialCost: "Material cost", productName: "Product",
};
const DATE_FIELDS = ["orderCreated", "dateReceivedLab", "dateOut"];

export function describeChanges(before, changes) {
  const detailed = [], plain = [];
  for (const [key, value] of Object.entries(changes)) {
    const label = LABELS[key];
    if (!label) continue;
    if (key === "status" || key === "paymentStatus") detailed.push(`${label}: ${before[key] || "—"} → ${value}`);
    else if (DATE_FIELDS.includes(key)) detailed.push(`${label}: ${value ? fmtDate(value) : "cleared"}`);
    else if (key === "productName") detailed.push(`${label}: ${value || "cleared"}`);
    else plain.push(label.toLowerCase());
  }
  const text = [...detailed, ...(plain.length ? [`updated ${plain.join(", ")}`] : [])].join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function showBanner(message) {
  $("banner").innerHTML = `<div class="banner">${esc(message)}</div>`;
  setTimeout(() => ($("banner").innerHTML = ""), 6000);
}
