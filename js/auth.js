/* ==========================================================================
   auth.js — Inicio de sesión exclusivo con Google (Supabase OAuth)
   ========================================================================== */

(function () {
  "use strict";

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

  /* -------------------- Google OAuth via Supabase -------------------- */
  async function loginWithGoogle() {
    if (!window.supabaseClient) {
      throw new Error("Supabase no está configurado. Edita js/config.js para activar el inicio de sesión con Google.");
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

  /* -------------------- API global usada por app.html -------------------- */
  window.AUTH = {
    async getCurrentUser() {
      if (window.APP_CONFIG.isCloudReady && window.supabaseClient) {
        const { data } = await window.supabaseClient.auth.getUser();
        return data?.user || null;
      }
      return null;
    },
    async logout() {
      if (window.APP_CONFIG.isCloudReady && window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
      }
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

    if (!window.APP_CONFIG.isCloudReady) {
      const note = $("#note-login");
      setNote(note, "⚠ Supabase no está configurado. Edita js/config.js con tu URL y anon key para habilitar el inicio de sesión con Google.", "error");
      const btn = $("#btn-google");
      if (btn) btn.disabled = true;
    }
  });
})();
