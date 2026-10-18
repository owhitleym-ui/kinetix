/** Client auth helpers for the Kinetix ATP API (localStorage JWT). */

const TOKEN_KEY = "formcheck.token";
const USER_KEY = "formcheck.user";

export function atpBase() {
  if (typeof window !== "undefined" && window.FORM_CHECK_ATP) {
    return window.FORM_CHECK_ATP.replace(/\/$/, "");
  }
  return "http://127.0.0.1:3001";
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.removeItem("kinetix.demoUser");   // a real account replaces any demo sign-in
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function api(path, options = {}) {
  const headers = authHeaders({
    "Content-Type": "application/json",
    ...(options.headers || {}),
  });
  const res = await fetch(`${atpBase()}${path}`, { ...options, headers });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function login(email, password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setSession(data.token, data.user);
  return data.user;
}

export async function register({ email, password, displayName, role }) {
  const data = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName, role }),
  });
  setSession(data.token, data.user);
  return data.user;
}

export async function refreshMe() {
  const data = await api("/api/auth/me");
  const token = getToken();
  if (token) setSession(token, data.user);
  return data.user;
}

export function logout() {
  clearSession();
}

/** Update header account chip if #accountNav exists. */
export function renderAccountNav(root = document.getElementById("accountNav")) {
  if (!root) return;
  const user = getUser();
  if (!user) {
    root.innerHTML = `<a class="nav-link" href="login.html">Log in</a>`;
    return;
  }
  const perms =
    user.role === "patient"
      ? `<a class="nav-link" href="permissions.html">Permissions</a>`
      : "";
  root.innerHTML = `
    <span class="nav-user">${escapeHtml(user.displayName)} · ${user.role === "pt" ? "PT" : "Patient"}</span>
    ${perms}
    <button type="button" class="nav-link nav-btn" id="logoutBtn">Log out</button>
  `;
  root.querySelector("#logoutBtn")?.addEventListener("click", () => {
    logout();
    location.href = "login.html";
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
