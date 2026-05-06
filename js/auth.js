/* ==========================================================================
   auth.js — Inicio de sesión con Google (Supabase OAuth) + modo local
   ========================================================================== */

(function () {
  "use strict";

  const SESSION_KEY = "cronograma.anteproyecto.session";

  /* -------------------- helpers -------------------- */
  function $(s, r = document) { return r.querySelector(s); }

  function setNote(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", kind === "error");
    el.classList.toggle("is-ok", kind === "ok");
  }

  function setLoading(btn, loading, originalText) {
    if (!btn) return;
    if (loading) {
      btn.dataset.original = btn.innerHTML;
      btn.innerHTML = `<span>${originalText || "Procesando..."}</span>`;
      btn.disabled = true;
    } else {
      if (btn.dataset.original) btn.innerHTML = btn.dataset.original;
      btn.disabled = false;
    }
  }

  /* -------------------- session storage (modo local) -------------------- */
  function saveLocalSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      user,
      mode: "local",
      at: Date.now()
    }));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  /* -------------------- Google OAuth via Supabase -------------------- */
  async function loginWithGoogle() {
    if (!window.supabaseClient) {
      throw new Error("Supabase no está configurado. Edita js/config.js para activar el inicio de sesión con Google, o continúa en modo local.");
    }
    /* Construye la URL de retorno usando URL para evitar dobles barras o concat erróneas */
    const base = new URL(window.location.href);
    /* sustituir el último segmento (/index.html, / o cualquier .html) por app.html */
    base.pathname = base.pathname.replace(/[^/]*$/, "app.html");
    base.search = ""; base.hash = "";
    const redirectTo = base.toString();

    const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) throw new Error(error.message);
    return data;
  }

  /* -------------------- handlers -------------------- */
  function bindGoogle() {
    const btn = $("#btn-google");
    const note = $("#note-login");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      setNote(note, "");
      setLoading(btn, true, "Redirigiendo a Google...");
      try {
        await loginWithGoogle();
        /* el navegador redirige a Google y vuelve a app.html */
      } catch (err) {
        setNote(note, err.message || "No se pudo iniciar sesión con Google.", "error");
        setLoading(btn, false);
      }
    });
  }

  /* Reutiliza el mismo guest-id en este navegador para que el invitado
     no pierda sus datos locales si vuelve a entrar después de cerrar sesión */
  const GUEST_ID_KEY = "cronograma.anteproyecto.guest-id";
  function getOrCreateGuestId() {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = "guest-" + crypto.randomUUID();
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  }

  function bindGuest() {
    const btn = $("#btn-guest");
    if (!btn) return;
    btn.addEventListener("click", () => {
      saveLocalSession({
        id: getOrCreateGuestId(),
        email: "invitado@local",
        user_metadata: { name: "Invitado", university: "", program: "" }
      });
      window.location.href = "app.html";
    });
  }

  /* -------------------- API global usada por app.html -------------------- */
  window.AUTH = {
    async getCurrentUser() {
      if (window.APP_CONFIG.isCloudReady && window.supabaseClient) {
        const { data } = await window.supabaseClient.auth.getUser();
        if (data?.user) return data.user;
      }
      const s = getSession();
      return s?.user || null;
    },
    async logout() {
      if (window.APP_CONFIG.isCloudReady && window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
      }
      clearSession();
      window.location.href = "index.html";
    },
    isCloud() { return !!window.APP_CONFIG.isCloudReady && !!window.supabaseClient; }
  };

  /* -------------------- init (solo en index.html) -------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    if (!$("#btn-google")) return; /* no estamos en index */

    /* Si ya hay sesión activa, redirige */
    const user = await window.AUTH.getCurrentUser();
    if (user) { window.location.href = "app.html"; return; }

    bindGoogle();
    bindGuest();

    if (!window.APP_CONFIG.isCloudReady) {
      const note = $("#note-login");
      setNote(note, "ℹ︎ Modo local activo. Configura Supabase en js/config.js para habilitar el inicio de sesión con Google.", "ok");
    }
  });
})();
