// Start-up: sign-in, toolbar, and wiring the other modules together.
import { $, esc, showBanner, STATUSES } from "./util.js";
import { state, connect, loadRepairs, watchChanges } from "./data.js";
import { renderRepairs, initRepairViews } from "./list.js";
import { openRepair, refreshHistory } from "./detail.js";

const auth = connect(() => { renderRepairs(); refreshHistory(); });

// "rob.gray@company.com" -> "Rob Gray" (used to sign history entries)
const displayName = (user) =>
  user.user_metadata?.name || (user.email || "Someone").split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function setView(view) {
  state.view = view;
  $("view-list").classList.toggle("active", view === "list");
  $("view-board").classList.toggle("active", view === "board");
  $("filter-status").hidden = view === "board"; // the board already shows one column per status
  renderRepairs();
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
  await loadRepairs();
  watchChanges();
}

$("filter-status").innerHTML = `<option value="">All statuses</option>` + STATUSES.map((s) => `<option>${s}</option>`).join("");
$("view-list").onclick = () => setView("list");
$("view-board").onclick = () => setView("board");
$("search").oninput = renderRepairs;
$("filter-status").onchange = renderRepairs;
$("add-repair").onclick = () => openRepair(null);

const { data: { session } } = await auth.getSession();
if (session) start(); else showLogin();
