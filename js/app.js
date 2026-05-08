/* ==========================================================================
   app.js — Controlador principal del dashboard
   --------------------------------------------------------------------------
   - Carga el usuario actual (Supabase o local). Si no hay sesión → /index.html
   - Lista los proyectos, permite crear / editar / eliminar
   - Renderiza el Gantt, gestiona modales (proyecto, fase, actividad)
   - Detecta cruces y dependencias rotas → pinta alertas
   - Dispara exportación a PDF
   ========================================================================== */

(function () {
  "use strict";

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    user: null,
    projects: [],
    currentProject: null,
    phases: [],
    activities: []
  };

  /* ============================================================
     SHORTHANDS
     ============================================================ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener("DOMContentLoaded", async () => {
    /* auth gate */
    state.user = await window.AUTH.getCurrentUser();
    if (!state.user) {
      window.location.href = "index.html";
      return;
    }
    paintUser();
    paintModePill();

    /* cargar proyectos */
    await loadProjects();

    if (state.projects.length === 0) {
      /* no tiene proyectos: abrir modal para crear el primero */
      openProjectModal();
    } else {
      /* pick first */
      await selectProject(state.projects[0].id);
    }

    bindGlobalEvents();
  });

  /* ============================================================
     USER & MODE
     ============================================================ */
  function paintUser() {
    const u = state.user;
    const name = u.user_metadata?.name || u.email?.split("@")[0] || "Usuario";
    $("#user-name").textContent  = name;
    $("#user-email").textContent = u.email || "—";
    $("#user-avatar").textContent = name.slice(0, 1).toUpperCase();
  }

  function paintModePill() {
    const pill = $("#mode-pill");
    if (window.AUTH.isCloud()) {
      pill.textContent = "Nube · Supabase";
      pill.dataset.mode = "cloud";
      pill.title = "Tus datos se guardan en Supabase y se sincronizan entre dispositivos.";
    } else {
      pill.textContent = "Local";
      pill.dataset.mode = "local";
      pill.title = "Modo local: los datos se guardan solo en este navegador. Configura Supabase en js/config.js para sincronizar.";
    }
  }

  /* ============================================================
     PROJECTS
     ============================================================ */
  async function loadProjects() {
    state.projects = await window.STORE.listProjects(state.user.id);
    paintProjectSelect();
  }

  function paintProjectSelect() {
    const sel = $("#project-select");
    if (state.projects.length === 0) {
      sel.innerHTML = `<option value="">— Sin proyectos —</option>`;
      return;
    }
    sel.innerHTML = state.projects.map(p =>
      `<option value="${p.id}" ${state.currentProject?.id === p.id ? "selected" : ""}>${escapeHtml(p.title)}</option>`
    ).join("");
  }

  async function selectProject(id) {
    state.currentProject = state.projects.find(p => p.id === id) || null;
    if (!state.currentProject) return;
    paintProjectSelect();
    await loadPhasesAndActivities();
    paintHero();
    paintPhaseList();
    renderGantt();
  }

  async function loadPhasesAndActivities() {
    const [phases, activities] = await Promise.all([
      window.STORE.listPhases(state.currentProject.id),
      window.STORE.listActivities(state.currentProject.id)
    ]);
    state.phases = phases;
    state.activities = activities;
  }

  /* ============================================================
     HERO
     ============================================================ */
  function paintHero() {
    const p = state.currentProject;
    if (!p) return;
    $("#hero-title").textContent = p.title || "Cronograma de anteproyecto";
    const subParts = [];
    if (p.author) subParts.push(p.author);
    if (p.program) subParts.push(p.program);
    if (p.university) subParts.push(p.university);
    $("#hero-sub").textContent = subParts.join(" · ") || "Trabajo de grado";

    $("#hero-pill-text").textContent =
      p.advisor ? `Director(a): ${p.advisor}` : "Trabajo de grado";

    /* inputs de fecha editables */
    const startInput = $("#meta-start");
    const endInput   = $("#meta-end");
    if (startInput) startInput.value = p.start_date || "";
    if (endInput)   endInput.value   = p.end_date   || "";

    const days = Math.max(0, diffDays(p.start_date, p.end_date) + 1);
    const weeks = Math.ceil(days / 7);
    $("#meta-weeks").textContent = `${weeks} sem · ${days} días`;

    const total = state.activities.length;
    const avg = total
      ? Math.round(state.activities.reduce((s, a) => s + (parseInt(a.progress || 0, 10)), 0) / total)
      : 0;
    $("#meta-progress").textContent = `${avg}%`;
  }

  /* ============================================================
     SIDEBAR (PHASES + TEMPLATES)
     ============================================================ */
  function paintPhaseList() {
    const ul = $("#phase-list");
    if (state.phases.length === 0) {
      ul.innerHTML = `<li style="color:var(--ink-mute); font-size:0.82rem; padding:0.6rem 0;">
        Aún no has creado fases. Usa <b>+ Fase</b> o las plantillas de abajo.
      </li>`;
      return;
    }
    ul.innerHTML = state.phases.map(p => {
      const count = state.activities.filter(a => a.phase_id === p.id).length;
      return `
        <li class="phase-item" data-phase-id="${p.id}" title="Click para editar / renombrar la fase">
          <span class="phase-item__bar" style="background:${p.color}"></span>
          <span class="phase-item__body">
            <strong>${escapeHtml(p.title)}</strong>
            <small>${count} actividad${count === 1 ? "" : "es"}${p.objective ? " · " + escapeHtml(p.objective).slice(0, 60) : ""}</small>
          </span>
          <span class="phase-item__menu">
            <button data-action="edit" title="Renombrar / editar fase" aria-label="Renombrar fase">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button data-action="delete" title="Eliminar fase" aria-label="Eliminar fase">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </span>
        </li>
      `;
    }).join("");

    ul.querySelectorAll(".phase-item").forEach(li => {
      const id = li.dataset.phaseId;
      li.addEventListener("click", (e) => {
        if (e.target.closest("[data-action]")) return;
        openPhaseModal(id);
      });
      li.querySelector('[data-action="edit"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openPhaseModal(id);
      });
      li.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        await deletePhaseWithConfirm(id);
      });
    });
  }

  /* ============================================================
     ELIMINAR ACTIVIDAD con confirmación + UNDO 10 s
     ============================================================ */
  async function deleteActivityWithUndo(id) {
    const a = state.activities.find(x => x.id === id);
    if (!a) return;
    const subs = state.activities.filter(x => x.parent_id === id);

    /* snapshot para poder deshacer */
    const snapshot = {
      activity: { ...a },
      subs: subs.map(s => ({ ...s }))
    };

    /* eliminar (sin confirmar dos veces — la red de seguridad es el undo) */
    try {
      await window.STORE.deleteActivity(id);
      await loadPhasesAndActivities();
      paintHero(); paintPhaseList(); renderGantt();
      playSound("delete");

      window.APP_UI.showUndoToast({
        message: `Actividad eliminada: «${a.title}»`,
        sublabel: subs.length ? `Y ${subs.length} sub-actividad(es) · Tienes 10 s para deshacer` : "Tienes 10 s para deshacer",
        onUndo: async () => {
          /* recrea actividad principal */
          const recreated = await window.STORE.createActivity(state.currentProject.id, {
            title:          snapshot.activity.title,
            description:    snapshot.activity.description,
            phase_id:       snapshot.activity.phase_id,
            parent_id:      snapshot.activity.parent_id,
            start_date:     snapshot.activity.start_date,
            end_date:       snapshot.activity.end_date,
            status:         snapshot.activity.status,
            priority:       snapshot.activity.priority,
            predecessor_id: snapshot.activity.predecessor_id,
            progress:       snapshot.activity.progress
          });
          /* recrea sub-actividades reapuntando al nuevo parent */
          for (const s of snapshot.subs) {
            await window.STORE.createActivity(state.currentProject.id, {
              title:       s.title,
              description: s.description,
              phase_id:    s.phase_id,
              parent_id:   recreated.id,
              start_date:  s.start_date,
              end_date:    s.end_date,
              status:      s.status,
              priority:    s.priority,
              progress:    s.progress
            });
          }
          await loadPhasesAndActivities();
          paintHero(); paintPhaseList(); renderGantt();
        }
      });
    } catch (err) {
      appAlert({ kind: "danger", title: "Error al eliminar", message: err.message || String(err) });
    }
  }

  /* ============================================================
     ELIMINAR FASE (con confirmación + borrado en cascada + UNDO)
     ============================================================ */
  async function deletePhaseWithConfirm(phaseId) {
    const phase = state.phases.find(p => p.id === phaseId);
    if (!phase) return;
    const acts = state.activities.filter(a => a.phase_id === phaseId);
    const subCount = state.activities.filter(a =>
      acts.some(p => p.id === a.parent_id)
    ).length;

    const ok = await appConfirm({
      kind: "danger",
      title: `Eliminar la fase «${phase.title}»`,
      message: acts.length
        ? `Se eliminarán también ${acts.length} actividad(es)${subCount ? ` y ${subCount} sub-actividad(es)` : ""} pertenecientes a esta fase. Esta acción no se puede deshacer.`
        : "La fase se eliminará. Esta acción no se puede deshacer.",
      list: acts.length ? acts.slice(0, 8).map(a => "• " + a.title) : null,
      okText: "Eliminar fase",
      cancelText: "Cancelar"
    });
    if (!ok) return;
    /* snapshot completo para deshacer */
    const snapshot = {
      phase: { ...phase },
      acts: acts.map(a => ({ ...a })),
      subs: state.activities.filter(a => acts.some(p => p.id === a.parent_id)).map(s => ({ ...s }))
    };
    try {
      await window.STORE.deletePhase(phaseId, { withActivities: true });
      hideModal($("#modal-phase"));
      await loadPhasesAndActivities();
      paintHero(); paintPhaseList(); renderGantt();
      playSound("delete");

      const totalDeleted = snapshot.acts.length + snapshot.subs.length;
      window.APP_UI.showUndoToast({
        message: `Fase eliminada: «${snapshot.phase.title}»`,
        sublabel: totalDeleted
          ? `Y ${snapshot.acts.length} actividad(es)${snapshot.subs.length ? ` + ${snapshot.subs.length} sub` : ""} · Tienes 10 s para deshacer`
          : "Tienes 10 s para deshacer",
        onUndo: async () => {
          /* recrear fase */
          const newPhase = await window.STORE.createPhase(state.currentProject.id, {
            title:     snapshot.phase.title,
            objective: snapshot.phase.objective,
            color:     snapshot.phase.color
          });
          /* recrear actividades principales primero */
          const idMap = new Map();   /* old id → new id */
          for (const a of snapshot.acts) {
            const created = await window.STORE.createActivity(state.currentProject.id, {
              title:       a.title,
              description: a.description,
              phase_id:    newPhase.id,
              start_date:  a.start_date,
              end_date:    a.end_date,
              status:      a.status,
              priority:    a.priority,
              progress:    a.progress
            });
            idMap.set(a.id, created.id);
          }
          /* luego sub-actividades reapuntando parent_id */
          for (const s of snapshot.subs) {
            await window.STORE.createActivity(state.currentProject.id, {
              title:       s.title,
              description: s.description,
              phase_id:    newPhase.id,
              parent_id:   idMap.get(s.parent_id) || null,
              start_date:  s.start_date,
              end_date:    s.end_date,
              status:      s.status,
              priority:    s.priority,
              progress:    s.progress
            });
          }
          await loadPhasesAndActivities();
          paintHero(); paintPhaseList(); renderGantt();
        }
      });
    } catch (err) { appAlert({ kind: "danger", title: "Error", message: err.message || String(err) }); }
  }

  /* ============================================================
     GANTT
     ============================================================ */
  function renderGantt() {
    const host = $("#gantt");
    if (!state.currentProject) {
      host.innerHTML = "";
      return;
    }
    /* fusionamos el modo de etiquetas (real / relativo) que se elige
       en el select del topbar — se persiste en localStorage */
    const dateLabelMode = localStorage.getItem("gnt.dateLabelMode") || "real";
    const projectWithMode = { ...state.currentProject, date_label_mode: dateLabelMode };
    window.GanttView.render(host, projectWithMode, state.phases, state.activities, {
      onAddActivity: (prefill) => openActivityModal(null, prefill || {}),
      onEditActivity: (id) => openActivityModal(id),
      onAddSubActivity: (parentId) => {
        const parent = state.activities.find(a => a.id === parentId);
        openActivityModal(null, {
          parent_id: parentId,
          phase_id:  parent?.phase_id || null,
          start_date: parent?.start_date,
          end_date:   parent?.end_date,
          title: ""
        });
      },
      onDeleteActivity: async (id) => {
        await deleteActivityWithUndo(id);
      },
      onUpdateActivity: async (id, patch) => {
        /* Mutación optimista: actualizamos en memoria y re-renderizamos
           sin refetch (evita un round-trip extra a Supabase por cada cambio). */
        const idx = state.activities.findIndex(x => x.id === id);
        const prev = idx >= 0 ? { ...state.activities[idx] } : null;
        if (idx >= 0) {
          state.activities[idx] = { ...state.activities[idx], ...patch };
          paintHero();
          renderGantt();
        }
        try {
          await window.STORE.updateActivity(id, patch);
        } catch (e) {
          /* rollback si falla */
          if (prev && idx >= 0) {
            state.activities[idx] = prev;
            paintHero();
            renderGantt();
          }
          console.error(e);
          appAlert({ kind: "danger", title: "Error al guardar", message: e.message || String(e) });
        }
      },
      onAddPhase: () => openPhaseModal(null),
      onEditPhase: (id) => openPhaseModal(id),
      onDeletePhase: (id) => deletePhaseWithConfirm(id),
      onIssues: (issues) => paintAlerts(issues)
    });
  }

  /* ============================================================
     ALERTS
     ============================================================ */
  /* recordamos el conjunto de problemas previo para sonar SOLO
     cuando aparece uno nuevo (no en cada repintado) */
  let _lastIssuesKey = "";

  function paintAlerts({ overlaps, violations }) {
    const box = $("#alerts");
    const cards = [];

    /* clave única del estado actual de problemas */
    const overlapKeys = overlaps.map(([a, b]) => [a.id, b.id].sort().join("·")).sort();
    const violKeys    = violations.map(v => v.activity.id + "→" + v.predecessor.id).sort();
    const currentKey  = JSON.stringify({ ov: overlapKeys, vi: violKeys });

    /* si hay problemas nuevos respecto al último render → sonido */
    if (currentKey !== _lastIssuesKey && (overlaps.length || violations.length)) {
      const prev = _lastIssuesKey ? JSON.parse(_lastIssuesKey) : { ov: [], vi: [] };
      const newOverlaps = overlapKeys.some(k => !prev.ov.includes(k));
      const newViols    = violKeys.some(k => !prev.vi.includes(k));
      if (newOverlaps || newViols) playSound("warn");
    }
    _lastIssuesKey = currentKey;

    const ICON_DANGER = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
    const ICON_WARN   = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`;

    if (violations.length) {
      const lines = violations.map(v =>
        `<li><b>${escapeHtml(v.activity.title)}</b> inicia antes que su predecesora <b>${escapeHtml(v.predecessor.title)}</b>.</li>`
      ).join("");
      cards.push(`
        <div class="alert alert--danger">
          ${ICON_DANGER}
          <div><b>Dependencia rota:</b> una actividad no puede iniciar antes que su predecesora.<ul style="margin:0.3rem 0 0 1rem; padding:0;">${lines}</ul></div>
        </div>
      `);
    }

    if (overlaps.length) {
      const seen = new Set();
      const dedup = overlaps.filter(([a, b]) => {
        const k = [a.id, b.id].sort().join("·");
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).slice(0, 6);
      const lines = dedup.map(([a, b]) =>
        `<li><b>${escapeHtml(a.title)}</b> ↔ <b>${escapeHtml(b.title)}</b> (${a.start_date} → ${a.end_date} vs ${b.start_date} → ${b.end_date})</li>`
      ).join("");
      cards.push(`
        <div class="alert alert--warn">
          ${ICON_WARN}
          <div><b>Cruce de actividades:</b> hay ${overlaps.length} solape(s) entre actividades en el mismo día.<ul style="margin:0.3rem 0 0 1rem; padding:0;">${lines}</ul></div>
          <button class="alert__close" data-close-alerts>×</button>
        </div>
      `);
    }

    if (cards.length === 0) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = cards.join("");
    box.querySelectorAll("[data-close-alerts]").forEach(b => {
      b.addEventListener("click", () => box.hidden = true);
    });
  }

  /* ============================================================
     MODAL: PROJECT
     ============================================================ */
  function openProjectModal(projectId = null) {
    const modal = $("#modal-project");
    const form = $("#form-project");
    form.reset();
    const isEdit = !!projectId;
    $("#project-modal-title").textContent = isEdit ? "Editar proyecto" : "Nuevo proyecto";

    if (isEdit) {
      const p = state.projects.find(x => x.id === projectId);
      if (!p) return;
      form.id.value = p.id;
      form.title.value = p.title || "";
      form.author.value = p.author || "";
      form.advisor.value = p.advisor || "";
      form.university.value = p.university || "";
      form.program.value = p.program || "";
      form.start_date.value = p.start_date || "";
      form.end_date.value = p.end_date || "";
    } else {
      form.id.value = "";
      form.author.value     = state.user.user_metadata?.name || "";
      form.university.value = state.user.user_metadata?.university || "";
      form.program.value    = state.user.user_metadata?.program || "";
      form.start_date.value = window.STORE.todayISO();
      form.end_date.value   = window.STORE.addWeeksISO(window.STORE.todayISO(), 32);
    }
    showModal(modal);
  }

  /* ============================================================
     MODAL: PHASE
     ============================================================ */
  function openPhaseModal(phaseId = null) {
    const modal = $("#modal-phase");
    const form = $("#form-phase");
    form.reset();
    const isEdit = !!phaseId;
    $("#phase-modal-title").textContent = isEdit ? "Editar fase" : "Nueva fase";
    /* Botón eliminar: solo en edición */
    const delBtn = $("#btn-delete-phase");
    delBtn.hidden = !isEdit;
    delBtn.dataset.targetId = phaseId || "";

    if (isEdit) {
      const p = state.phases.find(x => x.id === phaseId);
      if (!p) return;
      form.id.value = p.id;
      form.title.value = p.title || "";
      form.objective.value = p.objective || "";
      form.color.value = p.color || "#3b82f6";
    } else {
      form.id.value = "";
      const palette = ["#3b82f6","#06b6d4","#8b5cf6","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6"];
      form.color.value = palette[state.phases.length % palette.length];
      form.title.value = `Fase ${state.phases.length + 1}`;
    }
    showModal(modal);
  }

  /* ============================================================
     MODAL: ACTIVITY
     ============================================================ */
  function openActivityModal(activityId = null, prefill = {}) {
    const modal = $("#modal-activity");
    const form = $("#form-activity");
    form.reset();
    const isEdit = !!activityId;
    $("#modal-title").textContent = isEdit ? "Editar actividad" : "Nueva actividad";
    /* Botón eliminar: solo en edición */
    const delBtn = $("#btn-delete-activity");
    delBtn.hidden = !isEdit;
    delBtn.dataset.targetId = activityId || "";

    /* poblar selects */
    const phaseSel = $("#sel-phase");
    phaseSel.innerHTML = `<option value="">— Sin fase —</option>` +
      state.phases.map(p => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join("");

    const parentSel = $("#sel-parent");
    parentSel.innerHTML = `<option value="">— Ninguna —</option>` +
      state.activities
        .filter(a => !a.parent_id && a.id !== activityId)
        .map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join("");

    const predSel = $("#sel-predecessor");
    predSel.innerHTML = `<option value="">— Ninguna —</option>` +
      state.activities.filter(a => a.id !== activityId)
        .map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join("");

    if (isEdit) {
      const a = state.activities.find(x => x.id === activityId);
      if (!a) return;
      form.id.value = a.id;
      form.title.value = a.title || "";
      form.description.value = a.description || "";
      form.start_date.value = a.start_date || "";
      form.end_date.value = a.end_date || "";
      form.phase_id.value = a.phase_id || "";
      form.parent_id.value = a.parent_id || "";
      form.status.value = a.status || "pending";
      form.priority.value = a.priority || "medium";
      form.predecessor_id.value = a.predecessor_id || "";
      form.progress.value = a.progress || 0;
    } else {
      form.id.value = "";
      const startDef = prefill.start_date || state.currentProject.start_date;
      /* Por defecto la actividad dura 7 días — más útil que 0 días */
      let endDef = prefill.end_date;
      if (!endDef) {
        const d = new Date(startDef + "T00:00:00");
        d.setDate(d.getDate() + 6);
        endDef = d.toISOString().slice(0, 10);
        if (endDef > state.currentProject.end_date) endDef = state.currentProject.end_date;
      }
      form.start_date.value = startDef;
      form.end_date.value   = endDef;
      form.phase_id.value   = prefill.phase_id || "";
      form.parent_id.value  = prefill.parent_id || "";
      form.title.value      = prefill.title || "";
      form.progress.value   = 0;
    }
    $("#prog-out").textContent = form.progress.value;

    showModal(modal);
  }

  /* ============================================================
     CUSTOM CONFIRM (reemplaza window.confirm)
     ============================================================ */
  function appConfirm({
    title       = "¿Confirmar?",
    message     = "",
    list        = null,        /* array de strings opcional */
    kind        = "warn",      /* warn | danger | info | success */
    okText      = "Confirmar",
    cancelText  = "Cancelar"
  } = {}) {
    return new Promise((resolve) => {
      const modal   = $("#modal-confirm");
      const ico     = $("#confirm-icon");
      const titleEl = $("#confirm-title");
      const msgEl   = $("#confirm-message");
      const listEl  = $("#confirm-list");
      const okBtn   = $("#confirm-accept-btn");
      const cancelBtn = $("#confirm-cancel-btn");

      titleEl.textContent = title;
      msgEl.textContent   = message;

      if (Array.isArray(list) && list.length) {
        listEl.hidden = false;
        listEl.innerHTML = list.map(t => `<li>${escapeHtml(t)}</li>`).join("");
      } else {
        listEl.hidden = true;
        listEl.innerHTML = "";
      }

      /* icono según tipo */
      const iconMap = {
        warn:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
        danger:  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
        info:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        success: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
      };
      ico.innerHTML = iconMap[kind] || iconMap.warn;
      ico.className = "confirm-ico " + (
        kind === "danger"  ? "confirm-ico--danger" :
        kind === "info"    ? "confirm-ico--info"   :
        kind === "success" ? "confirm-ico--success": ""
      );

      okBtn.textContent = okText;
      okBtn.className = "auth-btn " + (kind === "danger" ? "auth-btn--danger" : "auth-btn--primary");
      cancelBtn.textContent = cancelText;

      function close(result) {
        okBtn.onclick = null;
        $$("[data-confirm-cancel]").forEach(b => b.onclick = null);
        document.removeEventListener("keydown", onKey);
        hideModal(modal);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") close(false);
        else if (e.key === "Enter") close(true);
      }
      okBtn.onclick = () => close(true);
      $$("[data-confirm-cancel]").forEach(b => b.onclick = () => close(false));
      document.addEventListener("keydown", onKey);

      showModal(modal);
      setTimeout(() => okBtn.focus(), 80);
    });
  }

  /* ============================================================
     CUSTOM SELECT (reemplaza visualmente los <select> con
     un dropdown propio. El <select> nativo queda oculto y sigue
     emitiendo eventos `change` para no romper el resto del código.)
     ============================================================ */
  function enhanceSelect(selectEl) {
    if (!selectEl || selectEl.dataset.cselReady) return;
    selectEl.dataset.cselReady = "1";

    const wrap = document.createElement("div");
    wrap.className = "csel";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "csel__trigger";

    const arrow = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`;

    function syncTrigger() {
      const opt = selectEl.options[selectEl.selectedIndex];
      trigger.dataset.value = opt?.value || "";
      const dotMap = {
        pending: "csel-pop__dot",
        progress: "csel-pop__dot csel-pop__dot--half",
        completed: "csel-pop__dot csel-pop__dot--filled"
      };
      const dot = dotMap[opt?.value] ? `<span class="${dotMap[opt.value]}" style="color:${
        opt.value === "completed" ? "#10b981" :
        opt.value === "progress"  ? "#f59e0b" :
        opt.value === "pending"   ? "#94a3b8" : "currentColor"
      }"></span>` : "";
      const label = opt ? opt.textContent.replace(/^[○◐●↓→↑‼]\s*/, "") : "";
      trigger.innerHTML = `<span>${dot}${escapeHtml(label)}</span>${arrow}`;
    }

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      openCselPop(trigger, selectEl);
    });

    /* sincronizar al cambiar el value del select por código */
    selectEl.addEventListener("change", syncTrigger);

    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(trigger);
    wrap.appendChild(selectEl);
    syncTrigger();
  }

  /* singleton del panel desplegable */
  function openCselPop(triggerEl, selectEl) {
    const pop = $("#csel-pop");
    /* cerrar si ya estaba abierto sobre este mismo trigger */
    if (!pop.hidden && pop.dataset.owner === triggerEl.dataset.id) {
      closeCselPop();
      return;
    }
    /* construir items */
    pop.innerHTML = Array.from(selectEl.options).map(opt => {
      const dotCls = opt.value === "progress" ? "csel-pop__dot csel-pop__dot--half"
                    : opt.value === "completed" ? "csel-pop__dot csel-pop__dot--filled"
                    : "csel-pop__dot";
      const isSel = String(selectEl.value) === String(opt.value);
      const label = opt.textContent.replace(/^[○◐●↓→↑‼]\s*/, "");
      return `<button type="button" class="csel-pop__item ${isSel ? 'is-selected':''}" data-value="${escapeHtml(opt.value)}">
        <span class="${dotCls}"></span>
        <span>${escapeHtml(label)}</span>
      </button>`;
    }).join("");

    /* posicionar */
    const r = triggerEl.getBoundingClientRect();
    pop.style.top  = (r.bottom + 4) + "px";
    pop.style.left = r.left + "px";
    pop.style.minWidth = Math.max(160, r.width) + "px";
    pop.hidden = false;

    /* marcar trigger como abierto */
    document.querySelectorAll(".csel.is-open").forEach(el => el.classList.remove("is-open"));
    triggerEl.parentNode.classList.add("is-open");

    /* listeners */
    pop.querySelectorAll(".csel-pop__item").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const newVal = btn.dataset.value;
        if (selectEl.value !== newVal) {
          selectEl.value = newVal;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeCselPop();
      });
    });

    /* cerrar al hacer scroll o click fuera */
    setTimeout(() => {
      document.addEventListener("click", outsideClose, { once: true });
      window.addEventListener("scroll", closeCselPop, { once: true, capture: true });
    }, 0);

    function outsideClose(e) {
      if (!pop.contains(e.target)) closeCselPop();
      else document.addEventListener("click", outsideClose, { once: true });
    }
  }
  function closeCselPop() {
    const pop = $("#csel-pop");
    pop.hidden = true;
    pop.innerHTML = "";
    document.querySelectorAll(".csel.is-open").forEach(el => el.classList.remove("is-open"));
  }

  /* hace enhance a todos los <select> dentro de un contenedor */
  function enhanceAllSelectsIn(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll("select.gnt-status, select.gnt-priority").forEach(enhanceSelect);
  }

  /* alerta sencilla con diseño (un solo botón) */
  function appAlert({ title = "Aviso", message = "", kind = "info", okText = "Entendido" } = {}) {
    return new Promise((resolve) => {
      const modal   = $("#modal-confirm");
      const ico     = $("#confirm-icon");
      const titleEl = $("#confirm-title");
      const msgEl   = $("#confirm-message");
      const listEl  = $("#confirm-list");
      const okBtn   = $("#confirm-accept-btn");
      const cancelBtn = $("#confirm-cancel-btn");

      titleEl.textContent = title;
      msgEl.textContent   = message;
      listEl.hidden = true; listEl.innerHTML = "";
      cancelBtn.style.display = "none";

      const iconMap = {
        warn:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
        danger:  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        info:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        success: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
      };
      ico.innerHTML = iconMap[kind] || iconMap.info;
      ico.className = "confirm-ico " + (
        kind === "danger"  ? "confirm-ico--danger" :
        kind === "warn"    ? "" :
        kind === "success" ? "confirm-ico--success" :
                             "confirm-ico--info"
      );
      okBtn.textContent = okText;
      okBtn.className = "auth-btn auth-btn--primary";

      function close() {
        okBtn.onclick = null;
        document.removeEventListener("keydown", onKey);
        cancelBtn.style.display = "";   /* restaurar */
        hideModal(modal);
        resolve();
      }
      function onKey(e) { if (e.key === "Escape" || e.key === "Enter") close(); }
      okBtn.onclick = close;
      document.addEventListener("keydown", onKey);

      showModal(modal);
      setTimeout(() => okBtn.focus(), 80);
    });
  }

  /* ============================================================
     SONIDOS — pequeños beeps generados con Web Audio API
     (no requieren archivos externos)
     ============================================================ */
  let _audioCtx = null;
  function _ensureAudio() {
    if (_audioCtx) return _audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
    return _audioCtx;
  }
  function playSound(type) {
    const ctx = _ensureAudio();
    if (!ctx) return;
    /* algunos navegadores requieren resume después del primer click */
    if (ctx.state === "suspended") ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "add") {
      /* dos notas ascendentes — agradable y breve */
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now); osc.stop(now + 0.24);
    } else if (type === "delete") {
      /* descenso */
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now); osc.stop(now + 0.24);
    } else if (type === "warn" || type === "alert") {
      /* dos pulsos cortos en frecuencia media */
      osc.type = "square";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.16);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now); osc.stop(now + 0.30);
    } else if (type === "undo") {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now); osc.stop(now + 0.24);
    }
  }

  /* ============================================================
     TOAST DE DESHACER — 10 segundos con cuenta atrás
     ============================================================ */
  let _undoState = null;   /* { timeoutId, intervalId, onUndo } */

  function showUndoToast({ message, sublabel = "", onUndo, duration = 10000 }) {
    /* cierra cualquier toast previo (ejecuta su acción de "expirar") */
    if (_undoState) {
      clearTimeout(_undoState.timeoutId);
      clearInterval(_undoState.intervalId);
      _undoState = null;
    }
    const toast = $("#undo-toast");
    const msgEl = $("#undo-toast-msg");
    const subEl = $("#undo-toast-sub");
    const cntEl = $("#undo-toast-count");
    const btn   = $("#undo-toast-btn");
    const bar   = $("#undo-toast-bar");

    msgEl.textContent = message;
    subEl.textContent = sublabel || "Tienes 10 s para deshacer";
    toast.hidden = false;
    toast.classList.remove("is-leaving");

    /* animar la barra: de 100% a 0% en `duration` ms */
    bar.style.transition = "none";
    bar.style.transform = "scaleX(1)";
    /* fuerza reflow para que la transición se aplique */
    void bar.offsetWidth;
    bar.style.transition = `transform ${duration}ms linear`;
    bar.style.transform = "scaleX(0)";

    /* cuenta atrás visual */
    let remaining = Math.ceil(duration / 1000);
    cntEl.textContent = remaining;
    const intervalId = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearInterval(intervalId); return; }
      cntEl.textContent = remaining;
    }, 1000);

    function close(animate = true) {
      clearTimeout(_undoState?.timeoutId);
      clearInterval(_undoState?.intervalId);
      _undoState = null;
      btn.onclick = null;
      if (animate) {
        toast.classList.add("is-leaving");
        setTimeout(() => { toast.hidden = true; toast.classList.remove("is-leaving"); }, 200);
      } else {
        toast.hidden = true;
      }
    }

    btn.onclick = async () => {
      try { if (onUndo) await onUndo(); }
      finally { close(); playSound("undo"); }
    };

    const timeoutId = setTimeout(() => close(true), duration);
    _undoState = { timeoutId, intervalId, onUndo };
  }

  /* exponer para uso desde gantt.js */
  window.APP_UI = { enhanceAllSelectsIn, appConfirm, appAlert, playSound, showUndoToast };

  /* ============================================================
     MODAL HELPERS
     ============================================================ */
  /* === Focus trap por modal abierto === */
  const _modalTrapMap = new WeakMap();   /* modal → handler para limpiar */

  function _focusableInside(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]):not([hidden]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function showModal(modal) {
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    /* recordar elemento previamente enfocado para devolver focus al cerrar */
    modal._previousFocus = document.activeElement;

    /* focus primer elemento interactivo */
    setTimeout(() => {
      const focusables = _focusableInside(modal);
      const first = focusables.find(el => el.matches("input:not([type=hidden]), textarea, select")) || focusables[0];
      if (first) first.focus();
    }, 50);

    /* atrapar Tab dentro del modal */
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const focusables = _focusableInside(modal);
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    modal.addEventListener("keydown", trap);
    _modalTrapMap.set(modal, trap);
  }
  function hideModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = "";
    /* quitar focus trap */
    const trap = _modalTrapMap.get(modal);
    if (trap) { modal.removeEventListener("keydown", trap); _modalTrapMap.delete(modal); }
    /* devolver focus al elemento previo */
    if (modal._previousFocus && typeof modal._previousFocus.focus === "function") {
      try { modal._previousFocus.focus(); } catch (e) { /* ignore */ }
      modal._previousFocus = null;
    }
  }
  function bindModalClose(modal) {
    modal.querySelectorAll("[data-close]").forEach(el => {
      el.addEventListener("click", () => hideModal(modal));
    });
  }

  /* ============================================================
     GLOBAL EVENTS
     ============================================================ */
  function bindGlobalEvents() {
    /* user menu */
    $("#btn-user-toggle").addEventListener("click", () => {
      const m = $("#user-menu");
      m.hidden = !m.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#app-user-menu")) $("#user-menu").hidden = true;
    });

    $("#btn-logout").addEventListener("click", () => window.AUTH.logout());

    $("#btn-edit-project").addEventListener("click", () => {
      $("#user-menu").hidden = true;
      openProjectModal(state.currentProject?.id);
    });
    $("#btn-delete-project").addEventListener("click", async () => {
      $("#user-menu").hidden = true;
      if (!state.currentProject) return;
      const ok = await appConfirm({
        kind: "danger",
        title: `Eliminar el proyecto «${state.currentProject.title}»`,
        message: `Se eliminarán ${state.phases.length} fase(s) y ${state.activities.length} actividad(es). Esta acción no se puede deshacer.`,
        okText: "Eliminar proyecto",
        cancelText: "Cancelar"
      });
      if (!ok) return;
      await window.STORE.deleteProject(state.currentProject.id);
      await loadProjects();
      if (state.projects.length) {
        await selectProject(state.projects[0].id);
      } else {
        state.currentProject = null;
        state.phases = []; state.activities = [];
        paintHero(); paintPhaseList(); renderGantt();
        openProjectModal();
      }
    });

    /* project select */
    $("#project-select").addEventListener("change", async (e) => {
      await selectProject(e.target.value);
    });
    $("#btn-new-project").addEventListener("click", () => openProjectModal());

    /* selector de formato de fechas (Ago 26 / S32  ↔  Mes 1 / Sem 1) */
    const dateModeSel = $("#date-mode-select");
    if (dateModeSel) {
      dateModeSel.value = localStorage.getItem("gnt.dateLabelMode") || "real";
      dateModeSel.addEventListener("change", () => {
        localStorage.setItem("gnt.dateLabelMode", dateModeSel.value);
        renderGantt();
      });
    }

    /* add phase */
    $("#btn-add-phase").addEventListener("click", () => openPhaseModal());

    /* templates */
    $$(".tpl-btn").forEach(btn => {
      btn.addEventListener("click", () => applyTemplate(btn.dataset.tpl));
    });

    /* Fechas editables del hero (Inicio / Cierre del proyecto) */
    const startInput = $("#meta-start");
    const endInput   = $("#meta-end");
    async function saveProjectDate(field, newValue) {
      if (!state.currentProject || !newValue) return;
      const oldValue = state.currentProject[field];
      if (oldValue === newValue) return;

      /* validar coherencia inicio/fin */
      const newStart = field === "start_date" ? newValue : state.currentProject.start_date;
      const newEnd   = field === "end_date"   ? newValue : state.currentProject.end_date;
      if (newStart && newEnd && newEnd < newStart) {
        await appAlert({
          kind: "warn",
          title: "Fechas inválidas",
          message: "La fecha de cierre debe ser posterior o igual a la de inicio."
        });
        /* restaurar valor en el input */
        if (field === "start_date" && startInput) startInput.value = oldValue;
        if (field === "end_date"   && endInput)   endInput.value   = oldValue;
        return;
      }

      /* avisar si hay actividades fuera del nuevo rango */
      const outside = state.activities.filter(a =>
        a.start_date < newStart || a.end_date > newEnd
      );
      if (outside.length) {
        const ok = await appConfirm({
          kind: "warn",
          title: "Actividades fuera del nuevo rango",
          message: `Hay ${outside.length} actividad(es) cuyas fechas quedan fuera del nuevo rango del proyecto. ¿Continuar igualmente? Las barras se recortarán visualmente al rango pero las fechas de las actividades no se cambian.`,
          okText: "Sí, cambiar fechas",
          cancelText: "Cancelar"
        });
        if (!ok) {
          if (field === "start_date" && startInput) startInput.value = oldValue;
          if (field === "end_date"   && endInput)   endInput.value   = oldValue;
          return;
        }
      }

      try {
        const updated = await window.STORE.updateProject(state.currentProject.id, { [field]: newValue });
        state.currentProject = { ...state.currentProject, ...(updated || { [field]: newValue }) };
        /* refrescar lista de proyectos también */
        const idx = state.projects.findIndex(p => p.id === state.currentProject.id);
        if (idx >= 0) state.projects[idx] = state.currentProject;
        paintHero();
        renderGantt();
        playSound("add");
      } catch (e) {
        appAlert({ kind: "danger", title: "Error al guardar la fecha", message: e.message || String(e) });
      }
    }
    if (startInput) startInput.addEventListener("change", () => saveProjectDate("start_date", startInput.value));
    if (endInput)   endInput  .addEventListener("change", () => saveProjectDate("end_date",   endInput.value));

    /* PDF */
    $("#btn-export-pdf").addEventListener("click", async () => {
      if (!state.currentProject) return;
      const btn = $("#btn-export-pdf");
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "<span>Generando PDF...</span>";
      try {
        await window.PDF_EXPORT.exportPDF({
          project:    state.currentProject,
          phases:     state.phases,
          activities: state.activities,
          ganttEl:    $("#gantt"),
          user:       state.user
        });
      } catch (e) {
        console.error(e);
        appAlert({ kind: "danger", title: "No se pudo generar el PDF", message: e.message || String(e) });
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });

    /* modales */
    bindModalClose($("#modal-project"));
    bindModalClose($("#modal-phase"));
    bindModalClose($("#modal-activity"));

    /* form: project */
    $("#form-project").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title:      fd.get("title"),
        author:     fd.get("author"),
        advisor:    fd.get("advisor"),
        university: fd.get("university"),
        program:    fd.get("program"),
        start_date: fd.get("start_date"),
        end_date:   fd.get("end_date")
      };
      const id = fd.get("id");
      try {
        if (id) {
          await window.STORE.updateProject(id, payload);
        } else {
          const p = await window.STORE.createProject(state.user.id, payload);
          state.projects.unshift(p);
          state.currentProject = p;
        }
        hideModal($("#modal-project"));
        await loadProjects();
        await selectProject(state.currentProject.id);
      } catch (err) { appAlert({ kind: "danger", title: "Error", message: err.message || String(err) }); }
    });

    /* form: phase */
    $("#form-phase").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title:     fd.get("title"),
        objective: fd.get("objective"),
        color:     fd.get("color")
      };
      const id = fd.get("id");
      try {
        if (id) await window.STORE.updatePhase(id, payload);
        else    await window.STORE.createPhase(state.currentProject.id, payload);
        hideModal($("#modal-phase"));
        await loadPhasesAndActivities();
        paintPhaseList();
        renderGantt();
        if (!id) playSound("add");   /* sonido solo al CREAR */
      } catch (err) { appAlert({ kind: "danger", title: "Error", message: err.message || String(err) }); }
    });

    /* form: activity */
    $("#form-activity").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title:          fd.get("title"),
        description:    fd.get("description"),
        start_date:     fd.get("start_date"),
        end_date:       fd.get("end_date"),
        phase_id:       fd.get("phase_id") || null,
        parent_id:      fd.get("parent_id") || null,
        status:         fd.get("status"),
        priority:       fd.get("priority"),
        predecessor_id: fd.get("predecessor_id") || null,
        progress:       parseInt(fd.get("progress"), 10) || 0
      };
      /* validación: end >= start */
      if (payload.end_date < payload.start_date) {
        await appAlert({
          kind: "warn",
          title: "Fechas inválidas",
          message: "La fecha de fin debe ser posterior o igual a la fecha de inicio."
        });
        return;
      }
      const id = fd.get("id");

      /* validación de dependencia: detectar ciclos antes de cualquier otra cosa */
      if (payload.predecessor_id) {
        /* recorrer la cadena hacia atrás siguiendo predecessor_id; si volvemos
           al id que estamos editando, hay ciclo. También impide self-reference. */
        if (payload.predecessor_id === id) {
          await appAlert({
            kind: "warn",
            title: "Predecesora inválida",
            message: "Una actividad no puede ser su propia predecesora."
          });
          return;
        }
        const seen = new Set([id].filter(Boolean));
        let cursor = payload.predecessor_id;
        let cycle = false;
        while (cursor) {
          if (seen.has(cursor)) { cycle = true; break; }
          seen.add(cursor);
          const next = state.activities.find(x => x.id === cursor);
          cursor = next ? next.predecessor_id : null;
        }
        if (cycle) {
          await appAlert({
            kind: "warn",
            title: "Ciclo de dependencias",
            message: "Esta predecesora generaría un ciclo (A→B→…→A). Elige otra actividad o ninguna."
          });
          return;
        }

        /* aviso si la predecesora inicia después */
        const pred = state.activities.find(x => x.id === payload.predecessor_id);
        if (pred && payload.start_date < pred.start_date) {
          const ok = await appConfirm({
            kind: "warn",
            title: "Dependencia rota",
            message: `Esta actividad inicia antes que su predecesora «${pred.title}» (${pred.start_date}). Si continúas, se marcará como dependencia rota en el diagrama.`,
            okText: "Guardar igual",
            cancelText: "Cancelar"
          });
          if (!ok) return;
        }
      }
      try {
        if (id) await window.STORE.updateActivity(id, payload);
        else    await window.STORE.createActivity(state.currentProject.id, payload);
        hideModal($("#modal-activity"));
        await loadPhasesAndActivities();
        paintHero();
        paintPhaseList();
        renderGantt();
        if (!id) playSound("add");   /* sonido solo al CREAR */
      } catch (err) { appAlert({ kind: "danger", title: "Error", message: err.message || String(err) }); }
    });

    /* progress range live */
    const progEl = $('#form-activity input[name="progress"]');
    if (progEl) progEl.addEventListener("input", () => $("#prog-out").textContent = progEl.value);

    /* Eliminar actividad desde el modal */
    $("#btn-delete-activity").addEventListener("click", async () => {
      const id = $("#btn-delete-activity").dataset.targetId;
      if (!id) return;
      const a = state.activities.find(x => x.id === id);
      if (!a) return;
      const subs = state.activities.filter(x => x.parent_id === id);
      const ok = await appConfirm({
        kind: "danger",
        title: `Eliminar la actividad «${a.title}»`,
        message: subs.length
          ? `Se eliminarán también ${subs.length} sub-actividad(es). Esta acción no se puede deshacer.`
          : "Esta acción no se puede deshacer.",
        okText: "Eliminar",
        cancelText: "Cancelar"
      });
      if (!ok) return;
      try {
        await window.STORE.deleteActivity(id);
        hideModal($("#modal-activity"));
        await loadPhasesAndActivities();
        paintHero();
        paintPhaseList();
        renderGantt();
      } catch (err) { appAlert({ kind: "danger", title: "Error", message: err.message || String(err) }); }
    });

    /* Eliminar fase desde el modal — usa la función compartida */
    $("#btn-delete-phase").addEventListener("click", async () => {
      const id = $("#btn-delete-phase").dataset.targetId;
      if (!id) return;
      await deletePhaseWithConfirm(id);
    });

    /* esc cierra cualquier modal */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $$(".modal").forEach(m => { if (!m.hidden) hideModal(m); });
    });
  }

  /* ============================================================
     PLANTILLAS DE FASES PARA ANTEPROYECTO
     ============================================================ */
  const TEMPLATES = {
    problema: {
      title: "Fase 1 · Planteamiento del problema",
      objective: "Definir el problema, justificación y objetivos generales y específicos.",
      color: "#3b82f6",
      activities: [
        { title: "Identificación del problema",        days: 7,  priority: "high"     },
        { title: "Justificación del estudio",          days: 5,  priority: "medium"   },
        { title: "Formulación de objetivos",           days: 5,  priority: "high"     },
        { title: "Pregunta de investigación e hipótesis", days: 4, priority: "high"   }
      ]
    },
    marco: {
      title: "Fase 2 · Marco teórico",
      objective: "Construir el marco teórico, conceptual y referencial del estudio.",
      color: "#06b6d4",
      activities: [
        { title: "Revisión bibliográfica",             days: 14, priority: "high"     },
        { title: "Antecedentes nacionales e internac.", days: 10, priority: "medium"  },
        { title: "Marco conceptual",                   days: 7,  priority: "medium"   },
        { title: "Marco legal / normativo",            days: 5,  priority: "low"      }
      ]
    },
    metodologia: {
      title: "Fase 3 · Metodología",
      objective: "Diseñar el enfoque, tipo de estudio, población, instrumentos y procedimiento.",
      color: "#8b5cf6",
      activities: [
        { title: "Tipo y enfoque de investigación",    days: 4,  priority: "high"     },
        { title: "Población y muestra",                days: 5,  priority: "medium"   },
        { title: "Diseño de instrumentos",             days: 10, priority: "high"     },
        { title: "Validación de instrumentos",         days: 7,  priority: "medium"   }
      ]
    },
    recoleccion: {
      title: "Fase 4 · Recolección de datos",
      objective: "Aplicar instrumentos y recolectar la información del trabajo de campo.",
      color: "#10b981",
      activities: [
        { title: "Aplicación de instrumentos",         days: 14, priority: "high"     },
        { title: "Trabajo de campo",                   days: 14, priority: "high"     },
        { title: "Sistematización de datos",           days: 7,  priority: "medium"   }
      ]
    },
    analisis: {
      title: "Fase 5 · Análisis y resultados",
      objective: "Procesar, analizar e interpretar los datos obtenidos.",
      color: "#f59e0b",
      activities: [
        { title: "Procesamiento estadístico",          days: 10, priority: "high"     },
        { title: "Interpretación de resultados",       days: 10, priority: "high"     },
        { title: "Discusión de hallazgos",             days: 7,  priority: "medium"   }
      ]
    },
    conclusiones: {
      title: "Fase 6 · Conclusiones y entrega",
      objective: "Redactar conclusiones, recomendaciones, ajustes finales y sustentación.",
      color: "#ef4444",
      activities: [
        { title: "Conclusiones y recomendaciones",     days: 5,  priority: "high"     },
        { title: "Revisión y correcciones finales",    days: 7,  priority: "high"     },
        { title: "Entrega del documento final",        days: 2,  priority: "critical" },
        { title: "Sustentación / defensa",             days: 1,  priority: "critical" }
      ]
    }
  };

  /* ============================================================
     PLANTILLA MULTI-FASE: Cronograma de intervención (16 semanas)
     5 fases · 16 actividades semanales encadenadas
     ============================================================ */
  const TPL_CRONOGRAMA_16 = [
    {
      title: "Fase 1 · Presentación de anteproyecto a la institución",
      objective: "Socialización del proyecto, conformación de grupos, consentimientos y prueba piloto de instrumentos.",
      color: "#3b82f6",
      activities: [
        { title: "Socialización del proyecto con el equipo docente de la institución", days: 7, priority: "high" },
        { title: "Asignación de grupo experimental y de control",                       days: 7, priority: "high" },
        { title: "Reunión con padres y firma de consentimientos informados",            days: 7, priority: "critical" },
        { title: "Prueba Piloto: Ajuste de instrumentos de la variable dependiente",    days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 2 · Diagnóstico inicial",
      objective: "Aplicación del pre-test al grupo experimental y al grupo de comparación.",
      color: "#06b6d4",
      activities: [
        { title: "Aplicación de Pre-test: Grupo Experimental",   days: 7, priority: "high" },
        { title: "Aplicación de Pre-test: Grupo de comparación", days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 3 · Intervención · Aplicación de la variable independiente",
      objective: "Diagnóstico de necesidades, co-diseño de la didáctica con apoyos visuales, prueba beta, ajustes e implementación.",
      color: "#8b5cf6",
      activities: [
        { title: "Diagnóstico para determinar las necesidades de los estudiantes",                  days: 7, priority: "high" },
        { title: "Selección de dinámicas para clase",                                                days: 7, priority: "medium" },
        { title: "Creación conjunta de apoyos visuales teniendo en cuenta las barreras identificadas", days: 7, priority: "high" },
        { title: "Prueba beta de la didáctica",                                                      days: 7, priority: "medium" },
        { title: "Semana de ajustes y consolidación",                                                days: 7, priority: "medium" },
        { title: "Implementación didáctica co-diseñada",                                             days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 4 · Evaluación final",
      objective: "Aplicación del post-test al grupo experimental y al grupo de comparación.",
      color: "#10b981",
      activities: [
        { title: "Aplicación de Post-test: Grupo Experimental",   days: 7, priority: "high" },
        { title: "Aplicación de Post-test: Grupo de comparación", days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 5 · Análisis y cierre",
      objective: "Comparación de resultados entre grupos y entrega formal a la institución.",
      color: "#f59e0b",
      activities: [
        { title: "Comparación y análisis de los resultados obtenidos", days: 7, priority: "high" },
        { title: "Entrega de resultados a la institución",             days: 7, priority: "critical" }
      ]
    }
  ];

  /* ============================================================
     PLANTILLA 16 SEMANAS · INVESTIGACIÓN CUALITATIVA
     Alternativa a la intervención: foco en entrevistas y análisis temático
     ============================================================ */
  const TPL_CRONOGRAMA_16B = [
    {
      title: "Fase 1 · Diseño de la investigación",
      objective: "Definir tema, problema y preguntas guía del estudio cualitativo.",
      color: "#3b82f6",
      activities: [
        { title: "Definición del tema y problema",         days: 7, priority: "high" },
        { title: "Revisión inicial de literatura",         days: 7, priority: "high" },
        { title: "Formulación de preguntas de investigación", days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 2 · Marco conceptual y referencial",
      objective: "Construir el sustento teórico que orienta la categorización.",
      color: "#06b6d4",
      activities: [
        { title: "Selección de teorías de base",           days: 7, priority: "high" },
        { title: "Construcción del marco conceptual",      days: 7, priority: "medium" },
        { title: "Marco metodológico cualitativo",         days: 7, priority: "medium" }
      ]
    },
    {
      title: "Fase 3 · Trabajo de campo",
      objective: "Aplicar entrevistas, observación participante y registro de hallazgos.",
      color: "#8b5cf6",
      activities: [
        { title: "Selección de informantes clave",         days: 7, priority: "high" },
        { title: "Diseño y validación de guion de entrevista", days: 7, priority: "high" },
        { title: "Realización de entrevistas en profundidad",  days: 7, priority: "high" },
        { title: "Observación participante y diario de campo", days: 7, priority: "medium" },
        { title: "Registro y transcripción de hallazgos",  days: 7, priority: "medium" }
      ]
    },
    {
      title: "Fase 4 · Análisis temático",
      objective: "Codificar datos, generar categorías y triangular fuentes.",
      color: "#10b981",
      activities: [
        { title: "Codificación abierta de datos",          days: 7, priority: "high" },
        { title: "Categorización temática",                days: 7, priority: "high" },
        { title: "Triangulación entre fuentes",            days: 7, priority: "medium" }
      ]
    },
    {
      title: "Fase 5 · Cierre y socialización",
      objective: "Redactar conclusiones y socializar resultados con la comunidad.",
      color: "#f59e0b",
      activities: [
        { title: "Redacción de conclusiones y discusión",  days: 7, priority: "high"     },
        { title: "Socialización de resultados",            days: 7, priority: "critical" }
      ]
    }
  ];

  /* ============================================================
     PLANTILLA 32 SEMANAS · TRABAJO DE GRADO COMPLETO
     6 fases · ~32 actividades cubriendo todo el ciclo de tesis
     ============================================================ */
  const TPL_CRONOGRAMA_32 = [
    {
      title: "Fase 1 · Anteproyecto (4 sem)",
      objective: "Definir tema, justificar el estudio y plantear objetivos.",
      color: "#3b82f6",
      activities: [
        { title: "Definición del tema y problema",          days: 7, priority: "high" },
        { title: "Estado del arte preliminar",              days: 7, priority: "high" },
        { title: "Justificación del estudio",               days: 7, priority: "medium" },
        { title: "Formulación de objetivos e hipótesis",    days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 2 · Marco teórico (6 sem)",
      objective: "Construir el sustento teórico, conceptual y normativo del estudio.",
      color: "#06b6d4",
      activities: [
        { title: "Revisión bibliográfica exhaustiva",       days: 7, priority: "high" },
        { title: "Antecedentes nacionales e internacionales", days: 7, priority: "high" },
        { title: "Marco conceptual",                        days: 7, priority: "medium" },
        { title: "Marco contextual e institucional",        days: 7, priority: "medium" },
        { title: "Marco legal y normativo",                 days: 7, priority: "low" },
        { title: "Integración y depuración del marco",      days: 7, priority: "medium" }
      ]
    },
    {
      title: "Fase 3 · Diseño metodológico (4 sem)",
      objective: "Definir enfoque, población, instrumentos y procedimiento.",
      color: "#8b5cf6",
      activities: [
        { title: "Tipo y enfoque de investigación",         days: 7, priority: "high" },
        { title: "Definición de población y muestra",       days: 7, priority: "high" },
        { title: "Diseño de instrumentos",                  days: 7, priority: "high" },
        { title: "Validación y prueba piloto de instrumentos", days: 7, priority: "high" }
      ]
    },
    {
      title: "Fase 4 · Trabajo de campo (8 sem)",
      objective: "Aplicar instrumentos al grupo experimental y de comparación.",
      color: "#10b981",
      activities: [
        { title: "Consentimientos informados y logística",  days: 7, priority: "critical" },
        { title: "Aplicación pre-test grupo experimental",  days: 7, priority: "high" },
        { title: "Aplicación pre-test grupo de comparación", days: 7, priority: "high" },
        { title: "Implementación de la intervención (1)",   days: 7, priority: "high" },
        { title: "Implementación de la intervención (2)",   days: 7, priority: "high" },
        { title: "Implementación de la intervención (3)",   days: 7, priority: "high" },
        { title: "Aplicación post-test ambos grupos",       days: 7, priority: "high" },
        { title: "Sistematización y depuración de datos",   days: 7, priority: "medium" }
      ]
    },
    {
      title: "Fase 5 · Análisis y resultados (5 sem)",
      objective: "Procesar, interpretar y discutir los hallazgos del estudio.",
      color: "#f59e0b",
      activities: [
        { title: "Procesamiento estadístico cuantitativo",  days: 7, priority: "high" },
        { title: "Análisis cualitativo / temático",         days: 7, priority: "high" },
        { title: "Triangulación de resultados",             days: 7, priority: "medium" },
        { title: "Interpretación frente a marco teórico",   days: 7, priority: "high" },
        { title: "Discusión de hallazgos",                  days: 7, priority: "medium" }
      ]
    },
    {
      title: "Fase 6 · Conclusiones y entrega (5 sem)",
      objective: "Cerrar el estudio: conclusiones, recomendaciones y sustentación.",
      color: "#ef4444",
      activities: [
        { title: "Redacción de conclusiones",               days: 7, priority: "high" },
        { title: "Redacción de recomendaciones",            days: 7, priority: "medium" },
        { title: "Revisión y correcciones finales",         days: 7, priority: "high" },
        { title: "Entrega del documento final",             days: 7, priority: "critical" },
        { title: "Sustentación / defensa",                  days: 4, priority: "critical" }
      ]
    }
  ];

  /* ============================================================
     PLANTILLA 32 SEMANAS · CRONOGRAMA «IA Y MEMORIA DE TRABAJO»
     Réplica exacta del PDF de Albeiro Ramos Saldaña (LDT-UPN):
     Fase 0 (Sem 1–2)   · Preparación y aval institucional
     Fase 1 (Sem 3–9)   · OE1 — Diseño y validación de la escala
     Fase 2 (Sem 10–19) · OE3 — Selección de muestra y aplicación
     Fase 3 (Sem 20–26) · OE2 — Análisis estadístico y comparación
     Fase Final (Sem 27–32) · Redacción y socialización
     Cada actividad principal incluye sub-actividades (parent_id),
     entregable/hito (description) y tipo (obligatoria/optativa).
     ============================================================ */
  const TPL_CRONOGRAMA_TESIS_IA = [
    {
      title: "FASE 0 · Preparación y Aval Institucional",
      objective: "Asegurar las condiciones éticas, metodológicas y operativas de la investigación.",
      color: "#4b5563",
      activities: [
        {
          code: "0.1", title: "Revisión final del documento metodológico",
          startWeek: 1, endWeek: 1, type: "obligatoria",
          deliverable: "Documento metodológico aprobado por el director",
          subs: [
            "Verificación de coherencia hipótesis–objetivos–metodología",
            "Ajustes finales al planteamiento del problema"
          ]
        },
        {
          code: "0.2", title: "Solicitud de aval del comité ético UPN",
          startWeek: 2, endWeek: 2, type: "obligatoria",
          deliverable: "Radicado de aval ético + consentimiento informado aprobado",
          subs: [
            "Preparación de documentación ética",
            "Diseño del consentimiento informado para participantes",
            "Radicación ante el comité de ética"
          ]
        },
        {
          code: "0.3", title: "Plan operativo y gestión de recursos",
          startWeek: 3, endWeek: 3, type: "obligatoria",
          deliverable: "Cronograma operativo y matriz de recursos",
          subs: [
            "Inventario de instrumentos y materiales requeridos",
            "Programación de sesiones de tutoría con el director"
          ]
        },
        {
          code: "0.4", title: "Reunión inicial con director de tesis",
          startWeek: 1, endWeek: 2, type: "optativa",
          deliverable: "Acta de tutoría inicial",
          subs: [
            "Validación del alcance descriptivo–correlacional",
            "Acuerdo sobre criterios de calidad del informe final"
          ]
        }
      ]
    },
    {
      title: "FASE 1 · OE1 — Diseño y Validación de la Escala (Dependencia IA)",
      objective: "Construir y validar psicométricamente el instrumento que medirá la variable independiente (dependencia hacia herramientas de IA generativa).",
      color: "#1d4ed8",
      activities: [
        {
          code: "1.1", title: "Operacionalización de la variable «dependencia hacia IA»",
          startWeek: 4, endWeek: 4, type: "obligatoria",
          deliverable: "Tabla de operacionalización con dimensiones e indicadores",
          subs: [
            "Revisión específica de literatura sobre escalas de dependencia tecnológica",
            "Definición de dimensiones: frecuencia, intensidad, tipo de uso, autonomía",
            "Definición de indicadores conductuales observables"
          ]
        },
        {
          code: "1.2", title: "Construcción del banco inicial de ítems Likert",
          startWeek: 5, endWeek: 5, type: "obligatoria",
          deliverable: "Versión 1.0 del cuestionario (≈25–30 ítems)",
          subs: [
            "Redacción de ítems en escala Likert de 5 puntos",
            "Codificación inversa de ítems control (sesgo de aquiescencia)",
            "Maquetación digital del cuestionario en Google Forms"
          ]
        },
        {
          code: "1.3", title: "Validación por juicio de expertos",
          startWeek: 6, endWeek: 6, type: "obligatoria",
          deliverable: "Matriz de validación V de Aiken por ítem",
          subs: [
            "Identificación y contacto con 3–5 expertos (IA educativa y psicometría)",
            "Envío de matriz de validación con criterios: claridad, relevancia, suficiencia",
            "Sistematización de retroalimentación"
          ]
        },
        {
          code: "1.4", title: "Ajustes al instrumento según jueces expertos",
          startWeek: 7, endWeek: 7, type: "obligatoria",
          deliverable: "Versión 2.0 del cuestionario",
          subs: [
            "Reformulación de ítems con baja claridad",
            "Eliminación o sustitución de ítems no pertinentes"
          ]
        },
        {
          code: "1.5", title: "Prueba piloto del cuestionario",
          startWeek: 8, endWeek: 8, type: "obligatoria",
          deliverable: "Base de datos piloto (n≈15–20)",
          subs: [
            "Aplicación a muestra reducida con perfil similar al objetivo",
            "Registro de tiempos de respuesta y observaciones cualitativas"
          ]
        },
        {
          code: "1.6", title: "Análisis psicométrico de la prueba piloto",
          startWeek: 9, endWeek: 9, type: "critical",
          deliverable: "Hito Sem 9 · Informe de fiabilidad + Versión final del cuestionario (instrumento validado psicométricamente)",
          subs: [
            "Cálculo del Alfa de Cronbach (criterio: α ≥ 0,70)",
            "Análisis de discriminación de ítems (correlación ítem-total)",
            "Versión 3.0 (definitiva) del cuestionario"
          ]
        },
        {
          code: "1.7", title: "Segunda ronda de validación con expertos adicionales",
          startWeek: 7, endWeek: 7, type: "optativa",
          deliverable: "Validación reforzada del instrumento",
          subs: [
            "Consulta a dos expertos adicionales (línea de neurocognición)"
          ]
        },
        {
          code: "1.8", title: "Prueba piloto extendida en programa contiguo UPN",
          startWeek: 8, endWeek: 8, type: "optativa",
          deliverable: "Datos piloto adicionales para análisis comparativo",
          subs: [
            "Aplicación en otro programa de pregrado (n≈10)"
          ]
        }
      ]
    },
    {
      title: "FASE 2 · OE3 — Selección de Muestra y Aplicación de Pruebas (Memoria de Trabajo)",
      objective: "Recolectar las mediciones individuales sobre dependencia hacia IA y rendimiento en memoria de trabajo en la muestra delimitada (LDT-UPN, 2.º semestre).",
      color: "#b91c1c",
      activities: [
        {
          code: "2.1", title: "Selección de la prueba estandarizada de memoria de trabajo",
          startWeek: 10, endWeek: 10, type: "obligatoria",
          deliverable: "Prueba seleccionada y justificada metodológicamente",
          subs: [
            "Cotejo entre alternativas: subprueba Dígitos del WAIS-IV, n-back, Corsi block-tapping",
            "Decisión justificada según pertinencia, validez y disponibilidad",
            "Adquisición de manual de aplicación y plantillas de registro"
          ]
        },
        {
          code: "2.2", title: "Capacitación del equipo aplicador",
          startWeek: 11, endWeek: 11, type: "obligatoria",
          deliverable: "Protocolo estandarizado de aplicación",
          subs: [
            "Estudio del manual técnico de la prueba",
            "Práctica de administración entre pares",
            "Estandarización de instrucciones verbales"
          ]
        },
        {
          code: "2.3", title: "Identificación y contacto con la población objetivo",
          startWeek: 12, endWeek: 12, type: "obligatoria",
          deliverable: "Listado de estudiantes potenciales contactados",
          subs: [
            "Coordinación con la dirección del programa LDT-UPN",
            "Convocatoria a estudiantes de 2.º semestre",
            "Verificación de criterios de inclusión"
          ]
        },
        {
          code: "2.4", title: "Firma de consentimientos informados",
          startWeek: 13, endWeek: 13, type: "critical",
          deliverable: "Hito Sem 12 · Consentimientos firmados — inicio formal del trabajo de campo",
          subs: [
            "Sesión informativa con interesados",
            "Aclaración de derechos y manejo confidencial de datos"
          ]
        },
        {
          code: "2.5", title: "Aplicación del cuestionario de dependencia hacia IA",
          startWeek: 14, endWeek: 14, type: "obligatoria",
          deliverable: "Respuestas completas en Google Forms",
          subs: [
            "Aplicación virtual del instrumento validado",
            "Seguimiento de respuestas no completadas",
            "Verificación de completitud por participante"
          ]
        },
        {
          code: "2.6", title: "Aplicación de la prueba de memoria de trabajo",
          startWeek: 15, endWeek: 16, type: "obligatoria",
          deliverable: "Plantillas de registro individuales completas",
          subs: [
            "Programación de sesiones individuales (≈30 min/participante)",
            "Aplicación estandarizada en condiciones controladas",
            "Registro inmediato de puntuaciones brutas"
          ]
        },
        {
          code: "2.7", title: "Sistematización en base de datos",
          startWeek: 17, endWeek: 19, type: "critical",
          deliverable: "Hito Sem 19 · Base de datos limpia, depurada y lista para análisis (SPSS / Excel)",
          subs: [
            "Codificación de variables y etiquetado",
            "Cálculo de puntuaciones tipificadas (z-scores)",
            "Verificación cruzada de datos por dos personas (control de calidad)"
          ]
        },
        {
          code: "2.8", title: "Diario de campo del proceso de aplicación",
          startWeek: 11, endWeek: 19, type: "optativa",
          deliverable: "Bitácora cualitativa del trabajo de campo",
          subs: [
            "Registro narrativo de incidencias durante la aplicación"
          ]
        },
        {
          code: "2.9", title: "Re-aplicación a submuestra (fiabilidad test-retest)",
          startWeek: 18, endWeek: 19, type: "optativa",
          deliverable: "Coeficiente de estabilidad del instrumento",
          subs: [
            "Segunda aplicación a una submuestra (≈15% de la muestra)"
          ]
        }
      ]
    },
    {
      title: "FASE 3 · OE2 — Análisis Estadístico y Comparación con Literatura Internacional",
      objective: "Establecer el grado de asociación entre dependencia hacia IA y memoria de trabajo, y contrastar los hallazgos con investigaciones internacionales (Kosmyna et al., 2025; Ju, 2023; Barrera Haro, 2025).",
      color: "#b8860b",
      activities: [
        {
          code: "3.1", title: "Estadística descriptiva de las variables",
          startWeek: 20, endWeek: 21, type: "obligatoria",
          deliverable: "Tablas y gráficos descriptivos finalizados",
          subs: [
            "Distribuciones de frecuencia y porcentajes",
            "Medidas de tendencia central y dispersión (M, Mdn, DE, IQR)",
            "Histogramas y diagramas de caja en SPSS / R"
          ]
        },
        {
          code: "3.2", title: "Verificación de supuestos estadísticos",
          startWeek: 22, endWeek: 22, type: "obligatoria",
          deliverable: "Reporte de pruebas de supuestos",
          subs: [
            "Prueba de normalidad (Shapiro-Wilk)",
            "Detección y manejo de valores atípicos",
            "Decisión sobre estadística paramétrica vs. no paramétrica"
          ]
        },
        {
          code: "3.3", title: "Análisis correlacional",
          startWeek: 23, endWeek: 24, type: "critical",
          deliverable: "Hito Sem 23 · Análisis correlacional concluido (contraste de hipótesis) — matriz de correlación con coeficientes y significancia",
          subs: [
            "Coeficiente de Pearson o Spearman (según supuestos)",
            "Cálculo del tamaño del efecto (r²)",
            "Análisis de significancia estadística (p < 0,05)"
          ]
        },
        {
          code: "3.4", title: "Comparación con literatura internacional",
          startWeek: 25, endWeek: 25, type: "obligatoria",
          deliverable: "Matriz comparativa Bogotá ↔ literatura global",
          subs: [
            "Contraste con Kosmyna et al. (2025) — MIT Media Lab, EEG",
            "Contraste con Ju (2023) y Barrera Haro (2025)",
            "Identificación de convergencias y divergencias por contexto"
          ]
        },
        {
          code: "3.5", title: "Triangulación e interpretación de hallazgos",
          startWeek: 26, endWeek: 26, type: "critical",
          deliverable: "Hito Sem 26 · Reporte estadístico finalizado + matriz comparativa internacional (borrador del capítulo de discusión)",
          subs: [
            "Lectura de hallazgos a la luz del marco teórico (Sweller, 1988; Clark & Chalmers, 1998; Siemens, 2005)",
            "Discusión sobre la noción de «deuda cognitiva acumulativa»"
          ]
        },
        {
          code: "3.6", title: "Asesoría externa con especialista en estadística",
          startWeek: 22, endWeek: 22, type: "optativa",
          deliverable: "Validación externa del análisis",
          subs: [
            "Sesión de revisión metodológica del análisis correlacional"
          ]
        },
        {
          code: "3.7", title: "Análisis de regresión múltiple (variables de control)",
          startWeek: 23, endWeek: 24, type: "optativa",
          deliverable: "Modelo de regresión con variables de control",
          subs: [
            "Inclusión de variables sociodemográficas como covariables"
          ]
        }
      ]
    },
    {
      title: "FASE FINAL · Redacción del Informe Final y Socialización de Resultados",
      objective: "Consolidar el documento final con calidad académica APA 7 y socializar los hallazgos ante la comunidad académica de la UPN.",
      color: "#15803d",
      activities: [
        {
          code: "F.1", title: "Redacción del capítulo de Resultados",
          startWeek: 27, endWeek: 28, type: "obligatoria",
          deliverable: "Capítulo de Resultados completo",
          subs: [
            "Tablas y gráficos en formato APA 7.ª edición",
            "Narrativa descriptiva e interpretativa de los hallazgos"
          ]
        },
        {
          code: "F.2", title: "Redacción del capítulo de Discusión",
          startWeek: 29, endWeek: 29, type: "obligatoria",
          deliverable: "Capítulo de Discusión completo",
          subs: [
            "Conexión con marco teórico y antecedentes",
            "Diálogo crítico con la literatura internacional"
          ]
        },
        {
          code: "F.3", title: "Conclusiones, recomendaciones y limitaciones",
          startWeek: 30, endWeek: 30, type: "obligatoria",
          deliverable: "Capítulo de Conclusiones",
          subs: [
            "Conclusiones alineadas con cada objetivo específico",
            "Recomendaciones para futuras investigaciones",
            "Reconocimiento de limitaciones del alcance descriptivo–correlacional"
          ]
        },
        {
          code: "F.4", title: "Revisión integral y ajustes editoriales",
          startWeek: 31, endWeek: 31, type: "obligatoria",
          deliverable: "Documento revisado en formato APA 7",
          subs: [
            "Verificación de citas y referencias APA 7",
            "Corrección de estilo y ortotipografía",
            "Verificación de coherencia interna (objetivos ↔ resultados ↔ conclusiones)"
          ]
        },
        {
          code: "F.5", title: "Entrega final y socialización",
          startWeek: 32, endWeek: 32, type: "critical",
          deliverable: "Hito Sem 32 · Documento final entregado y socializado ante el comité (defensa pública)",
          subs: [
            "Entrega al director de tesis y comité evaluador",
            "Preparación de la defensa pública"
          ]
        },
        {
          code: "F.6", title: "Adaptación de artículo derivado para revista indexada",
          startWeek: 30, endWeek: 32, type: "optativa",
          deliverable: "Borrador de artículo (≈6.000 palabras)",
          subs: [
            "Adaptación del informe a formato de artículo científico",
            "Selección de revista objetivo (Scopus / Publindex)"
          ]
        }
      ]
    }
  ];

  /* helper: aplica una lista de fases (TPL_*) encadenando actividades */
  async function applyPhasesList(list) {
    let cursor = state.currentProject.start_date;
    let prevId = null;
    for (const ph of list) {
      const phase = await window.STORE.createPhase(state.currentProject.id, {
        title:     ph.title,
        objective: ph.objective,
        color:     ph.color
      });
      for (const act of ph.activities) {
        const start = cursor;
        const endD  = new Date(cursor + "T00:00:00");
        endD.setDate(endD.getDate() + Math.max(1, act.days) - 1);
        const end = endD.toISOString().slice(0, 10);

        const created = await window.STORE.createActivity(state.currentProject.id, {
          title:          act.title,
          phase_id:       phase.id,
          start_date:     start,
          end_date:       end,
          status:         "pending",
          priority:       act.priority,
          predecessor_id: prevId,
          progress:       0
        });
        prevId = created.id;
        const next = new Date(end + "T00:00:00");
        next.setDate(next.getDate() + 1);
        cursor = next.toISOString().slice(0, 10);
      }
    }
    await loadPhasesAndActivities();
    paintPhaseList();
    paintHero();
    renderGantt();
    playSound("add");
  }

  async function applyCronograma16B() {
    const ok = await appConfirm({
      kind: "info",
      title: "Cargar cronograma cualitativo (16 semanas)",
      message: "Se crearán 5 fases con actividades centradas en entrevistas, análisis temático y triangulación. Podrás ajustarlas después.",
      okText: "Cargar plantilla",
      cancelText: "Cancelar"
    });
    if (!ok) return;
    await applyPhasesList(TPL_CRONOGRAMA_16B);
  }

  /* ============================================================
     CALENDARIO ACADÉMICO UPN — 32 SEMANAS DE CLASE EFECTIVA
     ------------------------------------------------------------
     Cada semana = lunes (Mon) → viernes (Fri). Si el lunes (o
     viernes) es festivo colombiano, la semana se acorta a los
     días hábiles restantes.

     Festivos considerados en el rango (Ley Emiliani — Col):
       2026-2 (ago–nov 2026):
         · Vie 07-ago-2026 — Batalla de Boyacá  (Sem 1: lun-jue)
         · Lun 17-ago-2026 — Asunción de la Virgen (Sem 3: mar-vie)
         · Lun 12-oct-2026 — Día de la Raza      (Sem 11: mar-vie)
         · Lun 02-nov-2026 — Todos los Santos    (Sem 14: mar-vie)
         · Lun 16-nov-2026 — Indep. Cartagena    (Sem 16: mar-vie)

       2027-1 (feb–may 2027):
         · 22–28 mar 2027 — Semana Santa COMPLETA (omitida)
             — Lun 22 San José, Jue 25 Jueves Santo, Vie 26 Viernes Santo
         · Lun 17-may-2027 — Ascensión del Señor (Sem 31: mar-vie)

     Resumen:
       Sem 1–16  → 2026-2 (3-ago-2026 → 20-nov-2026)
       Sem 17–32 → 2027-1 (1-feb-2027 → 28-may-2027)

     Diciembre 2026 y enero 2027 quedan totalmente fuera (receso).
     Pascua 2027 = 28-mar (computus). Sem 24 se reubica al 29-mar.
     ============================================================ */
  const ACADEMIC_WEEKS = [
    /* ── 2026-2 (Sem 1–16) ─────────────────────────────────── */
    { sem: 1,  start: "2026-08-03", end: "2026-08-06", semester: "2026-2", note: "Vie 7 festivo · Batalla de Boyacá" },
    { sem: 2,  start: "2026-08-10", end: "2026-08-14", semester: "2026-2" },
    { sem: 3,  start: "2026-08-18", end: "2026-08-21", semester: "2026-2", note: "Lun 17 festivo · Asunción de la Virgen" },
    { sem: 4,  start: "2026-08-24", end: "2026-08-28", semester: "2026-2" },
    { sem: 5,  start: "2026-08-31", end: "2026-09-04", semester: "2026-2" },
    { sem: 6,  start: "2026-09-07", end: "2026-09-11", semester: "2026-2" },
    { sem: 7,  start: "2026-09-14", end: "2026-09-18", semester: "2026-2" },
    { sem: 8,  start: "2026-09-21", end: "2026-09-25", semester: "2026-2" },
    { sem: 9,  start: "2026-09-28", end: "2026-10-02", semester: "2026-2" },
    { sem: 10, start: "2026-10-05", end: "2026-10-09", semester: "2026-2" },
    { sem: 11, start: "2026-10-13", end: "2026-10-16", semester: "2026-2", note: "Lun 12 festivo · Día de la Raza" },
    { sem: 12, start: "2026-10-19", end: "2026-10-23", semester: "2026-2" },
    { sem: 13, start: "2026-10-26", end: "2026-10-30", semester: "2026-2" },
    { sem: 14, start: "2026-11-03", end: "2026-11-06", semester: "2026-2", note: "Lun 2 festivo · Todos los Santos" },
    { sem: 15, start: "2026-11-09", end: "2026-11-13", semester: "2026-2" },
    { sem: 16, start: "2026-11-17", end: "2026-11-20", semester: "2026-2", note: "Lun 16 festivo · Indep. Cartagena" },
    /* ── Receso intersemestral · 21-nov-2026 → 31-ene-2027 ── */
    /* ── 2027-1 (Sem 17–32) ──────────────────────────────── */
    { sem: 17, start: "2027-02-01", end: "2027-02-05", semester: "2027-1" },
    { sem: 18, start: "2027-02-08", end: "2027-02-12", semester: "2027-1" },
    { sem: 19, start: "2027-02-15", end: "2027-02-19", semester: "2027-1" },
    { sem: 20, start: "2027-02-22", end: "2027-02-26", semester: "2027-1" },
    { sem: 21, start: "2027-03-01", end: "2027-03-05", semester: "2027-1" },
    { sem: 22, start: "2027-03-08", end: "2027-03-12", semester: "2027-1" },
    { sem: 23, start: "2027-03-15", end: "2027-03-19", semester: "2027-1" },
    /* ── Semana Santa · 22-mar → 28-mar-2027 (omitida) ──
       absorbe San José (Lun 22), Jueves Santo (Jue 25)
       y Viernes Santo (Vie 26). Pascua = Dom 28-mar.        */
    { sem: 24, start: "2027-03-29", end: "2027-04-02", semester: "2027-1" },
    { sem: 25, start: "2027-04-05", end: "2027-04-09", semester: "2027-1" },
    { sem: 26, start: "2027-04-12", end: "2027-04-16", semester: "2027-1" },
    { sem: 27, start: "2027-04-19", end: "2027-04-23", semester: "2027-1" },
    { sem: 28, start: "2027-04-26", end: "2027-04-30", semester: "2027-1" },
    { sem: 29, start: "2027-05-03", end: "2027-05-07", semester: "2027-1" },
    { sem: 30, start: "2027-05-10", end: "2027-05-14", semester: "2027-1" },
    { sem: 31, start: "2027-05-18", end: "2027-05-21", semester: "2027-1", note: "Lun 17 festivo · Ascensión del Señor" },
    { sem: 32, start: "2027-05-24", end: "2027-05-28", semester: "2027-1" }
  ];

  function weekToRangeISO(sw, ew) {
    const a = ACADEMIC_WEEKS[sw - 1];
    const b = ACADEMIC_WEEKS[ew - 1];
    return [a.start, b.end];
  }

  function semesterLabelFor(sw, ew) {
    const a = ACADEMIC_WEEKS[sw - 1];
    const b = ACADEMIC_WEEKS[ew - 1];
    if (a.semester === b.semester) return a.semester;
    return `${a.semester} → ${b.semester} (cruza receso)`;
  }

  function weekNotesFor(sw, ew) {
    const notes = [];
    for (let w = sw; w <= ew; w++) {
      const ww = ACADEMIC_WEEKS[w - 1];
      if (ww?.note) notes.push(`Sem ${w}: ${ww.note}`);
    }
    return notes;
  }

  /* helper: aplica una lista de fases con rangos de semanas
     académicas (startWeek/endWeek) y sub-actividades vía parent_id. */
  async function applyPhasesListWeekBased(list) {
    /* Forzar fechas del proyecto al rango académico 2026-2 + 2027-1. */
    const [projectStart] = weekToRangeISO(1, 1);
    const [, projectEnd] = weekToRangeISO(32, 32);
    const patch = {};
    if (state.currentProject.start_date !== projectStart) patch.start_date = projectStart;
    if (state.currentProject.end_date   !== projectEnd)   patch.end_date   = projectEnd;
    if (Object.keys(patch).length) {
      const updated = await window.STORE.updateProject(state.currentProject.id, patch);
      if (updated) state.currentProject = updated;
      else Object.assign(state.currentProject, patch);
    }

    const weekRange = weekToRangeISO;

    const priorityFor = t => t === "critical" ? "critical" : (t === "optativa" ? "low" : "high");
    const labelFor    = t => t === "optativa" ? "Optativa" : "Obligatoria";
    const SEM_LAST_2026_2 = 16;   /* última semana del 2026-2 */

    /* helper interno: crea una "instancia" de actividad (con sus subs)
       para un rango de semanas concreto. Devuelve la id de la principal. */
    async function createOne({ phaseId, code, title, type, deliverable, subs,
                                sw, ew, suffix, prevId }) {
      const [start, end] = weekRange(sw, ew);
      const semLabel = sw === ew ? `Sem ${sw}` : `Sem ${sw}–${ew}`;
      const semester = semesterLabelFor(sw, ew);
      const notes    = weekNotesFor(sw, ew);
      const description =
        `[${labelFor(type)}] · ${semLabel} · Semestre ${semester}\n` +
        `Entregable / Hito: ${deliverable}` +
        (notes.length ? `\nFestivos en el rango: ${notes.join(" · ")}` : "");

      const main = await window.STORE.createActivity(state.currentProject.id, {
        title:          `${code} · ${title}${suffix || ""}`,
        description,
        phase_id:       phaseId,
        start_date:     start,
        end_date:       end,
        status:         "pending",
        priority:       priorityFor(type),
        predecessor_id: prevId || null,
        progress:       0
      });

      for (const sub of (subs || [])) {
        await window.STORE.createActivity(state.currentProject.id, {
          title:      sub,
          phase_id:   phaseId,
          parent_id:  main.id,
          start_date: start,
          end_date:   end,
          status:     "pending",
          priority:   type === "optativa" ? "low" : "medium",
          progress:   0
        });
      }
      return main.id;
    }

    for (const ph of list) {
      const phase = await window.STORE.createPhase(state.currentProject.id, {
        title:     ph.title,
        objective: ph.objective,
        color:     ph.color
      });
      for (const act of ph.activities) {
        const crossesReceso =
          act.startWeek <= SEM_LAST_2026_2 && act.endWeek > SEM_LAST_2026_2;

        if (crossesReceso) {
          /* Parte 1 (2026-2) — Sem startWeek..16, con sub-actividades.
             Parte 2 (2027-1) — Sem 17..endWeek, predecesora = Parte 1.
             Así no se dibuja una barra continua sobre el receso de
             dic-2026 / ene-2027. */
          const id1 = await createOne({
            phaseId:     phase.id,
            code:        act.code,
            title:       act.title,
            type:        act.type,
            deliverable: act.deliverable,
            subs:        act.subs,
            sw:          act.startWeek,
            ew:          SEM_LAST_2026_2,
            suffix:      "  (parte 1 · 2026-2)"
          });
          await createOne({
            phaseId:     phase.id,
            code:        act.code,
            title:       act.title,
            type:        act.type,
            deliverable: act.deliverable,
            subs:        [],                 /* ya se crearon bajo la parte 1 */
            sw:          SEM_LAST_2026_2 + 1,
            ew:          act.endWeek,
            suffix:      "  (parte 2 · 2027-1, continuación)",
            prevId:      id1
          });
          continue;
        }

        await createOne({
          phaseId:     phase.id,
          code:        act.code,
          title:       act.title,
          type:        act.type,
          deliverable: act.deliverable,
          subs:        act.subs,
          sw:          act.startWeek,
          ew:          act.endWeek
        });
      }
    }
    await loadPhasesAndActivities();
    paintPhaseList();
    paintHero();
    renderGantt();
    playSound("add");
  }

  async function applyCronogramaTesisIA() {
    const ok = await appConfirm({
      kind: "info",
      title: "Cargar cronograma «IA y memoria de trabajo» (32 semanas · PDF)",
      message:
        "Se crearán las 5 fases del PDF con 34 actividades, sub-actividades, entregables e hitos de control.\n\n" +
        "Calendario académico UPN — solo días de clase (lunes a viernes), sin sábados, domingos, festivos, diciembre/enero ni Semana Santa:\n" +
        "• Sem 1–16 → 2026-2 · 03-ago-2026 → 20-nov-2026\n" +
        "• Sem 17–32 → 2027-1 · 01-feb-2027 → 28-may-2027\n\n" +
        "Las actividades que cruzan el receso intersemestral (Nov-2026 → Feb-2027) se dividen en parte 1 + parte 2 enlazadas, para que el diagrama no muestre trabajo durante diciembre/enero.\n\n" +
        "Cada actividad indica en su descripción los festivos que caen dentro de su rango. Las fechas de inicio y cierre del proyecto se ajustarán automáticamente.",
      okText: "Cargar cronograma",
      cancelText: "Cancelar"
    });
    if (!ok) return;
    await applyPhasesListWeekBased(TPL_CRONOGRAMA_TESIS_IA);
  }

  async function applyCronograma32() {
    const ok = await appConfirm({
      kind: "info",
      title: "Cargar cronograma de trabajo de grado (32 semanas)",
      message: "Se crearán 6 fases con ~32 actividades semanales encadenadas: anteproyecto, marco teórico, diseño metodológico, trabajo de campo, análisis y entrega. Recomendado para tesis completa.",
      okText: "Cargar plantilla",
      cancelText: "Cancelar"
    });
    if (!ok) return;
    await applyPhasesList(TPL_CRONOGRAMA_32);
  }

  async function applyCronograma16() {
    const ok = await appConfirm({
      kind: "info",
      title: "Cargar cronograma de intervención (16 semanas)",
      message: "Se crearán 5 fases con 16 actividades semanales encadenadas, comenzando en la fecha de inicio del proyecto. Podrás ajustarlas después.",
      okText: "Cargar cronograma",
      cancelText: "Cancelar"
    });
    if (!ok) return;
    await applyPhasesList(TPL_CRONOGRAMA_16);
  }

  async function applyTemplate(key) {
    if (!state.currentProject) return;
    if (key === "cronograma16")  { await applyCronograma16();  return; }
    if (key === "cronograma16b") { await applyCronograma16B(); return; }
    if (key === "cronograma32")  { await applyCronograma32();  return; }
    if (key === "tesis-ia")      { await applyCronogramaTesisIA(); return; }
    if (key === "all") {
      const ok = await appConfirm({
        kind: "info",
        title: "Crear las 6 fases típicas del anteproyecto",
        message: "Se crearán las fases de Planteamiento, Marco teórico, Metodología, Recolección, Análisis y Conclusiones, cada una con sus actividades encadenadas. Puedes ajustarlas después.",
        okText: "Crear fases",
        cancelText: "Cancelar"
      });
      if (!ok) return;
      const order = ["problema","marco","metodologia","recoleccion","analisis","conclusiones"];
      let cursor = state.currentProject.start_date;
      for (const k of order) {
        cursor = await applyOneTemplate(k, cursor);
      }
      await loadPhasesAndActivities();
      paintPhaseList();
      paintHero();
      renderGantt();
      return;
    }
    const tpl = TEMPLATES[key];
    if (!tpl) return;
    /* posición: usar el último end_date conocido o el inicio del proyecto */
    let cursor = state.currentProject.start_date;
    if (state.activities.length) {
      const lastEnd = state.activities.reduce((m, a) => a.end_date > m ? a.end_date : m, state.activities[0].end_date);
      cursor = window.STORE.addMonthsISO(lastEnd, 0);
      /* avanzar 1 día */
      const d = new Date(cursor + "T00:00:00"); d.setDate(d.getDate() + 1);
      cursor = d.toISOString().slice(0, 10);
    }
    await applyOneTemplate(key, cursor);
    await loadPhasesAndActivities();
    paintPhaseList();
    paintHero();
    renderGantt();
  }

  async function applyOneTemplate(key, startCursor) {
    const tpl = TEMPLATES[key];
    if (!tpl) return startCursor;
    const phase = await window.STORE.createPhase(state.currentProject.id, {
      title:     tpl.title,
      objective: tpl.objective,
      color:     tpl.color
    });
    let cursor = startCursor;
    let prevId = null;
    for (const act of tpl.activities) {
      const start = cursor;
      const endD  = new Date(cursor + "T00:00:00");
      endD.setDate(endD.getDate() + Math.max(1, act.days) - 1);
      const end = endD.toISOString().slice(0, 10);

      const created = await window.STORE.createActivity(state.currentProject.id, {
        title:     act.title,
        phase_id:  phase.id,
        start_date: start,
        end_date:   end,
        status:     "pending",
        priority:   act.priority,
        predecessor_id: prevId,
        progress:  0
      });
      prevId = created.id;
      /* siguiente actividad inicia un día después */
      const next = new Date(end + "T00:00:00");
      next.setDate(next.getDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    return cursor;
  }

  /* ============================================================
     UTILS
     ============================================================ */
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function diffDays(a, b) {
    if (!a || !b) return 0;
    return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  }
  function ddmmyyyy(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
})();
