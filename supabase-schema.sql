-- =============================================================================
-- supabase-schema.sql — Esquema y políticas RLS para Cronograma de Anteproyecto
-- -----------------------------------------------------------------------------
-- Cómo usar:
--   1. Crea un proyecto en https://supabase.com
--   2. Ve a "SQL Editor" → "New query"
--   3. Pega TODO este archivo y ejecútalo (RUN)
--   4. Copia tu URL del proyecto y la "anon public key" (Settings → API)
--   5. Pégalas en js/config.js
-- =============================================================================

-- =============================================================================
-- TABLA: projects
-- =============================================================================
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  author          text default '',
  university      text default '',
  program         text default '',
  advisor         text default '',
  start_date      date not null,
  end_date        date not null,
  today_override  date,
  created_at      timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects(user_id);

-- =============================================================================
-- TABLA: phases
-- =============================================================================
create table if not exists public.phases (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  objective    text default '',
  color        text default '#3b82f6',
  order_index  int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists phases_project_idx on public.phases(project_id);

-- =============================================================================
-- TABLA: activities
-- =============================================================================
create table if not exists public.activities (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  phase_id        uuid references public.phases(id) on delete set null,
  parent_id       uuid references public.activities(id) on delete cascade,
  title           text not null,
  description     text default '',
  start_date      date not null,
  end_date        date not null,
  status          text not null default 'pending'
                    check (status in ('pending','progress','completed')),
  priority        text not null default 'medium'
                    check (priority in ('low','medium','high','critical')),
  predecessor_id  uuid references public.activities(id) on delete set null,
  progress        int not null default 0 check (progress >= 0 and progress <= 100),
  order_index     int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists activities_project_idx on public.activities(project_id);
create index if not exists activities_phase_idx   on public.activities(phase_id);
create index if not exists activities_parent_idx  on public.activities(parent_id);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) — cada usuario solo ve sus datos
-- =============================================================================
alter table public.projects   enable row level security;
alter table public.phases     enable row level security;
alter table public.activities enable row level security;

-- ===== projects =====
drop policy if exists "projects: select own" on public.projects;
drop policy if exists "projects: insert own" on public.projects;
drop policy if exists "projects: update own" on public.projects;
drop policy if exists "projects: delete own" on public.projects;

create policy "projects: select own"
  on public.projects for select
  using (user_id = auth.uid());

create policy "projects: insert own"
  on public.projects for insert
  with check (user_id = auth.uid());

create policy "projects: update own"
  on public.projects for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "projects: delete own"
  on public.projects for delete
  using (user_id = auth.uid());

-- ===== phases (ownership via project) =====
drop policy if exists "phases: select own" on public.phases;
drop policy if exists "phases: insert own" on public.phases;
drop policy if exists "phases: update own" on public.phases;
drop policy if exists "phases: delete own" on public.phases;

create policy "phases: select own"
  on public.phases for select
  using (exists (select 1 from public.projects p where p.id = phases.project_id and p.user_id = auth.uid()));

create policy "phases: insert own"
  on public.phases for insert
  with check (exists (select 1 from public.projects p where p.id = phases.project_id and p.user_id = auth.uid()));

create policy "phases: update own"
  on public.phases for update
  using (exists (select 1 from public.projects p where p.id = phases.project_id and p.user_id = auth.uid()));

create policy "phases: delete own"
  on public.phases for delete
  using (exists (select 1 from public.projects p where p.id = phases.project_id and p.user_id = auth.uid()));

-- ===== activities (ownership via project + integridad cruzada) =====
drop policy if exists "activities: select own" on public.activities;
drop policy if exists "activities: insert own" on public.activities;
drop policy if exists "activities: update own" on public.activities;
drop policy if exists "activities: delete own" on public.activities;

create policy "activities: select own"
  on public.activities for select
  using (exists (select 1 from public.projects p where p.id = activities.project_id and p.user_id = auth.uid()));

-- Insert: además de ownership del project, validamos que phase_id, parent_id
-- y predecessor_id (si vienen) pertenezcan al MISMO project del usuario.
create policy "activities: insert own"
  on public.activities for insert
  with check (
    exists (select 1 from public.projects p where p.id = activities.project_id and p.user_id = auth.uid())
    and (activities.phase_id is null
         or exists (select 1 from public.phases ph
                    where ph.id = activities.phase_id
                      and ph.project_id = activities.project_id))
    and (activities.parent_id is null
         or exists (select 1 from public.activities a
                    where a.id = activities.parent_id
                      and a.project_id = activities.project_id))
    and (activities.predecessor_id is null
         or exists (select 1 from public.activities a
                    where a.id = activities.predecessor_id
                      and a.project_id = activities.project_id))
  );

create policy "activities: update own"
  on public.activities for update
  using (exists (select 1 from public.projects p where p.id = activities.project_id and p.user_id = auth.uid()))
  with check (
    exists (select 1 from public.projects p where p.id = activities.project_id and p.user_id = auth.uid())
    and (activities.phase_id is null
         or exists (select 1 from public.phases ph
                    where ph.id = activities.phase_id
                      and ph.project_id = activities.project_id))
    and (activities.parent_id is null
         or exists (select 1 from public.activities a
                    where a.id = activities.parent_id
                      and a.project_id = activities.project_id))
    and (activities.predecessor_id is null
         or exists (select 1 from public.activities a
                    where a.id = activities.predecessor_id
                      and a.project_id = activities.project_id))
  );

create policy "activities: delete own"
  on public.activities for delete
  using (exists (select 1 from public.projects p where p.id = activities.project_id and p.user_id = auth.uid()));

-- Índices compuestos para queries comunes
create index if not exists activities_project_order_idx
  on public.activities(project_id, order_index);
create index if not exists phases_project_order_idx
  on public.phases(project_id, order_index);

-- =============================================================================
-- LISTO. Copia tu URL y anon key en js/config.js y empieza a usar la app.
-- =============================================================================
