/* ==========================================================================
   pdf.js — Exportación a PDF en formato APA
   --------------------------------------------------------------------------
   Genera:
     1) Portada APA (título, autor, institución, programa, asesor, fecha)
     2) Tabla de figuras y resumen del cronograma
     3) Diagrama de Gantt (captura del DOM)
     4) Tabla de actividades por fase (autotable)
   Requiere jsPDF + html2canvas + jspdf-autotable (cargados en app.html via CDN)
   ========================================================================== */

(function () {
  "use strict";

  /* APA estándar:
     - Margen 1 pulgada (= 72 pt)
     - Times New Roman 12 pt (cuando esté disponible) — jsPDF default es Helvetica, lo más cercano
     - Doble espacio
     - Texto alineado a la izquierda
     - Página numerada en esquina superior derecha
  */
  const PT_PER_INCH = 72;
  const MARGIN = PT_PER_INCH;             /* 1 pulgada */

  function pad2(n) { return String(n).padStart(2, "0"); }
  function ddmmyyyy(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  function spanishLongDate(d = new Date()) {
    const months = ["enero","febrero","marzo","abril","mayo","junio",
                    "julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return `${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
  }
  function statusLabel(s) {
    return ({ pending: "Pendiente", progress: "En progreso", completed: "Completado" })[s] || s;
  }
  function priorityLabel(p) {
    return ({ low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" })[p] || p;
  }
  /* jsPDF (fuentes Times/Helvetica embebidas) usa codificación WinAnsi.
     Caracteres unicode fuera de ese rango (↳ ↑↓→← ◐ ● ‼ ★ — …) salen
     como cuadraditos vacíos. Normalizamos a ASCII antes de imprimir. */
  function sanitizeForPDF(s) {
    return String(s ?? "")
      .replace(/↳/g, ">")
      .replace(/[←↑→↓↔↕↖↗↘↙]/g, "")
      .replace(/[○◐●◎]/g, "")
      .replace(/‼/g, "!")
      .replace(/★/g, "*")
      .replace(/…/g, "...")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ============================================================
     PORTADA APA
     ============================================================ */
  function renderCover(doc, project, user) {
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();

    /* página número (APA: arriba derecha, Times 12) */
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.text("1", w - MARGIN, MARGIN - 24, { align: "right" });

    /* título centrado verticalmente más arriba (1/3 de la página) */
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    const title = sanitizeForPDF(project.title || "Cronograma de anteproyecto");
    const titleLines = doc.splitTextToSize(title, w - MARGIN * 2);
    const titleY = h * 0.33;
    titleLines.forEach((line, i) => {
      doc.text(line, w / 2, titleY + i * 18, { align: "center" });
    });

    /* sub-info bajo el título */
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    let y = titleY + titleLines.length * 18 + 36;

    const author = sanitizeForPDF(project.author || user?.user_metadata?.name || user?.email || "-");
    const institution = sanitizeForPDF(project.university || user?.user_metadata?.university || "-");
    const program = sanitizeForPDF(project.program || user?.user_metadata?.program || "-");
    const advisor = project.advisor ? sanitizeForPDF(`Director(a): ${project.advisor}`) : "";

    const lines = [
      author,
      institution,
      program,
      advisor,
      "",
      spanishLongDate(new Date())
    ].filter(Boolean);
    lines.forEach(line => {
      doc.text(line, w / 2, y, { align: "center" });
      y += 18;
    });

    /* etiqueta de cronograma abajo */
    doc.setFont("times", "italic");
    doc.setFontSize(11);
    doc.text("Cronograma de actividades · formato APA",
      w / 2, h - MARGIN - 12, { align: "center" });
  }

  /* ============================================================
     PÁGINA DE RESUMEN
     ============================================================ */
  function renderSummary(doc, project, phases, activities, pageNo) {
    doc.addPage();
    const w = doc.internal.pageSize.getWidth();

    /* page number */
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.text(String(pageNo), w - MARGIN, MARGIN - 24, { align: "right" });

    /* heading APA Nivel 1 — centrado, negrita, mayúscula inicial */
    doc.setFont("times", "bold");
    doc.setFontSize(13);
    doc.text("Resumen del cronograma", w / 2, MARGIN, { align: "center" });

    /* cuerpo */
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    let y = MARGIN + 28;

    const total = activities.length;
    const completed = activities.filter(a => a.status === "completed").length;
    const inProg = activities.filter(a => a.status === "progress").length;
    const pending = activities.filter(a => a.status === "pending").length;
    const avgProgress = total
      ? Math.round(activities.reduce((s, a) => s + (parseInt(a.progress || 0, 10)), 0) / total)
      : 0;

    const paragraphs = [
      `Inicio del proyecto: ${ddmmyyyy(project.start_date)}.`,
      `Cierre del proyecto: ${ddmmyyyy(project.end_date)}.`,
      `Total de fases definidas: ${phases.length}.`,
      `Total de actividades programadas: ${total}.`,
      `Estado general: ${completed} completadas, ${inProg} en progreso y ${pending} pendientes.`,
      `Avance global ponderado: ${avgProgress}%.`
    ];
    paragraphs.forEach(p => {
      const wrapped = doc.splitTextToSize(p, w - MARGIN * 2);
      wrapped.forEach(line => {
        doc.text(line, MARGIN, y);
        y += 16;
      });
    });

    y += 14;
    doc.setFont("times", "bold");
    doc.text("Fases del proyecto", MARGIN, y);
    y += 18;
    doc.setFont("times", "normal");
    if (phases.length === 0) {
      doc.text("No se han definido fases.", MARGIN, y);
    } else {
      phases.forEach((p, i) => {
        const obj = p.objective ? ` — ${p.objective}` : "";
        const wrapped = doc.splitTextToSize(`${i + 1}. ${p.title}${obj}`, w - MARGIN * 2);
        wrapped.forEach(line => {
          doc.text(line, MARGIN, y);
          y += 16;
        });
      });
    }
  }

  /* ============================================================
     CRONOGRAMA EN UNA SOLA HOJA — formato académico APA
     Header: Meses* (numerados 1..N) · Semanas (S1..SN)
     Cuerpo: filas de actividades, recuadros en las semanas activas
     Auto-encaja todas las actividades en la misma página A4 horizontal
     ============================================================ */
  function renderSingleSheetGantt(doc, project, phases, activities, pageNo) {
    if (!activities.length) return pageNo;

    /* ---------- helpers ---------- */
    const parseISO = (s) => new Date(s + "T00:00:00");

    function truncate(text, maxWidth, fontSize) {
      doc.setFontSize(fontSize);
      let s = String(text || "");
      if (doc.getTextWidth(s) <= maxWidth) return s;
      while (doc.getTextWidth(s + "…") > maxWidth && s.length > 1) s = s.slice(0, -1);
      return s + "…";
    }

    /* ---------- semanas ---------- */
    const startD = parseISO(project.start_date);
    const endD   = parseISO(project.end_date);
    /* alineamos al lunes */
    const startMon = new Date(startD);
    const dow = startMon.getDay() || 7;
    startMon.setDate(startMon.getDate() - (dow - 1));
    const totalWeeks = Math.max(1,
      Math.ceil((endD - startMon) / (7 * 86400000)) + 1
    );
    /* meses académicos: cada 4 semanas = 1 mes */
    const WEEKS_PER_MONTH = 4;
    const totalMonths = Math.ceil(totalWeeks / WEEKS_PER_MONTH);

    function activityWeekRange(act) {
      const aStart = parseISO(act.start_date);
      const aEnd   = parseISO(act.end_date);
      const sW = Math.floor((aStart - startMon) / (7 * 86400000)) + 1;
      const eW = Math.floor((aEnd   - startMon) / (7 * 86400000)) + 1;
      return { start: Math.max(1, sW), end: Math.min(totalWeeks, eW) };
    }

    /* ---------- orden por fase + actividades ---------- */
    const phaseById = new Map(phases.map(p => [p.id, p]));
    const sortedActs = activities.slice().sort((a, b) => {
      const fa = phaseById.get(a.phase_id)?.order_index ?? 999;
      const fb = phaseById.get(b.phase_id)?.order_index ?? 999;
      if (fa !== fb) return fa - fb;
      return a.order_index - b.order_index;
    });

    /* ---------- página ---------- */
    doc.addPage("a4", "landscape");
    const pW = 842, pH = 595;
    const margin = 24;

    /* page number */
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(String(pageNo), pW - margin, margin - 6, { align: "right" });

    /* título APA */
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text("Figura 1", margin, margin);
    doc.setFont("times", "italic");
    doc.text("Cronograma de actividades", margin, margin + 12);

    /* ---------- tabla ---------- */
    const tableX = margin;
    const tableY = margin + 24;
    const tableMaxH = pH - tableY - margin - 18;   /* 18pt nota al pie */

    const activityColW = 180;
    const availW = pW - margin * 2 - activityColW;
    const weekColW = availW / totalWeeks;

    const monthsRowH = 14;
    const weeksRowH  = 12;
    const headerH    = monthsRowH + weeksRowH;

    /* fila de actividades: ajustamos altura para que TODAS entren */
    const rowsAvailH = tableMaxH - headerH;
    const idealRowH = 18;
    const minRowH = 9;
    const rowH = Math.max(
      minRowH,
      Math.min(idealRowH, rowsAvailH / Math.max(1, sortedActs.length))
    );
    const fontByRow = rowH >= 14 ? 8 : rowH >= 11 ? 7 : 6;

    /* ---------- HEADER ---------- */
    doc.setLineWidth(0.45);
    doc.setDrawColor(0, 0, 0);
    doc.setFillColor(255, 255, 255);

    /* celda ACTIVIDADES (rowSpan visual) */
    doc.rect(tableX, tableY, activityColW, headerH, "S");
    doc.setFont("times", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(0, 0, 0);
    /* "Meses*" arriba a la derecha del encabezado, "ACTIVIDADES" centrado */
    doc.text("ACTIVIDADES", tableX + 8, tableY + headerH / 2 + 1);
    doc.setFont("times", "italic");
    doc.setFontSize(7);
    doc.text("Meses*", tableX + activityColW - 4, tableY + monthsRowH - 4, { align: "right" });
    doc.text("Semanas", tableX + activityColW - 4, tableY + monthsRowH + weeksRowH - 4, { align: "right" });

    /* MESES (1..N), cada uno spanning 4 semanas */
    let mX = tableX + activityColW;
    doc.setFont("times", "bold");
    doc.setFontSize(8.5);
    for (let m = 0; m < totalMonths; m++) {
      const wStart = m * WEEKS_PER_MONTH + 1;
      const wEnd   = Math.min(totalWeeks, (m + 1) * WEEKS_PER_MONTH);
      const span   = wEnd - wStart + 1;
      const colW   = span * weekColW;
      doc.rect(mX, tableY, colW, monthsRowH, "S");
      doc.text(String(m + 1), mX + colW / 2, tableY + monthsRowH - 4, { align: "center" });
      mX += colW;
    }

    /* SEMANAS S1..SN */
    let wX = tableX + activityColW;
    doc.setFont("times", "normal");
    const wkFontSize = weekColW >= 14 ? 7 : weekColW >= 9 ? 6 : 5;
    doc.setFontSize(wkFontSize);
    for (let w = 1; w <= totalWeeks; w++) {
      doc.rect(wX, tableY + monthsRowH, weekColW, weeksRowH, "S");
      if (weekColW >= 5) {
        doc.text(String(w), wX + weekColW / 2, tableY + monthsRowH + weeksRowH - 3.5, { align: "center" });
      }
      wX += weekColW;
    }

    /* ---------- BODY ---------- */
    let rowY = tableY + headerH;
    doc.setFont("times", "normal");
    doc.setTextColor(0, 0, 0);

    sortedActs.forEach((act, idx) => {
      /* fondo alterno suave para legibilidad */
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(tableX, rowY, activityColW + availW, rowH, "F");
      }

      /* celda nombre actividad */
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.35);
      doc.rect(tableX, rowY, activityColW, rowH, "S");
      doc.setFontSize(fontByRow);
      doc.setTextColor(0, 0, 0);
      doc.text(
        truncate(act.title, activityColW - 8, fontByRow),
        tableX + 4,
        rowY + rowH / 2 + fontByRow / 3
      );

      /* celdas de semanas */
      let cellX = tableX + activityColW;
      for (let w = 1; w <= totalWeeks; w++) {
        doc.rect(cellX, rowY, weekColW, rowH, "S");
        cellX += weekColW;
      }

      /* recuadro de actividad activa */
      const range = activityWeekRange(act);
      if (range.end >= 1 && range.start <= totalWeeks) {
        const visS = Math.max(1, range.start);
        const visE = Math.min(totalWeeks, range.end);
        const padX = Math.min(1.5, weekColW * 0.18);
        const padY = Math.min(1.5, rowH * 0.18);
        const barX = tableX + activityColW + (visS - 1) * weekColW + padX;
        const barW = (visE - visS + 1) * weekColW - padX * 2;
        const barY = rowY + padY;
        const barH = rowH - padY * 2;

        /* color por estado */
        let mode = "S";
        if (act.status === "completed") {
          doc.setFillColor(60, 60, 60);
          mode = "FD";
        } else if (act.status === "progress") {
          doc.setFillColor(190, 190, 190);
          mode = "FD";
        }
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.5);
        doc.rect(barX, barY, Math.max(0.5, barW), Math.max(0.5, barH), mode);
      }

      rowY += rowH;
    });

    /* ---------- nota APA + leyenda ---------- */
    doc.setFont("times", "italic");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(
      "Nota. Elaboración propia. Cada celda representa una semana de trabajo dentro del mes académico (4 semanas por mes).",
      margin, pH - margin - 6
    );

    /* leyenda inline (Pendiente / En progreso / Completado) */
    const legY = pH - margin - 6;
    let legX = pW - margin - 200;
    const swSize = 7;
    doc.setFont("times", "normal");
    doc.setFontSize(7.5);
    /* Pendiente */
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.45);
    doc.rect(legX, legY - swSize + 1, swSize, swSize, "S");
    doc.text("Pendiente", legX + swSize + 2, legY);
    /* En progreso */
    legX += 60;
    doc.setFillColor(190, 190, 190);
    doc.rect(legX, legY - swSize + 1, swSize, swSize, "FD");
    doc.text("En progreso", legX + swSize + 2, legY);
    /* Completado */
    legX += 65;
    doc.setFillColor(60, 60, 60);
    doc.rect(legX, legY - swSize + 1, swSize, swSize, "FD");
    doc.text("Completado", legX + swSize + 2, legY);

    return pageNo + 1;
  }

  /* ============================================================
     [LEGADO] Render nativo con barras de color (multi-página)
     Replica el Gantt de la web SIN html2canvas, así no se corta y
     se mantiene nítido a cualquier zoom. Pagina horizontalmente
     si la línea de tiempo es más ancha que la página.
     ============================================================ */
  function renderNativeGantt(doc, project, phases, activities, startPageNo) {
    if (!activities.length) return startPageNo;

    const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

    /* ---------- helpers ---------- */
    const parseISO = (s) => new Date(s + "T00:00:00");
    const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
    function hexToRgb(hex) {
      const h = (hex || "#3b82f6").replace("#", "");
      const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
      return [parseInt(f.slice(0,2),16), parseInt(f.slice(2,4),16), parseInt(f.slice(4,6),16)];
    }
    function truncate(text, maxWidth) {
      let s = sanitizeForPDF(text);
      if (doc.getTextWidth(s) <= maxWidth) return s;
      while (doc.getTextWidth(s + "...") > maxWidth && s.length > 1) s = s.slice(0, -1);
      return s + "...";
    }
    function isoWeek(date) {
      const d = new Date(date.getTime());
      d.setHours(0,0,0,0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    /* ---------- orden jerárquico ---------- */
    const phaseById = new Map(phases.map(p => [p.id, p]));
    const ordered = [];
    phases.forEach(phase => {
      const ofPhase = activities.filter(a => a.phase_id === phase.id && !a.parent_id)
        .sort((a, b) => a.order_index - b.order_index);
      ordered.push({ kind: "phase", data: phase });
      ofPhase.forEach(a => {
        ordered.push({ kind: "activity", data: a, phase });
        const subs = activities.filter(s => s.parent_id === a.id)
          .sort((x, y) => x.order_index - y.order_index);
        subs.forEach(s => ordered.push({ kind: "sub", data: s, phase }));
      });
    });
    const noPhase = activities.filter(a => !a.phase_id && !a.parent_id);
    if (noPhase.length) {
      const virtual = { id: null, title: "Sin fase", color: "#94a3b8" };
      ordered.push({ kind: "phase", data: virtual });
      noPhase.sort((a,b) => a.order_index - b.order_index).forEach(a => {
        ordered.push({ kind: "activity", data: a, phase: virtual });
        const subs = activities.filter(s => s.parent_id === a.id);
        subs.forEach(s => ordered.push({ kind: "sub", data: s, phase: virtual }));
      });
    }

    /* ---------- layout ---------- */
    const totalDays = diffDays(project.start_date, project.end_date) + 1;
    const startD = parseISO(project.start_date);

    /* página A4 landscape: 842 x 595 pt */
    const pageW = 842, pageH = 595;
    const margin = 28;
    const labelsW = 200;          /* ancho de la columna ACTIVIDAD */
    const titleH  = 52;            /* titulo institucional + Figura 1 + caption */
    const headerH = 36;            /* meses + semanas + días, 12pt c/u */
    const rowH    = 16;
    const noteH   = 40;            /* 3 líneas: Nota APA + URL + créditos */

    const availTimelineW = pageW - margin * 2 - labelsW;
    const availContentH  = pageH - margin * 2 - titleH - headerH - noteH;
    const rowsPerPage    = Math.floor(availContentH / rowH);

    /* Estrategia: detectamos huecos largos sin actividad (≥14 días) —
       típicamente el receso intersemestral — y partimos el Gantt allí,
       sin cortar barras de actividad. Cada chunk horizontal se ajusta
       a su propio ancho de página, así los días son más grandes y los
       labels (Nd · X%) caben dentro de las barras. */
    const idealDayW = 9;
    const minDayW   = 1.5;
    const maxDayW   = 30;
    const minGapDays = 14;

    /* marcar días con actividad activa */
    const isActive = new Array(totalDays).fill(false);
    activities.forEach(a => {
      if (!a || !a.start_date || !a.end_date) return;
      const s = diffDays(project.start_date, a.start_date);
      const e = diffDays(project.start_date, a.end_date);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return;
      for (let d = Math.max(0, s); d <= Math.min(totalDays - 1, e); d++) {
        isActive[d] = true;
      }
    });

    /* armar chunks de fechas saltando huecos largos */
    const dateChunks = [];
    let cStart = -1, gapLen = 0;
    for (let d = 0; d < totalDays; d++) {
      if (isActive[d]) {
        if (cStart < 0) cStart = d;
        if (gapLen >= minGapDays && dateChunks.length && dateChunks[dateChunks.length - 1].dayEnd === undefined) {
          /* nunca llegamos aquí — limpieza por si acaso */
        }
        gapLen = 0;
      } else if (cStart >= 0) {
        gapLen++;
        if (gapLen === minGapDays) {
          /* cerramos el chunk en el último día activo */
          dateChunks.push({ dayStart: cStart, dayEnd: d - minGapDays + 1 });
          cStart = -1;
        }
      }
    }
    if (cStart >= 0) dateChunks.push({ dayStart: cStart, dayEnd: totalDays - gapLen });
    if (!dateChunks.length) dateChunks.push({ dayStart: 0, dayEnd: totalDays });

    /* dayW por chunk: queremos que los labels "Nd · X%" sean visibles,
       así que mantenemos dayW=9pt como ideal. Si el chunk no cabe con
       9pt, lo subdividimos en sub-páginas dentro del mismo semestre. */
    const expandedChunks = [];
    for (const c of dateChunks) {
      const days = c.dayEnd - c.dayStart;
      const fit  = availTimelineW / days;
      if (fit >= idealDayW) {
        /* todo el chunk cabe con día grande → usamos el fit para
           rellenar el ancho disponible (sin pasar de maxDayW) */
        expandedChunks.push({
          dayStart: c.dayStart, dayEnd: c.dayEnd,
          dayW: Math.min(maxDayW, fit)
        });
      } else {
        /* el chunk es más largo que una página a 9pt/día →
           subdividirlo en páginas de daysPerPage días, manteniendo
           idealDayW para que las barras tengan label legible. */
        const dW = idealDayW;
        const dpp = Math.floor(availTimelineW / dW);
        for (let s = c.dayStart; s < c.dayEnd; s += dpp) {
          expandedChunks.push({
            dayStart: s,
            dayEnd: Math.min(c.dayEnd, s + dpp),
            dayW: dW
          });
        }
      }
    }
    const totalChunksH = expandedChunks.length;

    /* paginación SOLO vertical (cuando hay muchas actividades) */
    const verticalChunks = Math.max(1, Math.ceil(ordered.length / rowsPerPage));

    /* fechas/datos comunes */
    const todayStr = project.today_override || new Date().toISOString().slice(0, 10);
    const todayOffset = diffDays(project.start_date, todayStr);

    /* helper: ¿hay barras de ACTIVIDAD visibles en este chunk
       (date-band × row-band)? Solo contamos actividades/sub-actividades.
       Los headers de fase no cuentan porque su barra abarca toda la
       fase y haría que se generen páginas con sólo la franja de fase
       y los nombres de actividades sin barras. */
    function hasContentInChunk(dayStart, dayEnd, rows) {
      for (const item of rows) {
        if (!item || item.kind === "phase") continue;
        const act = item.data;
        if (!act || !act.start_date || !act.end_date) continue;
        const sOff = diffDays(project.start_date, act.start_date);
        const eOff = diffDays(project.start_date, act.end_date) + 1;
        if (!Number.isFinite(sOff) || !Number.isFinite(eOff)) continue;
        if (eOff > dayStart && sOff < dayEnd) return true;
      }
      return false;
    }

    /* primera pasada: contar páginas con contenido (para "parte X de Y") */
    let totalValidPages = 0;
    for (let hh = 0; hh < totalChunksH; hh++) {
      const ec = expandedChunks[hh];
      for (let vv = 0; vv < verticalChunks; vv++) {
        const rStart = vv * rowsPerPage;
        const rEnd   = Math.min(ordered.length, rStart + rowsPerPage);
        if (hasContentInChunk(ec.dayStart, ec.dayEnd, ordered.slice(rStart, rEnd))) totalValidPages++;
      }
    }
    if (totalValidPages === 0) return startPageNo;

    let currentPage = startPageNo;

    /* ---------- páginas ---------- */
    for (let h = 0; h < totalChunksH; h++) {
      const ec = expandedChunks[h];
      const dayStart = ec.dayStart;
      const dayEnd   = ec.dayEnd;
      const dayW     = ec.dayW;
      const chunkDays = dayEnd - dayStart;
      const timelineW = chunkDays * dayW;

      for (let v = 0; v < verticalChunks; v++) {
        const rowStart = v * rowsPerPage;
        const rowEnd   = Math.min(ordered.length, rowStart + rowsPerPage);
        const rows = ordered.slice(rowStart, rowEnd);

        /* SALTAR páginas sin barras visibles (combinación date×row vacía) */
        if (!hasContentInChunk(dayStart, dayEnd, rows)) continue;

        doc.addPage("a4", "landscape");

        /* page number */
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(String(currentPage), pageW - margin, margin - 8, { align: "right" });

        /* TÍTULO PRINCIPAL — CRONOGRAMA DE ACTIVIDADES (centrado) */
        doc.setFont("times", "bold");
        doc.setFontSize(15);
        doc.setTextColor(15, 23, 42);
        doc.text("CRONOGRAMA DE ACTIVIDADES", pageW / 2, margin + 4, { align: "center" });
        /* línea decorativa bajo el título */
        doc.setDrawColor(203, 132, 27);
        doc.setLineWidth(0.8);
        doc.line(pageW / 2 - 80, margin + 8, pageW / 2 + 80, margin + 8);

        /* título APA: Figura 1 + caption */
        doc.setFont("times", "bold");
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text("Figura 1", margin, margin + 22);
        doc.setFont("times", "italic");
        doc.setFontSize(11);
        const partLabel = totalValidPages > 1
          ? ` (parte ${currentPage - startPageNo + 1} de ${totalValidPages})`
          : "";
        doc.text(`Diagrama de Gantt del cronograma${partLabel}`, margin, margin + 35);

        const tableX = margin;
        const tableY = margin + titleH;
        const timelineX = tableX + labelsW;
        const totalTableW = labelsW + timelineW;

        /* ===== HEADER ===== */
        const monthsRowY = tableY;
        const weeksRowY  = tableY + headerH / 3;
        const daysRowY   = tableY + (headerH * 2) / 3;
        const subH = headerH / 3;

        /* fondo zona ACTIVIDAD — degradado sutil con borde derecho fuerte */
        doc.setFillColor(241, 245, 249);
        doc.rect(tableX, tableY, labelsW, headerH, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(30, 41, 59);
        doc.text("ACTIVIDAD", tableX + 6, tableY + headerH - 5);
        /* línea dorada sutil bajo "ACTIVIDAD" */
        doc.setDrawColor(203, 132, 27);
        doc.setLineWidth(0.4);
        doc.line(tableX + 6, tableY + headerH - 3, tableX + 56, tableY + headerH - 3);

        /* MESES — banda azul oscuro con texto blanco */
        let mCur = -1, mStartX = timelineX, mYear = 0;
        let curX = timelineX;
        for (let d = 0; d < chunkDays; d++) {
          const dt = new Date(startD); dt.setDate(dt.getDate() + dayStart + d);
          const m = dt.getMonth();
          if (m !== mCur) {
            if (mCur >= 0) {
              const w = curX - mStartX;
              /* fondo de mes (azul muy oscuro) */
              doc.setFillColor(30, 41, 59);
              doc.rect(mStartX, monthsRowY, w, subH, "F");
              doc.setTextColor(255, 255, 255);
              doc.setFont("helvetica", "bold");
              doc.setFontSize(8);
              doc.text(`${MONTHS[mCur]} ${String(mYear).slice(2)}`,
                mStartX + w / 2, monthsRowY + subH - 3.5, { align: "center" });
              /* divisor entre meses */
              doc.setDrawColor(255, 255, 255);
              doc.setLineWidth(0.6);
              doc.line(curX, monthsRowY, curX, daysRowY + subH);
            }
            mCur = m; mYear = dt.getFullYear(); mStartX = curX;
          }
          curX += dayW;
        }
        if (mCur >= 0) {
          const w = curX - mStartX;
          doc.setFillColor(30, 41, 59);
          doc.rect(mStartX, monthsRowY, w, subH, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(`${MONTHS[mCur]} ${String(mYear).slice(2)}`,
            mStartX + w / 2, monthsRowY + subH - 3.5, { align: "center" });
        }

        /* SEMANAS — banda intermedia gris claro con label "SXX" */
        doc.setFillColor(226, 232, 240);
        doc.rect(timelineX, weeksRowY, chunkDays * dayW, subH, "F");
        const showWeekLabel = (dayW * 7) >= 12;
        let wCur = -1, wStartX = timelineX;
        curX = timelineX;
        for (let d = 0; d < chunkDays; d++) {
          const dt = new Date(startD); dt.setDate(dt.getDate() + dayStart + d);
          const w = isoWeek(dt);
          if (w !== wCur) {
            if (wCur >= 0) {
              const wW = curX - wStartX;
              if (showWeekLabel) {
                doc.setTextColor(51, 65, 85);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(6);
                doc.text(`S${wCur}`, wStartX + wW / 2, weeksRowY + subH - 2.5, { align: "center" });
              }
              doc.setDrawColor(148, 163, 184);
              doc.setLineWidth(0.3);
              doc.line(curX, weeksRowY, curX, daysRowY + subH);
            }
            wCur = w; wStartX = curX;
          }
          curX += dayW;
        }
        if (wCur >= 0 && showWeekLabel) {
          const wW = curX - wStartX;
          doc.setTextColor(51, 65, 85);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6);
          doc.text(`S${wCur}`, wStartX + wW / 2, weeksRowY + subH - 2.5, { align: "center" });
        }

        /* DÍAS — adaptativo según el ancho disponible */
        let dayFontSize, dayStep;
        if (dayW >= 14)       { dayFontSize = 8;   dayStep = 1; }
        else if (dayW >= 10)  { dayFontSize = 7;   dayStep = 1; }
        else if (dayW >= 8)   { dayFontSize = 6;   dayStep = 1; }
        else if (dayW >= 5)   { dayFontSize = 5;   dayStep = 1; }
        else if (dayW >= 3.5) { dayFontSize = 4;   dayStep = 1; }
        else if (dayW >= 2.2) { dayFontSize = 4;   dayStep = 2; }
        else                  { dayFontSize = 4;   dayStep = 7; }

        curX = timelineX;
        for (let d = 0; d < chunkDays; d++) {
          const dt = new Date(startD); dt.setDate(dt.getDate() + dayStart + d);
          const dow = dt.getDay();
          const isWeekend = dow === 0 || dow === 6;
          if (isWeekend) {
            doc.setFillColor(241, 245, 249);
            doc.rect(curX, daysRowY, dayW, subH, "F");
          }
          if (d % dayStep === 0) {
            doc.setTextColor(100, 116, 139);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(dayFontSize);
            doc.text(String(dt.getDate()), curX + dayW / 2, daysRowY + subH - 2.5, { align: "center" });
          }
          curX += dayW;
        }

        /* borde general del header */
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.5);
        doc.rect(tableX, tableY, totalTableW, headerH, "S");
        doc.line(tableX, weeksRowY, tableX + totalTableW, weeksRowY);
        doc.line(tableX, daysRowY,  tableX + totalTableW, daysRowY);
        doc.line(timelineX, tableY, timelineX, tableY + headerH);

        /* ===== RETÍCULA del cuerpo del Gantt =====
           Capas (de abajo hacia arriba):
            1. Zebra rows (alternando blanco / gris muy suave)
            2. Columnas de fin de semana (gris ligeramente más oscuro)
            3. Líneas verticales: día (sutil) > semana (definida) > mes (fuerte)
            4. Líneas horizontales por fila */
        const bodyTop    = tableY + headerH;
        const bodyBottom = bodyTop + rows.length * rowH;

        /* 1. ZEBRA: filas alternas con un tinte gris muy suave */
        rows.forEach((item, rIdx) => {
          if (item.kind !== "phase" && rIdx % 2 === 1) {
            doc.setFillColor(250, 251, 253);
            doc.rect(tableX, bodyTop + rIdx * rowH, totalTableW, rowH, "F");
          }
        });

        /* 2. fondo en columnas de fin de semana — más visible que antes */
        for (let d = 0; d < chunkDays; d++) {
          const dt = new Date(startD); dt.setDate(dt.getDate() + dayStart + d);
          const dow = dt.getDay();
          if (dow === 0 || dow === 6) {
            const x = timelineX + d * dayW;
            doc.setFillColor(238, 242, 247);
            doc.rect(x, bodyTop, dayW, bodyBottom - bodyTop, "F");
          }
        }

        /* 3a. líneas verticales por día (muy claras) */
        if (dayW >= 3) {
          doc.setDrawColor(232, 236, 243);
          doc.setLineWidth(0.15);
          for (let d = 1; d < chunkDays; d++) {
            const x = timelineX + d * dayW;
            doc.line(x, bodyTop, x, bodyBottom);
          }
        }

        /* 3b. líneas verticales por semana (cada lunes) — más visibles */
        doc.setDrawColor(176, 190, 207);
        doc.setLineWidth(0.4);
        for (let d = 0; d < chunkDays; d++) {
          const dt = new Date(startD); dt.setDate(dt.getDate() + dayStart + d);
          if (dt.getDay() === 1 && d > 0) {
            const x = timelineX + d * dayW;
            doc.line(x, bodyTop, x, bodyBottom);
          }
        }

        /* 3c. líneas verticales por mes (acento dorado UPN) */
        doc.setDrawColor(203, 132, 27);
        doc.setLineWidth(0.6);
        for (let d = 0; d < chunkDays; d++) {
          const dt = new Date(startD); dt.setDate(dt.getDate() + dayStart + d);
          if (dt.getDate() === 1 && d > 0) {
            const x = timelineX + d * dayW;
            doc.line(x, bodyTop, x, bodyBottom);
          }
        }

        /* 4. líneas horizontales por fila */
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        for (let r = 1; r < rows.length; r++) {
          const y = bodyTop + r * rowH;
          doc.line(tableX, y, tableX + totalTableW, y);
        }
        /* línea horizontal más fuerte bajo el header */
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.5);
        doc.line(tableX, bodyTop, tableX + totalTableW, bodyTop);

        /* ===== ROWS ===== */
        let rowY = tableY + headerH;
        rows.forEach(item => {
          if (item.kind === "phase") {
            const ph = item.data;
            const pc = hexToRgb(ph.color);
            /* fondo de fase: tinte muy suave del color de la fase */
            const tint = pc.map(c => Math.round(c + (255 - c) * 0.92));
            doc.setFillColor(tint[0], tint[1], tint[2]);
            doc.rect(tableX, rowY, totalTableW, rowH, "F");
            /* franja vertical de color a la izquierda (más ancha) */
            doc.setFillColor(pc[0], pc[1], pc[2]);
            doc.rect(tableX, rowY, 5, rowH, "F");
            /* título */
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            doc.setTextColor(pc[0] * 0.6, pc[1] * 0.6, pc[2] * 0.6);
            doc.text(truncate(ph.title, labelsW - 16), tableX + 10, rowY + rowH * 0.66);
            /* línea horizontal superior para reforzar separación */
            doc.setDrawColor(pc[0], pc[1], pc[2]);
            doc.setLineWidth(0.4);
            doc.line(tableX, rowY, tableX + totalTableW, rowY);

            /* mini barra de fase (rango total de sus actividades) */
            const phaseActs = activities.filter(a => a.phase_id === ph.id);
            if (phaseActs.length) {
              const minS = phaseActs.reduce((m, a) => a.start_date < m ? a.start_date : m, phaseActs[0].start_date);
              const maxE = phaseActs.reduce((m, a) => a.end_date  > m ? a.end_date  : m, phaseActs[0].end_date);
              const sOff = diffDays(project.start_date, minS);
              const eOff = diffDays(project.start_date, maxE) + 1;
              if (eOff > dayStart && sOff < dayEnd) {
                const visS = Math.max(sOff, dayStart);
                const visE = Math.min(eOff, dayEnd);
                const bx = timelineX + (visS - dayStart) * dayW;
                const bw = (visE - visS) * dayW;
                const by = rowY + rowH / 2 - 3;
                doc.setFillColor(pc[0], pc[1], pc[2]);
                doc.rect(bx, by, bw, 6, "F");
              }
            }
          } else {
            /* actividad o sub-actividad */
            const act = item.data;
            const phase = item.phase;
            const pc = hexToRgb(phase?.color || "#3b82f6");

            /* nombre */
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            const isSub = item.kind === "sub";
            doc.setTextColor(isSub ? 100 : 15, isSub ? 116 : 23, isSub ? 139 : 42);
            const indent = isSub ? 14 : 8;
            const prefix = isSub ? "↳ " : "";
            doc.text(truncate(prefix + act.title, labelsW - indent - 2),
              tableX + indent, rowY + rowH * 0.65);

            /* barra */
            const sOff = diffDays(project.start_date, act.start_date);
            const dur  = diffDays(act.start_date, act.end_date) + 1;
            const eOff = sOff + dur;
            if (eOff > dayStart && sOff < dayEnd) {
              const visS = Math.max(sOff, dayStart);
              const visE = Math.min(eOff, dayEnd);
              const visDur = visE - visS;
              const bx = timelineX + (visS - dayStart) * dayW;
              const bw = visDur * dayW;
              const by = rowY + 3;
              const bh = rowH - 6;

              /* color por estado */
              let fill = pc;
              if (act.status === "pending") fill = [148, 163, 184];

              doc.setFillColor(fill[0], fill[1], fill[2]);
              doc.roundedRect(bx, by, bw, bh, 1.5, 1.5, "F");

              /* progreso (porción más oscura) */
              const prog = Math.max(0, Math.min(100, parseInt(act.progress || 0, 10)));
              if (prog > 0 && act.status !== "pending") {
                const progW = bw * (prog / 100);
                const dark = fill.map(c => Math.round(c * 0.65));
                doc.setFillColor(dark[0], dark[1], dark[2]);
                doc.roundedRect(bx, by, progW, bh, 1.5, 1.5, "F");
              }

              /* etiqueta dentro de la barra (Nd · X%) */
              if (bw > 24) {
                doc.setTextColor(255, 255, 255);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(5.5);
                doc.text(`${dur}d \xB7 ${prog}%`, bx + 3, by + bh / 2 + 1.5);
              } else if (bw > 14) {
                /* sólo días, sin porcentaje, para barras compactas */
                doc.setTextColor(255, 255, 255);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(5);
                doc.text(`${dur}d`, bx + 3, by + bh / 2 + 1.5);
              }

              /* indicador de prioridad crítica/alta (borde rojo) */
              if (act.priority === "critical" || act.priority === "high") {
                doc.setDrawColor(act.priority === "critical" ? 220 : 245,
                                 act.priority === "critical" ? 38 : 158,
                                 act.priority === "critical" ? 38 : 11);
                doc.setLineWidth(0.6);
                doc.roundedRect(bx, by, bw, bh, 1.5, 1.5, "S");
              }
            }
          }

          /* separador inferior */
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.2);
          doc.line(tableX, rowY + rowH, tableX + totalTableW, rowY + rowH);
          rowY += rowH;
        });

        /* línea vertical actividad / timeline (separa labels de timeline) */
        doc.setDrawColor(71, 85, 105);
        doc.setLineWidth(0.7);
        doc.line(timelineX, tableY, timelineX, rowY);
        /* borde exterior de la tabla */
        doc.setDrawColor(71, 85, 105);
        doc.setLineWidth(0.7);
        doc.rect(tableX, tableY, totalTableW, rowY - tableY, "S");

        /* ===== TODAY ===== */
        if (todayOffset >= dayStart && todayOffset < dayEnd) {
          const tx = timelineX + (todayOffset - dayStart) * dayW;
          doc.setDrawColor(239, 68, 68);
          doc.setLineWidth(1);
          doc.line(tx, tableY, tx, rowY);
          doc.setFillColor(239, 68, 68);
          doc.rect(tx - 12, tableY - 9, 24, 9, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6);
          doc.text("HOY", tx, tableY - 2.5, { align: "center" });
        }

        /* === FOOTER: nota APA + URL + créditos (en todas las páginas) === */
        doc.setTextColor(0, 0, 0);
        doc.setFont("times", "italic");
        doc.setFontSize(8.5);
        doc.text("Nota. Elaboración propia. Las barras representan la duración planificada de cada actividad.",
          margin, pageH - margin - 28);

        /* línea separadora suave sobre la zona de créditos */
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.4);
        doc.line(margin, pageH - margin - 22, pageW - margin, pageH - margin - 22);

        /* URL de la herramienta */
        doc.setFont("times", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 90);
        doc.text("Elaborado en https://seminarioii.vercel.app/",
          pageW / 2, pageH - margin - 12, { align: "center" });

        /* línea de créditos */
        doc.setFontSize(7.5);
        doc.setTextColor(110, 110, 120);
        doc.text(
          "(C) 2026 - Cronograma de Anteproyecto  -  Web desarrollada por Albeiro Ramos  -  Apoyo Seminario de Investigacion II",
          pageW / 2, pageH - margin - 2, { align: "center" }
        );

        currentPage++;
      }
    }

    return currentPage;
  }

  /* ============================================================
     TABLA DE ACTIVIDADES (autotable)
     ============================================================ */
  function renderActivitiesTable(doc, project, phases, activities, pageNo) {
    if (!activities.length) return pageNo;

    doc.addPage("a4", "portrait");
    const w = doc.internal.pageSize.getWidth();

    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.text(String(pageNo), w - MARGIN, MARGIN - 24, { align: "right" });

    doc.setFont("times", "bold");
    doc.setFontSize(13);
    doc.text("Tabla 1", MARGIN, MARGIN);
    doc.setFont("times", "italic");
    doc.text("Actividades del cronograma por fase", MARGIN, MARGIN + 16);

    const phaseById = new Map(phases.map(p => [p.id, p]));

    const body = activities
      .slice()
      .sort((a, b) => {
        const fa = phaseById.get(a.phase_id)?.order_index ?? 999;
        const fb = phaseById.get(b.phase_id)?.order_index ?? 999;
        if (fa !== fb) return fa - fb;
        return a.order_index - b.order_index;
      })
      .map((a, i) => [
        i + 1,
        sanitizeForPDF(phaseById.get(a.phase_id)?.title || "-"),
        sanitizeForPDF(a.title),
        ddmmyyyy(a.start_date),
        ddmmyyyy(a.end_date),
        statusLabel(a.status),
        priorityLabel(a.priority),
        `${a.progress || 0}%`
      ]);

    doc.autoTable({
      head: [["#", "Fase", "Actividad", "Inicio", "Fin", "Estado", "Prioridad", "Avance"]],
      body,
      startY: MARGIN + 26,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        font: "times", fontSize: 10,
        cellPadding: 4,
        lineColor: [200, 200, 200], lineWidth: 0.4
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: "bold"
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 24, halign: "center" },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 60, halign: "center" },
        4: { cellWidth: 60, halign: "center" },
        5: { cellWidth: 64, halign: "center" },
        6: { cellWidth: 56, halign: "center" },
        7: { cellWidth: 44, halign: "center" }
      },
      didDrawPage: function (data) {
        /* paginar */
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFont("times", "normal");
        doc.setFontSize(12);
        doc.text(String(pageCount),
          doc.internal.pageSize.getWidth() - MARGIN,
          MARGIN - 24, { align: "right" });
      }
    });

    /* nota APA */
    const finalY = doc.lastAutoTable.finalY + 16;
    doc.setFont("times", "italic");
    doc.setFontSize(10);
    doc.text("Nota. Datos generados por el cronograma del estudiante.",
      MARGIN, finalY);

    return doc.internal.getNumberOfPages() + 1;
  }

  /* ============================================================
     API PÚBLICA
     ============================================================ */
  async function exportPDF({ project, phases, activities, ganttEl, user }) {
    if (!window.jspdf) {
      alert("No se cargó jsPDF. Verifica tu conexión.");
      return;
    }
    const { jsPDF } = window.jspdf;
    /* sólo Gantt: iniciamos directamente en A4 landscape. La página
       default que crea jsPDF queda vacía y la borramos al final
       (renderNativeGantt llama addPage al inicio de cada chunk). */
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });

    if (activities.length) {
      renderNativeGantt(doc, project, phases, activities, 1);
      if (doc.internal.getNumberOfPages() > 1) doc.deletePage(1);
    }

    const safeTitle = (project.title || "cronograma")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    doc.save(`${safeTitle || "cronograma"}-gantt.pdf`);
  }

  window.PDF_EXPORT = { exportPDF };
})();
