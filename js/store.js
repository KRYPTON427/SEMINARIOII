/* ==========================================================================
   store.js — Capa de datos (Supabase con fallback a localStorage)
   --------------------------------------------------------------------------
   Modelo:
     project   { id, user_id, title, author, university, program, advisor,
                 start_date, end_date, today_override, created_at }
     phase     { id, project_id, title, objective, color, order_index }
     activity  { id, project_id, phase_id, parent_id, title, description,
                 start_date, end_date, status, priority, predecessor_id,
                 progress, order_index }
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "cronograma.anteproyecto.data.v1";
  const sb = () => window.supabaseClient;
  const cloud = () => window.APP_CONFIG?.isCloudReady && !!sb();

  /* ==================================================================
     LOCAL STORE
     ================================================================== */
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null") || { projects: [], phases: [], activities: [] }; }
    catch (e) { return { projects: [], phases: [], activities: [] }; }
  }
  function lsWrite(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }
  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      ("id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  }

  /* ==================================================================
     PROJECTS
     ================================================================== */
  async function listProjects(userId) {
    if (cloud()) {
      const { data, error } = await sb()
        .from("projects").select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }
    const d = lsRead();
    return d.projects.filter(p => p.user_id === userId)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }

  async function createProject(userId, payload) {
    const project = {
      id: uid(),
      user_id: userId,
      title:        payload.title       || "Nuevo cronograma de anteproyecto",
      author:       payload.author      || "",
      university:   payload.university  || "",
      program:      payload.program     || "",
      advisor:      payload.advisor     || "",
      start_date:   payload.start_date  || todayISO(),
      end_date:     payload.end_date    || addWeeksISO(todayISO(), 32),
      today_override: null,
      created_at:   new Date().toISOString()
    };
    if (cloud()) {
      const insert = { ...project };
      delete insert.id; /* deja que postgres genere uuid */
      const { data, error } = await sb().from("projects").insert(insert).select().single();
      if (error) throw error;
      return data;
    }
    const d = lsRead();
    d.projects.push(project);
    lsWrite(d);
    return project;
  }

  async function updateProject(id, patch) {
    if (cloud()) {
      const { data, error } = await sb().from("projects").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    }
    const d = lsRead();
    const p = d.projects.find(x => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    lsWrite(d);
    return p;
  }

  async function deleteProject(id) {
    if (cloud()) {
      await sb().from("activities").delete().eq("project_id", id);
      await sb().from("phases").delete().eq("project_id", id);
      const { error } = await sb().from("projects").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const d = lsRead();
    d.activities = d.activities.filter(a => a.project_id !== id);
    d.phases     = d.phases.filter(p => p.project_id !== id);
    d.projects   = d.projects.filter(p => p.id !== id);
    lsWrite(d);
  }

  /* ==================================================================
     PHASES
     ================================================================== */
  async function listPhases(projectId) {
    if (cloud()) {
      const { data, error } = await sb()
        .from("phases").select("*")
        .eq("project_id", projectId)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return data || [];
    }
    const d = lsRead();
    return d.phases.filter(p => p.project_id === projectId)
      .sort((a, b) => a.order_index - b.order_index);
  }

  async function createPhase(projectId, payload) {
    const phases = await listPhases(projectId);
    const phase = {
      id: uid(),
      project_id: projectId,
      title:       payload.title || `Fase ${phases.length + 1}`,
      objective:   payload.objective || "",
      color:       payload.color || pickPhaseColor(phases.length),
      order_index: phases.length
    };
    if (cloud()) {
      const insert = { ...phase }; delete insert.id;
      const { data, error } = await sb().from("phases").insert(insert).select().single();
      if (error) throw error;
      return data;
    }
    const d = lsRead();
    d.phases.push(phase);
    lsWrite(d);
    return phase;
  }

  async function updatePhase(id, patch) {
    if (cloud()) {
      const { data, error } = await sb().from("phases").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    }
    const d = lsRead();
    const p = d.phases.find(x => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    lsWrite(d);
    return p;
  }

  async function deletePhase(id, opts = { withActivities: true }) {
    if (cloud()) {
      if (opts.withActivities) {
        /* borra todas las actividades (y sus subactividades) de la fase */
        const { data: phaseActs } = await sb().from("activities").select("id").eq("phase_id", id);
        const phaseIds = (phaseActs || []).map(a => a.id);
        if (phaseIds.length) {
          /* limpiar dependencias y subactividades (CASCADE en parent_id ya lo cubre) */
          await sb().from("activities").update({ predecessor_id: null }).in("predecessor_id", phaseIds);
          await sb().from("activities").delete().eq("phase_id", id);
        }
      } else {
        await sb().from("activities").update({ phase_id: null }).eq("phase_id", id);
      }
      const { error } = await sb().from("phases").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const d = lsRead();
    if (opts.withActivities) {
      const toDeleteIds = new Set(d.activities.filter(a => a.phase_id === id).map(a => a.id));
      /* incluir subactividades */
      d.activities.forEach(a => { if (toDeleteIds.has(a.parent_id)) toDeleteIds.add(a.id); });
      /* limpiar dependencias rotas */
      d.activities.forEach(a => { if (toDeleteIds.has(a.predecessor_id)) a.predecessor_id = null; });
      d.activities = d.activities.filter(a => !toDeleteIds.has(a.id));
    } else {
      d.activities.forEach(a => { if (a.phase_id === id) a.phase_id = null; });
    }
    d.phases = d.phases.filter(p => p.id !== id);
    lsWrite(d);
  }

  /* ==================================================================
     ACTIVITIES
     ================================================================== */
  async function listActivities(projectId) {
    if (cloud()) {
      const { data, error } = await sb()
        .from("activities").select("*")
        .eq("project_id", projectId)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return data || [];
    }
    const d = lsRead();
    return d.activities.filter(a => a.project_id === projectId)
      .sort((a, b) => a.order_index - b.order_index);
  }

  async function createActivity(projectId, payload) {
    const all = await listActivities(projectId);
    const activity = {
      id: uid(),
      project_id: projectId,
      phase_id:    payload.phase_id || null,
      parent_id:   payload.parent_id || null,
      title:       payload.title || "Nueva actividad",
      description: payload.description || "",
      start_date:  payload.start_date,
      end_date:    payload.end_date,
      status:      payload.status   || "pending",
      priority:    payload.priority || "medium",
      predecessor_id: payload.predecessor_id || null,
      progress:    payload.progress || 0,
      order_index: all.length
    };
    if (cloud()) {
      const insert = { ...activity }; delete insert.id;
      const { data, error } = await sb().from("activities").insert(insert).select().single();
      if (error) throw error;
      return data;
    }
    const d = lsRead();
    d.activities.push(activity);
    lsWrite(d);
    return activity;
  }

  async function updateActivity(id, patch) {
    if (cloud()) {
      const { data, error } = await sb().from("activities").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    }
    const d = lsRead();
    const a = d.activities.find(x => x.id === id);
    if (!a) return null;
    Object.assign(a, patch);
    lsWrite(d);
    return a;
  }

  async function deleteActivity(id) {
    if (cloud()) {
      /* limpiar dependencias y subactividades */
      await sb().from("activities").update({ predecessor_id: null }).eq("predecessor_id", id);
      await sb().from("activities").delete().eq("parent_id", id);
      const { error } = await sb().from("activities").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const d = lsRead();
    d.activities.forEach(a => { if (a.predecessor_id === id) a.predecessor_id = null; });
    d.activities = d.activities.filter(a => a.id !== id && a.parent_id !== id);
    lsWrite(d);
  }

  async function reorderActivities(orderedIds) {
    if (cloud()) {
      /* hacemos updates secuenciales — dataset pequeño */
      for (let i = 0; i < orderedIds.length; i++) {
        await sb().from("activities").update({ order_index: i }).eq("id", orderedIds[i]);
      }
      return;
    }
    const d = lsRead();
    orderedIds.forEach((id, i) => {
      const a = d.activities.find(x => x.id === id);
      if (a) a.order_index = i;
    });
    lsWrite(d);
  }

  /* ==================================================================
     HELPERS
     ================================================================== */
  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function addMonthsISO(iso, months) {
    const d = new Date(iso + "T00:00:00");
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function addWeeksISO(iso, weeks) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + weeks * 7);
    return d.toISOString().slice(0, 10);
  }
  function pickPhaseColor(idx) {
    const palette = [
      "#3b82f6", "#06b6d4", "#8b5cf6", "#10b981",
      "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"
    ];
    return palette[idx % palette.length];
  }

  /* ==================================================================
     EXPORT
     ================================================================== */
  window.STORE = {
    listProjects, createProject, updateProject, deleteProject,
    listPhases,   createPhase,   updatePhase,   deletePhase,
    listActivities, createActivity, updateActivity, deleteActivity, reorderActivities,
    isCloud: cloud,
    todayISO, addMonthsISO, addWeeksISO
  };
})();
