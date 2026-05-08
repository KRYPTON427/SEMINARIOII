/* ==========================================================================
   gantt.js — Renderizador del diagrama de Gantt
   --------------------------------------------------------------------------
   Funcionalidades:
     - Tres niveles en el header: meses · semanas · días
     - Barras coloreadas por fase
     - Estados: pending / progress / completed (con barra de progreso interno)
     - Prioridades: low / medium / high / critical (resaltado de borde)
     - Sub-actividades (parent_id)
     - Dependencias (predecessor_id) con validación: una actividad NO puede
       iniciar antes de que su predecesora haya iniciado
     - Detección de cruces entre actividades sin relación
     - Línea de "HOY"
     - Edición en línea de fechas y atributos
   ========================================================================== */

(function () {
  "use strict";

  const DAY_W = 30;          /* ancho de día en px */
  const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const STATUS_LABEL = {
    pending:   { icon: "○", label: "Pendiente"   },
    progress:  { icon: "◐", label: "En progreso" },
    completed: { icon: "●", label: "Completado"  }
  };
  const PRIORITY_LABEL = {
    low:      { icon: "↓", label: "Baja"     },
    medium:   { icon: "→", label: "Media"    },
    high:     { icon: "↑", label: "Alta"     },
    critical: { icon: "‼", label: "Crítica"  }
  };

  /* -------------------- helpers -------------------- */
  function parseDate(s) { return new Date(s + "T00:00:00"); }
  function fmtISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  /* Devuelve el mismo color en hex pero más oscuro (factor 0..1).
     Sustituye a color-mix() que html2canvas no soporta. */
  function darken(hex, factor = 0.6) {
    if (!hex) return "#1e3a8a";
    const m = hex.replace("#", "");
    const full = m.length === 3
      ? m.split("").map(c => c + c).join("")
      : m;
    const r = Math.round(parseInt(full.slice(0, 2), 16) * factor);
    const g = Math.round(parseInt(full.slice(2, 4), 16) * factor);
    const b = Math.round(parseInt(full.slice(4, 6), 16) * factor);
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /* lunes como inicio de semana */
  function isoWeekNum(date) {
    const d = new Date(date.getTime());
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  /* -------------------- detección de problemas -------------------- */
  /* Devuelve { overlaps: [[a,b], ...], violations: [a, ...] } */
  function detectIssues(activities) {
    const overlaps = [];
    const violations = [];
    const byId = new Map(activities.map(a => [a.id, a]));

    /* dependencias rotas: una actividad inicia antes que su predecesora */
    activities.forEach(a => {
      if (!a.predecessor_id) return;
      const p = byId.get(a.predecessor_id);
      if (!p) return;
      if (parseDate(a.start_date) < parseDate(p.start_date)) {
        violations.push({ activity: a, predecessor: p });
      }
    });

    /* cruces: dos actividades top-level OBLIGATORIAS que comparten al
       menos un día. Excluimos:
        · sub-actividades (parent_id) — comparten fecha con su padre
          por diseño y son ítems descriptivos, no rompen la planificación
        · actividades optativas — son opcionales/secundarias y pueden
          correr en paralelo a las obligatorias sin problema.
       Una optativa se identifica por priority="low" + descripción que
       comienza con "[Optativa]" (la inserta la plantilla del PDF). */
    const isSub = a => !!a.parent_id;
    const isOptional = a =>
      a.priority === "low" &&
      typeof a.description === "string" &&
      /^\s*\[Optativa\]/i.test(a.description);

    for (let i = 0; i < activities.length; i++) {
      for (let j = i + 1; j < activities.length; j++) {
        const x = activities[i], y = activities[j];
        /* ignorar parent-child y sub-actividades en general */
        if (isSub(x) || isSub(y)) continue;
        /* ignorar si una depende de la otra */
        if (x.predecessor_id === y.id || y.predecessor_id === x.id) continue;
        /* ignorar cuando alguna es optativa (paralelas al cronograma) */
        if (isOptional(x) || isOptional(y)) continue;

        const xs = parseDate(x.start_date), xe = parseDate(x.end_date);
        const ys = parseDate(y.start_date), ye = parseDate(y.end_date);
        if (xs <= ye && ys <= xe) {
          /* solapamiento real (al menos un día compartido) */
          overlaps.push([x, y]);
        }
      }
    }
    return { overlaps, violations };
  }

  /* -------------------- render principal -------------------- */
  /*
   Param:
     host       : <div> contenedor
     project    : { id, start_date, end_date, today_override? }
     phases     : [{ id, title, color, ... }]
     activities : [{ id, phase_id, parent_id, title, start_date, end_date, status, priority, predecessor_id, progress }]
     handlers   : {
        onAddActivity(prefill?)   — abrir modal nueva actividad
        onEditActivity(id)        — abrir modal con la actividad
        onDeleteActivity(id)      — confirma y borra
        onAddSubActivity(parentId)
        onUpdateActivity(id, patch) — guardar cambios inline (fechas, status, etc.)
        onAddPhase()
        onEditPhase(id)
        onDeletePhase(id)
        onIssues({ overlaps, violations })  — para que la app pinte alertas
     }
  */
  function render(host, project, phases, activities, handlers) {
    if (!host || !project) return;

    const start = project.start_date;
    const end   = project.end_date;
    const today = project.today_override || fmtISO(new Date());

    const totalDays = diffDays(start, end) + 1;
    if (totalDays <= 0) {
      host.innerHTML = `<div class="gnt-empty"><h4>Rango de fechas inválido</h4><p>El cierre del proyecto debe ser posterior al inicio.</p></div>`;
      return;
    }

    /* === issues === */
    const issues = detectIssues(activities);
    const violationIds = new Set(issues.violations.map(v => v.activity.id));
    if (handlers && handlers.onIssues) handlers.onIssues(issues, { phases, activities });

    const phaseById = new Map(phases.map(p => [p.id, p]));

    /* === header de meses / semanas / días === */
    const startDate = parseDate(start);
    const monthBlocks = [];   /* {label, span} */
    const weekBlocks  = [];   /* {label, span} */
    let daysHTML = "";

    let mCur = -1, mSpan = 0, mYear = 0;
    let wCur = -1, wSpan = 0;

    for (let i = 0; i < totalDays; i++) {
      const dt = new Date(startDate);
      dt.setDate(dt.getDate() + i);
      const m = dt.getMonth(); const y = dt.getFullYear();
      const w = isoWeekNum(dt);

      if (m !== mCur) {
        if (mSpan > 0) monthBlocks.push({ label: `${MONTHS_ES[mCur]} ${String(mYear).slice(2)}`, span: mSpan });
        mCur = m; mYear = y; mSpan = 0;
      }
      mSpan++;
      if (w !== wCur) {
        if (wSpan > 0) weekBlocks.push({ label: `S${wCur}`, span: wSpan });
        wCur = w; wSpan = 0;
      }
      wSpan++;

      const dow = dt.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = fmtISO(dt) === today;
      daysHTML += `<div class="gnt-day ${isWeekend ? 'is-weekend' : ''} ${isToday ? 'is-today' : ''}">${dt.getDate()}</div>`;
    }
    monthBlocks.push({ label: `${MONTHS_ES[mCur]} ${String(mYear).slice(2)}`, span: mSpan });
    weekBlocks.push({ label: `S${wCur}`, span: wSpan });

    const monthsHTML = monthBlocks.map(b =>
      `<div class="gnt-month" style="grid-column: span ${b.span}">${b.label}</div>`
    ).join("");
    const weeksHTML = weekBlocks.map(b =>
      `<div class="gnt-week" style="grid-column: span ${b.span}">${b.label}</div>`
    ).join("");

    const timelineWidth = totalDays * DAY_W;

    /* === construye lista jerárquica: por fase, luego huérfanos === */
    const orderedRows = []; /* {kind: phase|activity, level, data} */

    /* primero, fases en orden + sus actividades */
    phases.forEach(phase => {
      orderedRows.push({ kind: "phase", level: 0, data: phase });
      const ofPhase = activities.filter(a => a.phase_id === phase.id && !a.parent_id)
        .sort((a, b) => a.order_index - b.order_index);
      ofPhase.forEach(a => {
        orderedRows.push({ kind: "activity", level: 1, data: a });
        const subs = activities.filter(s => s.parent_id === a.id)
          .sort((x, y) => x.order_index - y.order_index);
        subs.forEach(s => orderedRows.push({ kind: "activity", level: 2, data: s }));
      });
    });

    /* actividades sin fase (huérfanas) */
    const noPhase = activities.filter(a => !a.phase_id && !a.parent_id)
      .sort((a, b) => a.order_index - b.order_index);
    if (noPhase.length) {
      orderedRows.push({ kind: "phase", level: 0, data: { id: null, title: "Sin fase", color: "#94a3b8", _virtual: true } });
      noPhase.forEach(a => {
        orderedRows.push({ kind: "activity", level: 1, data: a });
        const subs = activities.filter(s => s.parent_id === a.id)
          .sort((x, y) => x.order_index - y.order_index);
        subs.forEach(s => orderedRows.push({ kind: "activity", level: 2, data: s }));
      });
    }

    /* === construye HTML de filas === */
    let rowsHTML = "";
    let activityCounter = 0;

    if (orderedRows.length === 0) {
      rowsHTML = `
        <div class="gnt-empty">
          <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
            <rect x="8" y="14" width="48" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M8 24h48M20 8v10M44 8v10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
            <rect x="16" y="32" width="14" height="3" fill="currentColor" opacity="0.4"/>
            <rect x="22" y="40" width="20" height="3" fill="currentColor" opacity="0.4"/>
          </svg>
          <h4>Tu cronograma está vacío</h4>
          <p>Empieza creando una <b>fase</b> (ej. Marco teórico) y luego agrega actividades dentro de ella.</p>
        </div>`;
    }

    orderedRows.forEach(row => {
      if (row.kind === "phase") {
        const ph = row.data;
        const phaseActs = activities.filter(a => a.phase_id === ph.id);
        const minD = phaseActs.length ? phaseActs.reduce((m, a) => parseDate(a.start_date) < parseDate(m) ? a.start_date : m, phaseActs[0].start_date) : null;
        const maxD = phaseActs.length ? phaseActs.reduce((m, a) => parseDate(a.end_date) > parseDate(m) ? a.end_date : m, phaseActs[0].end_date) : null;
        let barHTML = "";
        if (minD && maxD) {
          const offset = clamp(diffDays(start, minD), 0, totalDays);
          const dur    = Math.max(1, diffDays(minD, maxD) + 1);
          const left = offset * DAY_W;
          const width = dur * DAY_W;
          barHTML = `<div class="gnt-bar gnt-bar--phase" style="left:${left}px; width:${width}px; background:linear-gradient(135deg, ${ph.color}, ${darken(ph.color, 0.6)});" title="${escapeHtml(ph.title)}"></div>`;
        }
        rowsHTML += `
          <div class="gnt-row is-phase" data-phase-id="${ph.id ?? ''}">
            <div class="gnt-c-num" style="background:${ph.color}; color:#fff; border-radius:0;"></div>
            <div class="gnt-c-name" data-action="edit-phase" style="cursor:pointer">
              <strong>${escapeHtml(ph.title)}</strong>
            </div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div class="gnt-c-actions">
              ${ph._virtual ? "" : `<button class="gnt-icon-btn" data-action="add-activity-in-phase" title="Agregar actividad en esta fase" aria-label="Agregar actividad en esta fase">+</button>
              <button class="gnt-icon-btn gnt-icon-btn--del" data-action="delete-phase" title="Eliminar fase" aria-label="Eliminar fase">×</button>`}
            </div>
            <div class="gnt-c-track" style="--day-w:${DAY_W}px; width:${timelineWidth}px;">
              ${barHTML}
            </div>
          </div>`;
        return;
      }

      /* activity */
      const a = row.data;
      const level = row.level;
      activityCounter++;

      const offset = clamp(diffDays(start, a.start_date), 0, totalDays);
      const dur = Math.max(1, diffDays(a.start_date, a.end_date) + 1);
      const left = offset * DAY_W;
      const width = dur * DAY_W;
      const phase = a.phase_id ? phaseById.get(a.phase_id) : null;
      const phaseColor = phase ? phase.color : "#3b82f6";
      const isViolation = violationIds.has(a.id);
      const progress = clamp(parseInt(a.progress || 0, 10), 0, 100);

      const numLabel = level === 2 ? "↳" : `${activityCounter}`;
      const rowClass = level === 2 ? "is-child" : "";
      const violationCls = isViolation ? " is-violation" : "";

      rowsHTML += `
        <div class="gnt-row ${rowClass}${violationCls}" data-activity-id="${a.id}">
          <div class="gnt-c-num">${numLabel}</div>
          <div class="gnt-c-name" data-action="edit-activity" title="Click para editar">
            ${escapeHtml(a.title)}
          </div>
          <div class="gnt-c-status">
            <select class="gnt-status gnt-status--${a.status}" data-field="status">
              <option value="pending"   ${a.status==="pending"?"selected":""}>○ Pendiente</option>
              <option value="progress"  ${a.status==="progress"?"selected":""}>◐ En progreso</option>
              <option value="completed" ${a.status==="completed"?"selected":""}>● Completado</option>
            </select>
          </div>
          <div class="gnt-c-priority">
            <select class="gnt-priority gnt-priority--${a.priority}" data-field="priority">
              <option value="low"      ${a.priority==="low"?"selected":""}>↓ Baja</option>
              <option value="medium"   ${a.priority==="medium"?"selected":""}>→ Media</option>
              <option value="high"     ${a.priority==="high"?"selected":""}>↑ Alta</option>
              <option value="critical" ${a.priority==="critical"?"selected":""}>‼ Crítica</option>
            </select>
          </div>
          <div class="gnt-c-date">
            <input type="date" data-field="start_date" value="${a.start_date}" min="${start}" max="${end}" />
          </div>
          <div class="gnt-c-date">
            <input type="date" data-field="end_date" value="${a.end_date}" min="${start}" max="${end}" />
          </div>
          <div class="gnt-c-actions">
            ${level === 1 ? `<button class="gnt-icon-btn" data-action="add-sub" title="Agregar sub-actividad" aria-label="Agregar sub-actividad">+</button>` : ""}
            <button class="gnt-icon-btn gnt-icon-btn--del" data-action="delete-activity" title="Eliminar actividad" aria-label="Eliminar actividad">×</button>
          </div>
          <div class="gnt-c-track" style="--day-w:${DAY_W}px; width:${timelineWidth}px;">
            <div class="gnt-bar gnt-bar--${a.status}" data-prio="${a.priority}"
                 style="left:${left}px; width:${width}px; background:${a.status==='pending' ? '#94a3b8' : `linear-gradient(135deg, ${phaseColor}, ${darken(phaseColor, 0.6)})`};"
                 title="${escapeHtml(a.title)} · ${a.start_date} → ${a.end_date} · ${PRIORITY_LABEL[a.priority]?.label || ''}">
              <div class="gnt-bar__progress" style="--p:${progress}%"></div>
              <span class="gnt-bar__label">${dur}d · ${progress}%</span>
            </div>
          </div>
        </div>`;
    });

    /* === línea de hoy === */
    const todayOffset = diffDays(start, today);
    const todayInRange = todayOffset >= 0 && todayOffset <= totalDays;

    /* === toolbar === */
    const completed = activities.filter(a => a.status === "completed").length;
    const inProg    = activities.filter(a => a.status === "progress").length;
    const pending   = activities.filter(a => a.status === "pending").length;

    host.innerHTML = `
      <div class="gnt-toolbar">
        <button class="app-btn app-btn--primary app-btn--sm" id="gnt-add-activity">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Nueva actividad
        </button>
        <span class="gnt-toolbar__sep"></span>
        <span class="gnt-pill gnt-pill--completed">● ${completed} completadas</span>
        <span class="gnt-pill gnt-pill--progress">◐ ${inProg} en progreso</span>
        <span class="gnt-pill gnt-pill--pending">○ ${pending} pendientes</span>
      </div>

      <div class="gnt-scroll">
        <div class="gnt-table">
          <!-- HEADER -->
          <div class="gnt-header gnt-row">
            <div class="gnt-c-num">#</div>
            <div class="gnt-c-name">Actividad</div>
            <div>Estado</div>
            <div>Prioridad</div>
            <div>Inicio</div>
            <div>Fin</div>
            <div style="text-align:center;">Acciones</div>
            <div class="gnt-c-timeline" style="width:${timelineWidth}px;">
              <div class="gnt-months" style="grid-template-columns: repeat(${totalDays}, ${DAY_W}px);">${monthsHTML}</div>
              <div class="gnt-weeks"  style="grid-template-columns: repeat(${totalDays}, ${DAY_W}px);">${weeksHTML}</div>
              <div class="gnt-days"   style="grid-template-columns: repeat(${totalDays}, ${DAY_W}px);">${daysHTML}</div>
            </div>
          </div>

          <!-- ROWS -->
          <div class="gnt-rows" style="position:relative;">
            ${rowsHTML}
            ${todayInRange ? `
              <div class="gnt-today-line" style="left: calc(32px + 230px + 120px + 120px + 108px + 108px + 62px + 1px + ${todayOffset * DAY_W}px);">
                <span>HOY</span>
              </div>` : ""}
          </div>
        </div>
      </div>

      <div class="gnt-legend">
        ${phases.map(p => `<span><i style="background:${p.color}"></i>${escapeHtml(p.title)}</span>`).join("")}
        ${phases.length ? `<span class="gnt-legend__sep">·</span>` : ""}
        <span><i style="background:#94a3b8"></i>○ Pendiente</span>
        <span><i style="background:linear-gradient(135deg,#f59e0b,#f97316)"></i>◐ En progreso</span>
        <span><i style="background:linear-gradient(135deg,#10b981,#059669)"></i>● Completado</span>
        <span class="gnt-legend__sep">·</span>
        <span style="color:var(--red);">⚠ Cruce o dependencia rota</span>
      </div>
    `;

    bindEvents(host, handlers);
    /* Mejora visual de los <select> de estado/prioridad */
    if (window.APP_UI && window.APP_UI.enhanceAllSelectsIn) {
      window.APP_UI.enhanceAllSelectsIn(host);
    }
  }

  /* -------------------- eventos -------------------- */
  function bindEvents(host, handlers) {
    if (!handlers) return;

    /* + nueva actividad */
    const addBtn = host.querySelector("#gnt-add-activity");
    if (addBtn) addBtn.addEventListener("click", () => handlers.onAddActivity && handlers.onAddActivity());

    /* filas de actividad */
    host.querySelectorAll(".gnt-row[data-activity-id]").forEach(row => {
      const id = row.dataset.activityId;

      /* click en nombre → editar */
      const nameEl = row.querySelector('[data-action="edit-activity"]');
      if (nameEl) nameEl.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        handlers.onEditActivity && handlers.onEditActivity(id);
      });

      /* selects inline */
      const statusEl = row.querySelector('[data-field="status"]');
      if (statusEl) statusEl.addEventListener("change", () => {
        const patch = { status: statusEl.value };
        if (statusEl.value === "completed") patch.progress = 100;
        if (statusEl.value === "pending") patch.progress = 0;
        handlers.onUpdateActivity && handlers.onUpdateActivity(id, patch);
      });
      const prioEl = row.querySelector('[data-field="priority"]');
      if (prioEl) prioEl.addEventListener("change", () => {
        handlers.onUpdateActivity && handlers.onUpdateActivity(id, { priority: prioEl.value });
      });
      const sEl = row.querySelector('[data-field="start_date"]');
      const eEl = row.querySelector('[data-field="end_date"]');
      if (sEl) sEl.addEventListener("change", () => {
        const patch = { start_date: sEl.value };
        if (eEl && eEl.value < sEl.value) patch.end_date = sEl.value;
        handlers.onUpdateActivity && handlers.onUpdateActivity(id, patch);
      });
      if (eEl) eEl.addEventListener("change", () => {
        const patch = { end_date: eEl.value };
        if (sEl && eEl.value < sEl.value) patch.start_date = eEl.value;
        handlers.onUpdateActivity && handlers.onUpdateActivity(id, patch);
      });

      /* acciones */
      row.querySelectorAll("[data-action]").forEach(btn => {
        const action = btn.dataset.action;
        if (action === "edit-activity") return; /* ya cubierto */
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (action === "add-sub")     handlers.onAddSubActivity && handlers.onAddSubActivity(id);
          if (action === "delete-activity") handlers.onDeleteActivity && handlers.onDeleteActivity(id);
        });
      });
    });

    /* filas de fase */
    host.querySelectorAll(".gnt-row[data-phase-id]").forEach(row => {
      const phaseId = row.dataset.phaseId;
      if (!phaseId) return;
      const nameEl = row.querySelector('[data-action="edit-phase"]');
      if (nameEl) nameEl.addEventListener("click", () => handlers.onEditPhase && handlers.onEditPhase(phaseId));
      row.querySelectorAll("[data-action]").forEach(btn => {
        const action = btn.dataset.action;
        if (action === "edit-phase") return;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (action === "add-activity-in-phase") handlers.onAddActivity && handlers.onAddActivity({ phase_id: phaseId });
          if (action === "delete-phase") handlers.onDeletePhase && handlers.onDeletePhase(phaseId);
        });
      });
    });
  }

  /* -------------------- API pública -------------------- */
  window.GanttView = {
    render,
    detectIssues,
    DAY_W,
    STATUS_LABEL,
    PRIORITY_LABEL
  };
})();
