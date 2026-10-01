// The List and Board views of all repairs.
import { $, esc, today, showBanner, statusPill, STATUSES, displayStatus } from "./util.js";
import { state, moveStatus } from "./data.js";
import { openRepair } from "./detail.js";

let listFilter = "all";

function matchingRepairs() {
  const text = $("search").value.trim().toLowerCase();
  return state.repairs.filter((r) => {
    const searchable = [r.invoiceNumber, r.customerName, r.item, r.productName, r.description].join(" ").toLowerCase();
    return !text || searchable.includes(text);
  });
}

const filterMatches = (repair) => {
  if (listFilter === "archived") return repair.status === "Completed";
  if (repair.status === "Completed") return false;
  if (listFilter === "open") return true;
  if (listFilter === "unpaid") return repair.paymentStatus === "Unpaid" || repair.paymentStatus === "Partial";
  if (listFilter === "warranty") return repair.item === "CA11002" || /\bwarranty\b/i.test(repair.item) && !/non[- ]warranty/i.test(repair.item);
  return true;
};

const dayNumber = (value) => value ? Math.floor(Date.parse(`${value}T00:00:00Z`) / 86400000) : null;
const waitingDays = (repair) => {
  const start = dayNumber(repair.dateReceivedLab || repair.orderCreated);
  const end = dayNumber(repair.dateOut || today());
  return start === null || end === null ? 0 : Math.max(0, end - start);
};
const waitingThreshold = () => Number(state.waitingDaysThreshold ?? 36);
const isOverdue = (repair, days = waitingDays(repair)) =>
  repair.status !== "Completed" && repair.status !== "Ready for Pickup" && days > waitingThreshold();

const repairClass = (item) => {
  if (item === "CA11002" || /\bwarranty\b/i.test(item) && !/non[- ]warranty/i.test(item)) return "Warranty";
  if (item === "CA11001" || /^CA11001\./.test(item) || /non[- ]warranty/i.test(item)) return "Non-warranty";
  return item || "—";
};

const formatMoney = (value) => value === "" || value == null ? "—" : `$${Number(value).toFixed(2)}`;

