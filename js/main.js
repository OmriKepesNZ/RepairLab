// Start-up: sign-in, toolbar, and wiring the other modules together.
import { $, esc, showBanner } from "./util.js";
import { state, connect, loadRepairs, loadUserRole, loadCin7Settings, watchChanges, forceSync } from "./data.js";
import { renderRepairs, initRepairViews, setListFilter } from "./list.js";
import { renderDashboard } from "./dashboard.js";
import { renderAdmin, initAdmin, loadAdminData } from "./admin.js";
import { openRepair, refreshHistory } from "./detail.js";

const renderActiveView = () => state.view === "dashboard" ? renderDashboard() : state.view === "admin" ? renderAdmin() : renderRepairs();
const auth = connect(() => { renderActiveView(); refreshHistory(); });

// "rob.gray@company.com" -> "Rob Gray" (used to sign history entries)
const displayName = (user) =>
  user.user_metadata?.name || (user.email || "Someone").split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function setView(view) {
  state.view = view;
  $("view-list").classList.toggle("active", view === "list");
  $("view-board").classList.toggle("active", view === "board");
  $("view-dashboard").classList.toggle("active", view === "dashboard");
  $("view-admin").classList.toggle("active", view === "admin");
  $("view-dashboard").textContent = "Insights";
  $("view-admin").textContent = "Settings";
  const isDashboard = view === "dashboard";
  const isAdmin = view === "admin";
  document.body.classList.toggle("dashboard-active", isDashboard);
  $("search").hidden = isDashboard || isAdmin;
  $("add-repair").hidden = isAdmin;
  $("force-sync").hidden = isAdmin;
  $("summary").hidden = isDashboard || isAdmin;
  renderActiveView();
}

function setSyncState(syncing) {
  const button = $("force-sync");
  button.disabled = syncing;
  button.textContent = syncing ? "Syncing…" : "↻ Synced just now";
  button.title = syncing ? "Sync in progress…" : "Re-check Cin7 for new orders and product changes";
}

function formatSyncError(err) {
  const message = err?.message || String(err || "Unknown sync error");
  return "Sync failed: " + message;
}

function showLogin(message) {
  const back = document.createElement("div");
  back.className = "modal-back login-back";
  back.innerHTML = `<div class="modal login-modal">
    <h2>Sign in</h2>
    ${message ? `<div class="banner">${esc(message)}</div>` : ""}
    <div class="field"><label>Email</label><input id="login-email" type="email"></div>
    <div class="field" style="margin-top:8px"><label>Password</label><input id="login-password" type="password"></div>
    <div class="login-actions"><button class="primary" id="login-go">Sign in</button></div>
  </div>`;
  document.body.appendChild(back);
  const signIn = async () => {
    const { error } = await auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
    back.remove();
    if (error) showLogin(error.message); else start();
  };
  $("login-go").onclick = signIn;
  $("login-password").onkeydown = (e) => { if (e.key === "Enter") signIn(); };
}

async function start() {
  const { data: { user }, error } = await auth.getUser();
  if (error || !user) {
    showLogin();
    return;
  }
  state.me = { name: displayName(user) };
  try {
    await loadUserRole(user.id);
  } catch (err) {
    state.role = "staff";
    state.isAdmin = false;
    showBanner("Could not load access level: " + err.message);
  }
  try {
    await loadCin7Settings();
  } catch {
    state.waitingDaysThreshold = 36;
  }
  $("view-admin").hidden = !state.isAdmin;
  $("signout").hidden = false;
  $("signout").onclick = async () => { await auth.signOut(); location.reload(); };
  initRepairViews();
  initAdmin();
  setView("board");
  await loadRepairs();
  watchChanges();
}

$("view-list").onclick = () => setView("list");
$("view-board").onclick = () => setView("board");
$("view-dashboard").onclick = () => setView("dashboard");
$("view-admin").onclick = () => { if (state.isAdmin) { setView("admin"); loadAdminData(); } };
$("search").oninput = renderActiveView;
$("add-repair").onclick = () => openRepair(null);
document.addEventListener("repairlab:show-archive", () => {
  setView("list");
  setListFilter("archived");
});
$("force-sync").onclick = async () => {
  setSyncState(true);
  showBanner("Syncing with Cin7 — this can take a few seconds…");
  try {
    const result = await forceSync();
    showBanner(`Synced. Orders added: ${result.orders?.added ?? 0}, updated: ${result.orders?.updated ?? 0}. Products saved: ${result.products?.productsSaved ?? 0}. Payment statuses updated: ${result.payments?.updated ?? 0}${result.payments?.invalidKeys ? `; ${result.payments.invalidKeys} repairs skipped (invalid Cin7 order ID)` : ""}${result.payments?.finished === false ? "; payment sync continues next run" : ""}.`);
  } catch (err) {
    showBanner(formatSyncError(err));
  } finally {
    setSyncState(false);
  }
};

const { data: { session } } = await auth.getSession();
if (session) start(); else showLogin();
