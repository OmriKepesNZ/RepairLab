// The List and Board views of all repairs.
import { $, esc, fmtDate, paymentPill, showBanner, statusPill, STATUSES } from "./util.js";
import { state, moveStatus } from "./data.js";
import { openRepair } from "./detail.js";

let completedExpanded = false;

function matchingRepairs(applyStatusFilter) {
  const text = $("search").value.trim().toLowerCase();
  const status = $("filter-status").value;
  return state.repairs.filter((r) => {
    if (applyStatusFilter && status && r.status !== status) return false;
    const searchable = [r.invoiceNumber, r.customerName, r.item, r.productName, r.description].join(" ").toLowerCase();
    return !text || searchable.includes(text);
  });
}

function listHtml() {
  const rows = matchingRepairs(true).map((r) => `
    <tr data-id="${r.id}">
      <td><b>${esc(r.invoiceNumber)}</b></td>
      <td>${esc(r.customerName)}</td>
      <td>${esc(r.productName)}</td>
      <td>${statusPill(r.status)}</td>
      <td>${fmtDate(r.dateReceivedLab)}</td>
      <td>${paymentPill(r.paymentStatus)}</td>
    </tr>`);
  if (!rows.length) return `<div class="table-wrap"><div class="empty">No repairs to show.</div></div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Invoice</th><th>Customer</th><th>Product</th><th>Status</th><th>In lab</th><th>Payment</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

function boardHtml() {
  const repairs = matchingRepairs(false);
  const searchActive = $("search").value.trim() !== "";
  const completedVisible = completedExpanded || searchActive;
  const columns = STATUSES.map((status) => {
    const statusRepairs = repairs.filter((r) => r.status === status);
    const cards = (status !== "Completed" || completedVisible) ? statusRepairs.map((r) => `
      <div class="card" draggable="true" data-id="${r.id}">
        <b>${esc(r.invoiceNumber)}</b> · ${esc(r.customerName)}
        ${r.productName ? `<div class="muted">${esc(r.productName)}</div>` : ""}
        <div style="margin-top:6px">${paymentPill(r.paymentStatus)}</div>
      </div>`) : [];
    const header = status === "Completed"
      ? `<button type="button" class="col-head archive-toggle" data-toggle-completed aria-expanded="${completedVisible}" aria-label="Completed archive, ${statusRepairs.length} repairs${searchActive ? ", matching search" : ""}" ${searchActive ? "disabled" : ""}><span>Completed archive</span><span class="archive-count">${statusRepairs.length}</span><span class="archive-chevron" aria-hidden="true"></span></button>`
      : `<div class="col-head"><span>${status}</span><span>${statusRepairs.length}</span></div>`;
    const body = status !== "Completed" || completedVisible ? `<div class="col-body">${cards.join("")}</div>` : "";
    return `<div class="col${status === "Completed" ? " completed-col" : ""}" data-status="${status}">${header}${body}</div>`;
  });
  return `<div class="board">${columns.join("")}</div>`;
}

export function renderRepairs() {
  $("content").innerHTML = state.view === "list" ? listHtml() : boardHtml();
  const open = state.repairs.filter((r) => r.status !== "Completed").length;
  const unpaid = state.repairs.filter((r) => r.paymentStatus === "Unpaid").length;
  $("summary").textContent = `${state.repairs.length} repairs · ${open} open · ${unpaid} unpaid`;
}

// One-time wiring: clicks and drag-and-drop are handled on the container so they survive re-rendering.
export function initRepairViews() {
  const content = $("content");
  const repairFor = (el) => state.repairs.find((r) => r.id === el.dataset.id);
  const clearHighlights = () => content.querySelectorAll(".dragover, .dragging").forEach((el) => el.classList.remove("dragover", "dragging"));

  content.onclick = (e) => {
    const archiveToggle = e.target.closest("[data-toggle-completed]");
    if (archiveToggle) {
      if ($("search").value.trim()) return;
      completedExpanded = !completedExpanded;
      renderRepairs();
      return;
    }
    const item = e.target.closest("[data-id]");
    if (item) openRepair(repairFor(item));
  };
  content.ondragstart = (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    e.dataTransfer.setData("text/plain", card.dataset.id);
    card.classList.add("dragging");
  };
  content.ondragend = clearHighlights;
  content.ondragover = (e) => {
    const column = e.target.closest(".col");
    if (!column) return;
    e.preventDefault();
    content.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
    column.classList.add("dragover");
  };
  content.ondrop = async (e) => {
    const column = e.target.closest(".col");
    if (!column) return;
    e.preventDefault();
    clearHighlights();
    const repair = state.repairs.find((r) => r.id === e.dataTransfer.getData("text/plain"));
    if (!repair || repair.status === column.dataset.status) return;
    try { await moveStatus(repair, column.dataset.status); }
    catch (err) { showBanner("Could not move repair: " + err.message); }
  };
}