function tableHtml(repairs, emptyMessage = "No repairs to show.") {
  if (!repairs.length) return `<div class="table-wrap"><div class="empty">${esc(emptyMessage)}</div></div>`;
  const rows = repairs.map((r) => `
    <tr class="repair-row" draggable="true" data-id="${r.id}">
      <td><div class="list-product">${esc(r.productName || "Add product")}</div><div class="list-category">${esc(r.category || "")}</div></td>
      <td>${esc(r.customerName || "—")}</td>
      <td>${statusPill(r.status)}</td>
      <td>${esc(repairClass(r.item))}</td>
      <td><span class="list-payment ${["Paid", "Waived"].includes(r.paymentStatus) ? "is-paid" : r.paymentStatus === "Partial" ? "is-partial" : "is-unpaid"}">${esc(r.paymentStatus || "Unpaid")}</span></td>
      <td>${waitingDays(r)} days total</td>
      <td>${r.repairTime === "" || r.repairTime == null ? "—" : `${esc(r.repairTime)} min`}</td>
      <td>${formatMoney(r.materialCost)}</td>
    </tr>`);
  return `<div class="table-wrap"><table>
    <thead><tr><th>Product</th><th>Customer</th><th>Status</th><th>Class</th><th>Payment</th><th>Waiting ↓</th><th>Time</th><th>Materials</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

function listHtml() {
  const filtered = matchingRepairs().filter(filterMatches);
  const repairs = [...filtered].sort((a, b) => waitingDays(b) - waitingDays(a));
  const filters = [["all", "All"], ["open", "Open"], ["unpaid", "Unpaid"], ["warranty", "Warranty"], ["archived", "Archived"]];
  return `<div class="list-toolbar"><div class="list-filters" role="tablist" aria-label="Filter repairs">${filters.map(([value, label]) => `<button type="button" role="tab" aria-selected="${listFilter === value}" class="list-filter${listFilter === value ? " active" : ""}" data-list-filter="${value}">${label}</button>`).join("")}</div><span class="list-count">${repairs.length} repairs</span></div>${tableHtml(repairs, listFilter === "archived" ? "No archived repairs to show." : "No repairs to show.")}`;
}

function repairCard(repair) {
  const customerText = repair.customerName ? `${esc(repair.customerName)} · ${repair.cin7Key ? "Cin7" : "Manual"}` : "No customer";
  const productText = repair.productName ? esc(repair.productName) : '<span class="need">Add product</span>';
  const paymentDot = ["Paid", "Waived"].includes(repair.paymentStatus) ? "dot paid" : "dot";
  const paymentLabel = repair.paymentStatus === "Waived" ? "Waived" : repair.paymentStatus === "Partial" ? "Partial" : repair.paymentStatus === "Paid" ? "Paid" : "Unpaid";
  const ageDays = waitingDays(repair);
  const age = ageDays === 0 ? "Today" : ageDays === 1 ? "1 day" : `${ageDays} days`;
  const ageClass = isOverdue(repair, ageDays) ? "late-text is-late" : "late-text";
  return `
    <div class="card${repair.isUrgent ? " is-urgent" : ""}" draggable="true" data-id="${repair.id}" tabindex="0" role="button" aria-label="Open repair ${esc(repair.invoiceNumber)}${repair.isUrgent ? ", urgent" : ""}">
      <div class="card-title-row"><div class="card-title">${productText}</div>${repair.isUrgent ? `<span class="urgent-badge">Urgent</span>` : ""}</div>
      <div class="card-subtitle">${customerText}</div>
      <div class="card-footer">
        <span class="${paymentDot}">${paymentLabel}</span>
        <span class="${ageClass}">${age}</span>
      </div>
    </div>`;
}

function boardHtml() {
  const repairs = matchingRepairs();
  const columns = STATUSES.filter((status) => status !== "Completed").map((status) => {
    const statusRepairs = repairs.filter((r) => r.status === status).sort((a, b) => Number(Boolean(b.isUrgent)) - Number(Boolean(a.isUrgent)) || waitingDays(b) - waitingDays(a));
    return `<div class="col" data-status="${status}"><div class="col-head"><span>${displayStatus(status)}</span><span>${statusRepairs.length}</span></div><div class="col-body">${statusRepairs.map(repairCard).join("") || '<div class="empty">Nothing here</div>'}</div></div>`;
  });
  return `<div class="board">${columns.join("")}</div>`;
}

function archiveHtml() {
  const searchActive = $("search").value.trim() !== "";
  const completed = matchingRepairs().filter((repair) => repair.status === "Completed");
  const archiveCount = state.repairs.filter((repair) => repair.status === "Completed").length;
  return `<section class="archive-dropzone" data-status="Completed" aria-label="Completed archive">
      <div class="archive-message"><span class="archive-icon" aria-hidden="true"></span><p>Drop here once it's picked up and paid</p></div>
      <div class="archive-actions"><span class="archive-total">${archiveCount} archived</span><button type="button" class="archive-toggle" data-view-archived>View archived</button></div>
    </section>`;
}

export function renderRepairs() {
  $("content").innerHTML = state.view === "list" ? listHtml() : boardHtml() + archiveHtml();
  const open = state.repairs.filter((r) => r.status !== "Completed").length;
  const outstanding = state.repairs.filter((r) => r.status !== "Completed" && (r.paymentStatus === "Unpaid" || r.paymentStatus === "Partial")).length;
  const late = state.repairs.filter((repair) => isOverdue(repair)).length;
  const urgent = state.repairs.filter((repair) => repair.status !== "Completed" && repair.isUrgent).length;
  $("summary").innerHTML = `<div><strong>${open}</strong><span>in the lab</span></div><div><strong class="warn">${late}</strong><span>waiting over ${waitingThreshold()} days</span></div><div><strong>${outstanding}</strong><span>unpaid</span></div><div><strong>${urgent}</strong><span>urgent orders</span></div>`;
}

export function setListFilter(filter) {
  listFilter = filter;
  if (state.view === "list") renderRepairs();
}

// One-time wiring: clicks and drag-and-drop are handled on the container so they survive re-rendering.
export function initRepairViews() {
  const content = $("content");
  const repairFor = (el) => state.repairs.find((r) => r.id === el.dataset.id);
  const clearHighlights = () => content.querySelectorAll(".dragover, .dragging").forEach((el) => el.classList.remove("dragover", "dragging"));

  content.onclick = (e) => {
    const archiveButton = e.target.closest("[data-view-archived]");
    if (archiveButton) {
      document.dispatchEvent(new CustomEvent("repairlab:show-archive"));
      return;
    }
    const filterButton = e.target.closest("[data-list-filter]");
    if (filterButton) {
      listFilter = filterButton.dataset.listFilter;
      renderRepairs();
      return;
    }
    const item = e.target.closest("[data-id]");
    if (item) openRepair(repairFor(item));
  };
  content.ondragstart = (e) => {
    const repair = e.target.closest(".card, .repair-row");
    if (!repair) return;
    e.dataTransfer.setData("text/plain", repair.dataset.id);
    repair.classList.add("dragging");
  };
  content.ondragend = clearHighlights;
  content.ondragover = (e) => {
    const target = e.target.closest("[data-status]");
    if (!target) return;
    e.preventDefault();
    content.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
    target.classList.add("dragover");
  };
  content.ondrop = async (e) => {
    const target = e.target.closest("[data-status]");
    if (!target) return;
    e.preventDefault();
    clearHighlights();
    const repair = state.repairs.find((r) => r.id === e.dataTransfer.getData("text/plain"));
    if (!repair || repair.status === target.dataset.status) return;
    try { await moveStatus(repair, target.dataset.status); }
    catch (err) { showBanner("Could not move repair: " + err.message); }
  };
}
