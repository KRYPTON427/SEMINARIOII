# Cronograma de Anteproyecto

> Diagrama de Gantt para organizar el cronograma de un anteproyecto / trabajo de grado.
> Stack: HTML + CSS + JS vainilla · Supabase (Auth + Postgres) · jsPDF.
> Listo para desplegar en **Vercel**.

---

## Tabla de contenido

1. [Pre-requisitos](#pre-requisitos)
2. [Setup de Supabase](#setup-de-supabase)
3. [Setup de Google OAuth](#setup-de-google-oauth)
4. [Configurar la app](#configurar-la-app)
5. [Desplegar en Vercel](#desplegar-en-vercel)
6. [Smoke test final](#smoke-test-final)
7. [Estructura del proyecto](#estructura-del-proyecto)

---

## Pre-requisitos

- Cuenta en [Supabase](https://supabase.com) (free tier basta)
- Cuenta en [Google Cloud](https://console.cloud.google.com) (para OAuth)
- Cuenta en [Vercel](https://vercel.com) (deploy gratuito)
- Git instalado localmente

---

## Setup de Supabase

### 1. Crear el proyecto

1. Entra en https://supabase.com → **New project**.
2. Elige un nombre (ej. `cronograma-anteproyecto`), una contraseña fuerte y una región cercana.
3. Espera ~2 min a que el proyecto esté provisionado.

### 2. Crear las tablas y políticas RLS

1. En el panel del proyecto: **SQL Editor → New query**.
2. Copia y pega TODO el contenido de [`supabase-schema.sql`](./supabase-schema.sql).
3. Click **RUN**.
4. Verifica en **Table editor** que aparecen 3 tablas: `projects`, `phases`, `activities`.

> El esquema activa Row Level Security: cada usuario solo ve sus propios datos. Las policies validan integridad cruzada (no se puede asignar `phase_id` de otro proyecto, etc.).

### 3. Copiar credenciales

Ve a **Project Settings → API** y copia:

- `Project URL` → la pegarás como `SUPABASE_URL`
- `anon public` → la pegarás como `SUPABASE_ANON_KEY`

> ⚠️ NUNCA copies la `service_role` key. Esa es solo para el servidor, no para frontend.

---

## Setup de Google OAuth

### 1. Crear credenciales OAuth en Google Cloud

1. https://console.cloud.google.com → crea o selecciona un proyecto.
2. **APIs & Services → OAuth consent screen**:
   - User Type: **External**
   - Nombre, email de soporte, scopes mínimos (email, profile, openid)
   - Publica la app (o agrega tu correo a "Test users" mientras esté en testing)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**:
     ```
     https://seminarioii.vercel.app
     https://tu-dominio-custom.com   (opcional)
     ```
   - **Authorized redirect URIs**: pega el callback que Supabase te indica (ver paso siguiente).

### 2. Conectar Google con Supabase

1. En Supabase: **Authentication → Providers → Google**.
2. Activa el toggle **Enable Sign in with Google**.
3. Pega el `Client ID` y `Client Secret` que generaste en Google Cloud.
4. Supabase te muestra una "Callback URL" — algo como
   `https://xxxxxx.supabase.co/auth/v1/callback`.
   Pégala en Google Cloud → tu OAuth client → **Authorized redirect URIs**.
5. Save.

### 3. Configurar URL del sitio en Supabase

**Authentication → URL Configuration**:

- `Site URL`: `https://seminarioii.vercel.app`
- `Redirect URLs` (whitelist):
  ```
  https://seminarioii.vercel.app
  https://seminarioii.vercel.app/app.html
  http://localhost:5500     (para desarrollo local con Live Server, opcional)
  http://localhost:5500/app.html
  ```

---

## Configurar la app

Edita `js/config.js` y reemplaza los placeholders:

```js
window.APP_CONFIG = {
  SUPABASE_URL:      "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIs…tu-key-larga",
  APP_NAME:          "Cronograma de Anteproyecto",
  STORAGE_KEY:       "cronograma.anteproyecto.v1"
};
```

> Si dejas los placeholders, la app funciona en **modo local** (datos en `localStorage` del navegador). Útil para demos sin backend.

---

## Desplegar en Vercel

### Opción A — desde la web

1. https://vercel.com/new → conecta tu repo de GitHub.
2. Framework preset: **Other** (es estático puro).
3. Build command: *(dejar en blanco)*
4. Output directory: *(dejar en blanco — usa la raíz)*
5. Deploy.

### Opción B — desde CLI

```bash
npm i -g vercel
cd cronograma
vercel        # primer deploy (preview)
vercel --prod # producción
```

El archivo [`vercel.json`](./vercel.json) ya configura:

- Headers de seguridad (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- Cache control (1 día para estáticos, sin cache para HTML)
- Redirección de `/cronograma` → `/`

> ⚠️ Si cambias el dominio Vercel, **acuérdate de actualizar** las URLs en Supabase (paso 3 de OAuth) y en Google Cloud (Authorized JavaScript origins).

---

## Smoke test final

Antes de declarar "listo para usar", verifica este flujo en producción:

- [ ] Abrir `https://<dominio>.vercel.app/` carga el login con Google
- [ ] Click en "Continuar con Google" abre el popup, autorizas, vuelve al sitio en `app.html`
- [ ] Aparece tu nombre y avatar arriba a la derecha
- [ ] El topbar muestra "Nube · Supabase" (no "Local")
- [ ] Click en `+` (nuevo proyecto) → llena el formulario → guarda
- [ ] Cargar plantilla "★ Trabajo de grado completo · 32 semanas" → aparecen 6 fases con 32 actividades
- [ ] Editar una actividad: cambiar estado, prioridad, fechas → todo persiste tras refrescar
- [ ] Borrar una actividad → suena el sonido de delete, aparece toast "Deshacer 10s"
- [ ] Click "Deshacer" antes de los 10s → la actividad vuelve
- [ ] Cambiar la fecha de Cierre del proyecto en el header → se actualiza
- [ ] Click "PDF · APA" → descarga PDF con portada, resumen, Gantt y tabla
- [ ] Cerrar sesión → vuelve al login
- [ ] Login en otro navegador con la misma cuenta Google → ves los mismos proyectos (sincronización funciona)

---

## Estructura del proyecto

```
cronograma/
├── index.html              # Login con Google
├── app.html                # Dashboard del Gantt
├── supabase-schema.sql     # Esquema SQL + RLS
├── vercel.json             # Configuración de Vercel (headers, cache)
├── README.md               # Este archivo
├── .gitignore
├── assets/
│   └── favicon.svg
├── css/
│   ├── auth.css            # Login + tokens
│   └── app.css             # Dashboard + Gantt + modales + toast
└── js/
    ├── config.js           # SUPABASE_URL + SUPABASE_ANON_KEY
    ├── auth.js             # Google OAuth + sesión local
    ├── store.js            # CRUD (Supabase + localStorage fallback)
    ├── gantt.js            # Render del diagrama
    ├── pdf.js              # Exportación PDF formato APA
    └── app.js              # Controlador principal
```

---

## Notas y limitaciones

- **HTTPS obligatorio**: Google OAuth requiere `https://`. En desarrollo usa Vercel preview o un túnel (ej. `ngrok`).
- **Modo local vs nube**: el botón "Continuar sin cuenta" guarda en `localStorage`. Esos datos NO se sincronizan ni se respaldan. Para producción real, usa Google.
- **PDF con muchos meses**: si el proyecto dura > ~2 meses, el Gantt se pagina horizontalmente para mantener legibilidad. Cada página tiene su cabecera completa.
- **Plantillas**: tres plantillas multi-fase listas — Intervención 16 sem, Cualitativa 16 sem, Trabajo de grado completo 32 sem.

---

## Créditos

Web desarrollada por **Albeiro Ramos** · Apoyo Seminario de Investigación II.
