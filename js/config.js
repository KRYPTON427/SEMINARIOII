/* ==========================================================================
   config.js — Configuración de Supabase
   --------------------------------------------------------------------------
   Para activar el modo en la nube (datos por usuario, escalable):
   1) Crea un proyecto en https://supabase.com
   2) En Project Settings → API copia la URL y la "anon public key"
   3) Pega los valores abajo (reemplaza los placeholders)
   4) Ejecuta el archivo `supabase-schema.sql` en el SQL Editor de Supabase

   Si dejas los placeholders, la app funcionará en MODO LOCAL guardando
   los datos en localStorage del navegador (no se sincroniza entre dispositivos).
   ========================================================================== */

window.APP_CONFIG = {
  SUPABASE_URL:      "https://advdbhmntxzqbqtmjlde.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkdmRiaG1udHh6cWJxdG1qbGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzE1NDMsImV4cCI6MjA5MzYwNzU0M30.p2zxbY1HlICGIC6J13oOcPRz2mzL8D-QcyYeySkxsqg",

  APP_NAME:    "Cronograma de Anteproyecto",
  STORAGE_KEY: "cronograma.anteproyecto.v1"
};

/* Detección automática: si los valores siguen como placeholder → modo local */
window.APP_CONFIG.isCloudReady = (() => {
  const u = window.APP_CONFIG.SUPABASE_URL;
  const k = window.APP_CONFIG.SUPABASE_ANON_KEY;
  return !!u && !!k
    && !u.includes("YOUR-PROJECT")
    && !k.includes("YOUR-ANON-PUBLIC-KEY");
})();

/* Cliente Supabase (solo si está configurado) */
window.supabaseClient = null;
if (window.APP_CONFIG.isCloudReady && window.supabase) {
  window.supabaseClient = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );
}
