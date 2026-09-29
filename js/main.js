// Start-up: sign-in, toolbar, and wiring the other modules together.
import { $, esc, showBanner, STATUSES } from "./util.js";
import { state, connect, loadRepairs, watchChanges, forceSync } from "./data.js";
import { renderRepairs, initRepairViews } from "./list.js";
import { renderDashboard } from "./dashboard.js";
import { openRepair, refreshHistory } from "./detail.js";

const renderActiveView = () => state.view === "dashboard" ? renderDashboard() : renderRepairs();
const auth = connect(() => { renderActiveView(); refreshHistory(); });

// "rob.gray@company.com" -> "Rob Gray" (used to sign history entries)
const displayName = (user) =>
  user.user_metadata?.name || (user.email || "Someone").split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function setView(view) {
  state.view = view;
  $("view-list").classList.toggle("active", view === "list");
  $("view-board").classList.toggle("active", view === "board");
  $("view-dashboard").classList.toggle("active", view === "dashboard");
  const isDashboard = view === "dashboard";
  $("search").hidden = isDashboard;
  $("filter-status").hidden = view === "board" || isDashboard;
  $("summary").hidden = isDashboard;
  renderActiveView();
}

function setSyncState(syncing) {
  const button = $("force-sync");
  button.disabled = syncing;
  button.textContent = syncing ? "Syncing…" : "⟳ Force sync";
  button.title = syncing ? "Sync in progress…" : "Re-check Cin7 for new orders and product changes";
}

function formatSyncError(err) {
  const message = err?.message || String(err || "Unknown sync error");
  return "Sync failed: " + message;
}

function showLogin(message) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal" style="max-width:360px">
    <h2>Sign in</h2>
    ${message ? `<div class="banner">${esc(message)}</div>` : ""}
    <div class="field"><label>Email</label><input id="login-email" type="email"></div>
    <div class="field" style="margin-top:8px"><label>Password</label><input id="login-password" type="password"></div>
    <div class="actions"><span></span><button class="primary" id="login-go">Sign in</button></div>
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
  const { data: { user } } = await auth.getUser();
  state.me = { name: displayName(user) };
  $("signout").hidden = false;
  $("signout").onclick = async () => { await auth.signOut(); location.reload(); };
  initRepairViews();
  setView("board");
  await loadRepairs();
  watchChanges();
}

$("filter-status").innerHTML = `<option value="">All statuses</option>` + STATUSES.map((s) => `<option>${s}</option>`).join("");
$("view-list").onclick = () => setView("list");
$("view-board").onclick = () => setView("board");
$("view-dashboard").onclick = () => setView("dashboard");
$("search").oninput = renderActiveView;
$("filter-status").onchange = renderActiveView;
$("add-repair").onclick = () => openRepair(null);
$("force-sync").onclick = async () => {
  setSyncState(true);
  showBanner("Syncing with Cin7 — this can take a few seconds…");
  try {
    const result = await forceSync();
    showBanner(`Synced. Orders added: ${result.orders?.added ?? 0}, updated: ${result.orders?.updated ?? 0}. Products saved: ${result.products?.productsSaved ?? 0}.`);
  } catch (err) {
    showBanner(formatSyncError(err));
  } finally {
    setSyncState(false);
  }
};

const { data: { session } } = await auth.getSession();
if (session) start(); else showLogin();
