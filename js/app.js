// ── SESIÓN Y PERMISOS (declarados primero: se usan en todos los renders) ──
const permisosPorRol = {
  'Administrador':       { paginas: '*', aprobar: true },
  'Supervisor':          { paginas: ['dashboard','mapa','labores','polinizacion','mantenimiento','fertilizacion','sanidad','cosecha','bascula','presupuesto','coroz'], aprobar: true },
  'Operador báscula':    { paginas: ['dashboard','bascula'], aprobar: false },
  'Trabajador de campo': { paginas: ['polinizacion','mantenimiento','fertilizacion','sanidad','cosecha'], aprobar: false }
};
let sesion = JSON.parse(localStorage.getItem('agroweb_sesion') || 'null');

// ── LABORES ─────────────────────────────────────────────
let labores = JSON.parse(localStorage.getItem('agroweb_labores') || '[]');

// Mapeo actividad de labor → categoría de presupuesto (consulta el catálogo maestro primero)
const actividadCategoriaBase = {
  'ANA 1': 'Polinización', 'ANA 2': 'Polinización', 'ANA 3': 'Polinización',
  'Poda': 'Mantenimiento', 'Plateo Químico': 'Mantenimiento', 'Plateo Mecánico': 'Mantenimiento', 'Plateo': 'Mantenimiento', 'Mantenimiento': 'Mantenimiento',
  'Cosecha': 'Cosecha',
  'Censo Enfermedades': 'Censo', 'Censo Plagas': 'Censo',
  'Sanidad': 'Sanidad',
  'Fertilización': 'Fertilización'
};

const actividadCategoria = new Proxy(actividadCategoriaBase, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    // Buscar primero en el catálogo maestro
    const cat = JSON.parse(localStorage.getItem('agroweb_m_labores_cat') || '[]');
    const enCatalogo = cat.find(c => c.nombre === prop);
    if (enCatalogo && enCatalogo.categoria) return enCatalogo.categoria;
    return target[prop];
  }
});

const catIcono = {
  'Polinización': '🌸', 'Cosecha': '🌴', 'Mantenimiento': '✂️',
  'Sanidad': '💊', 'Censo': '🔬', 'Fertilización': '🌱', 'Otro': '📌'
};

function saveLabores() { localStorage.setItem('agroweb_labores', JSON.stringify(labores)); }

// Buscar tarifa vigente: primero la de la categoría del trabajador, luego la general
function tarifaVigente(nombreLabor, fecha, trabajador = '') {
  const todas = getMaestro('tarifas')
    .filter(t => t.labor === nombreLabor && (!t.vigencia || t.vigencia <= fecha))
    .sort((a, b) => (b.vigencia || '').localeCompare(a.vigencia || ''));
  if (trabajador) {
    const reg = getMaestro('trabajadores').find(t => t.nombre === trabajador);
    const cat = reg?.categoria || '';
    if (cat) {
      const porCategoria = todas.find(t => t.categoria === cat);
      if (porCategoria) return porCategoria;
    }
  }
  return todas.find(t => !t.categoria) || null;
}

function autoCalcularCostoLabor() {
  const actividad = document.getElementById('labor-actividad').value;
  const cantidad = parseFloat(document.getElementById('labor-cantidad').value) || 0;
  const fecha = document.getElementById('labor-fecha').value || new Date().toISOString().slice(0,10);
  const trabajador = (document.getElementById('labor-trabajador').value || '').trim();
  const hint = document.getElementById('labor-tarifa-hint');

  const tarifa = tarifaVigente(actividad, fecha, trabajador);
  const esEspecial = tarifa && tarifa.categoria;
  if (tarifa && tarifa.tipo === 'Por unidad (destajo)' && cantidad) {
    document.getElementById('labor-costo').value = Math.round(cantidad * tarifa.valor);
    if (hint) hint.textContent = `💲 Tarifa${esEspecial ? ' categoría '+tarifa.categoria : ' general'}: $${tarifa.valor.toLocaleString('es-CO')}/unidad × ${cantidad.toLocaleString('es-CO')} = $${Math.round(cantidad * tarifa.valor).toLocaleString('es-CO')}`;
  } else if (tarifa && hint) {
    hint.textContent = `💲 Tarifa${esEspecial ? ' especial' : ''}: $${tarifa.valor.toLocaleString('es-CO')} ${tarifa.tipo.toLowerCase()}`;
  } else if (hint) {
    hint.textContent = actividad ? '⚠ Sin tarifa registrada para esta labor — ingresa el costo manual' : '';
  }
}

function autoCantidadDesdeRango() {
  const lineaR = parseRango(document.getElementById('labor-linea').value);
  const palmaR = parseRango(document.getElementById('labor-palma').value);
  const hint = document.getElementById('labor-rango-hint');
  if (!hint) return;

  const nLineas = lineaR ? (lineaR.hasta - lineaR.desde + 1) : 0;
  const nPalmas = palmaR ? (palmaR.hasta - palmaR.desde + 1) : 0;

  let sugerida = 0;
  if (nLineas && nPalmas) sugerida = nLineas * nPalmas;
  else if (nPalmas) sugerida = nPalmas;
  else if (nLineas > 1) {
    // Rango de líneas sin palmas: usar palmas por línea del lote si existe
    const lote = lotes.find(l => String(l.numero) === document.getElementById('labor-lote').value);
    if (lote && lote.palmasLinea) sugerida = nLineas * lote.palmasLinea;
  }

  if (sugerida > 0) {
    const campoCant = document.getElementById('labor-cantidad');
    if (!campoCant.value || campoCant.dataset.auto === '1') {
      campoCant.value = sugerida;
      campoCant.dataset.auto = '1';
    }
    hint.textContent = `📐 Rango: ${nLineas || 1} línea${nLineas>1?'s':''}${nPalmas ? ' × '+nPalmas+' palmas' : ''} = ${sugerida.toLocaleString('es-CO')} palmas sugeridas`;
    autoCalcularCostoLabor();
  } else {
    hint.textContent = '';
  }
}

function abrirModalLabor(presetActividad = null) {
  // Poblar select de lotes
  const sel = document.getElementById('labor-lote');
  sel.innerHTML = '<option value="">Sin lote</option>' + lotes.map(l =>
    `<option value="${l.numero}">Lote ${l.numero}${l.nombre ? ' · '+l.nombre : ''}</option>`).join('');

  // Determinar módulo de origen: restringir actividades a las del módulo
  let actividadesPermitidas = null;
  if (presetActividad && typeof presetActividad === 'string') {
    // 1º: buscar en las listas de módulos
    for (const [key, acts] of Object.entries(actividadesPorModulo)) {
      if (acts.includes(presetActividad)) { actividadesPermitidas = acts; break; }
    }
    // 2º (respaldo): si no está en ninguna lista, restringir por categoría de la actividad
    if (!actividadesPermitidas) {
      const catPreset = actividadCategoria[presetActividad];
      if (catPreset) {
        const cat = getMaestro('labores_cat');
        const mismasCat = cat.filter(c => c.categoria === catPreset).map(c => c.nombre);
        if (mismasCat.length) actividadesPermitidas = mismasCat;
      }
    }
  }

  // Poblar actividades: solo las del módulo, o todo el catálogo si viene del Historial
  const cat = getMaestro('labores_cat');
  const selAct = document.getElementById('labor-actividad');
  if (actividadesPermitidas) {
    selAct.innerHTML = actividadesPermitidas.map(nombre => {
      const c = cat.find(x => x.nombre === nombre);
      return `<option value="${nombre}" data-cat="${c?.categoria||''}">${nombre}</option>`;
    }).join('');
  } else if (cat.length) {
    selAct.innerHTML = cat.map(c =>
      `<option value="${c.nombre}" data-cat="${c.categoria}" data-costo="${c.costo||0}">${c.nombre}</option>`).join('');
  }

  // Trabajador: select desde maestro si existe, sino texto libre
  const trabajadores = getMaestro('trabajadores');
  const trabField = document.getElementById('labor-trabajador');
  if (trabajadores.length && trabField.tagName === 'INPUT') {
    const nuevoSel = document.createElement('select');
    nuevoSel.id = 'labor-trabajador';
    nuevoSel.innerHTML = '<option value="">Seleccionar...</option>' +
      trabajadores.map(t => `<option>${t.nombre}</option>`).join('') +
      '<option value="__otro">Otro (no registrado)</option>';
    trabField.replaceWith(nuevoSel);
  }

  document.getElementById('labor-fecha').value = new Date().toISOString().slice(0,10);

  // Preseleccionar actividad si viene de un módulo específico
  if (presetActividad && typeof presetActividad === 'string') {
    document.getElementById('labor-actividad').value = presetActividad;
  }

  // Activar autocálculo de costo con tarifa vigente
  document.getElementById('labor-actividad').onchange = autoCalcularCostoLabor;
  document.getElementById('labor-cantidad').oninput = function() { this.dataset.auto = '0'; autoCalcularCostoLabor(); };
  document.getElementById('labor-fecha').onchange = autoCalcularCostoLabor;
  document.getElementById('labor-linea').oninput = autoCantidadDesdeRango;
  document.getElementById('labor-palma').oninput = autoCantidadDesdeRango;
  document.getElementById('labor-lote').onchange = autoCantidadDesdeRango;
  autoCalcularCostoLabor();

  document.getElementById('modal-labor').classList.add('open');
}

function cerrarModalLabor() { document.getElementById('modal-labor').classList.remove('open'); }

function guardarLabor() {
  const lineaR = parseRango(document.getElementById('labor-linea').value);
  const palmaR = parseRango(document.getElementById('labor-palma').value);

  const labor = {
    id: Date.now().toString(),
    actividad: document.getElementById('labor-actividad').value,
    lote: document.getElementById('labor-lote').value,
    lineaR, palmaR,
    linea: lineaR ? lineaR.desde : null,
    palma: palmaR ? palmaR.desde : null,
    fecha: document.getElementById('labor-fecha').value || new Date().toISOString().slice(0,10),
    cantidad: parseInt(document.getElementById('labor-cantidad').value) || 0,
    trabajador: document.getElementById('labor-trabajador').value.trim(),
    costo: parseFloat(document.getElementById('labor-costo').value) || 0,
    obs: document.getElementById('labor-obs').value.trim(),
    estado: 'pendiente'
  };
  labores.unshift(labor);
  saveLabores();
  cerrarModalLabor();
  refrescarModulosLabores();
  ['labor-cantidad','labor-costo','labor-obs','labor-linea','labor-palma'].forEach(id => document.getElementById(id).value = '');
  const trab = document.getElementById('labor-trabajador');
  if (trab) trab.value = '';
}

// ── APROBACIONES ────────────────────────────────────────
function aprobarLabor(id) {
  const l = labores.find(x => x.id === id);
  if (l) { l.estado = 'aprobada'; saveLabores(); refrescarModulosLabores(); }
}

function rechazarLabor(id) {
  const l = labores.find(x => x.id === id);
  if (l) { l.estado = 'rechazada'; saveLabores(); refrescarModulosLabores(); }
}

function aprobarTodasPendientes() {
  const pendientes = labores.filter(l => (l.estado||'pendiente') === 'pendiente');
  if (!pendientes.length) { alert('No hay labores pendientes'); return; }
  if (!confirm(`¿Aprobar ${pendientes.length} labores pendientes?`)) return;
  pendientes.forEach(l => l.estado = 'aprobada');
  saveLabores();
  refrescarModulosLabores();
}

function badgeEstado(l) {
  const e = l.estado || 'pendiente';
  if (e === 'aprobada') return '<span class="badge badge-verde">✓ Aprobada</span>';
  if (e === 'rechazada') return '<span class="badge badge-rojo">✗ Rechazada</span>';
  const botones = sesionPuedeAprobar()
    ? `<button class="btn-icon" onclick="aprobarLabor('${l.id}')" title="Aprobar" style="width:22px;height:22px;font-size:11px;border-color:var(--verde-claro);color:var(--verde-claro)">✓</button>
    <button class="btn-icon" onclick="rechazarLabor('${l.id}')" title="Rechazar" style="width:22px;height:22px;font-size:11px">✗</button>`
    : '';
  return `<span class="badge badge-dorado">⏳ Pendiente</span> ${botones}`;
}

// Solo labores aprobadas cuentan para presupuesto y KPIs
const laboresAprobadas = () => labores.filter(l => (l.estado||'pendiente') === 'aprobada');

function eliminarLabor(id) {
  if (!confirm('¿Eliminar este registro de labor?')) return;
  labores = labores.filter(x => x.id !== id);
  saveLabores();
  refrescarModulosLabores();
}

// Refresca todos los módulos que dependen de labores
function refrescarModulosLabores() {
  renderLabores();
  renderPresupuesto();
  if (typeof renderCosecha === 'function') renderCosecha();
  if (typeof renderSanidad === 'function') renderSanidad();
  if (typeof renderTodosModulosActividad === 'function') renderTodosModulosActividad();
  if (typeof actualizarDashboardLabores === 'function') actualizarDashboardLabores();
}

const fmtCOP = v => '$' + Math.round(v).toLocaleString('es-CO');

// Parser de rangos: "24" → {desde:24, hasta:24} · "20-35" → {desde:20, hasta:35} · "" → null
function parseRango(str) {
  if (!str) return null;
  const s = String(str).trim().replace(/\s/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const desde = parseInt(m[1]);
  const hasta = m[2] ? parseInt(m[2]) : desde;
  return { desde: Math.min(desde, hasta), hasta: Math.max(desde, hasta) };
}

const fmtRango = r => r ? (r.desde === r.hasta ? String(r.desde) : r.desde + '-' + r.hasta) : '';

// Ubicación jerárquica: Lote → Línea(s) → Palma(s) + GPS
function fmtUbicacion(l) {
  if (!l.lote && !l.gps) return '—';
  let u = l.lote ? 'L' + l.lote : '';
  const ln = l.lineaR || (l.linea ? { desde: l.linea, hasta: l.linea } : null);
  const pm = l.palmaR || (l.palma ? { desde: l.palma, hasta: l.palma } : null);
  if (ln) u += ' · Ln' + fmtRango(ln);
  if (pm) u += ' · P' + fmtRango(pm);
  if (l.gps && l.gps.lat) {
    const lat = l.gps.lat.toFixed(5), lng = l.gps.lng.toFixed(5);
    u += ` <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" title="${lat}, ${lng} — abrir en Google Maps" style="text-decoration:none">📍</a><span style="color:var(--texto-dim); font-size:10.5px"> ${lat},${lng}</span>`;
  }
  return u || '—';
}

function renderLabores() {
  const container = document.getElementById('labores-lista');
  const pendientes = labores.filter(l => (l.estado||'pendiente') === 'pendiente').length;
  document.getElementById('labores-sub').innerHTML = labores.length
    ? `${labores.length} labores registradas${pendientes ? ` · <span style="color:var(--dorado-claro)">${pendientes} pendientes de aprobación</span> <button class="btn-cancel" style="padding:2px 10px; font-size:11px" onclick="aprobarTodasPendientes()">✓ Aprobar todas</button>` : ''}`
    : 'Vista consolidada de todas las actividades registradas';

  if (!labores.length) {
    container.innerHTML = `<div style="padding:32px; text-align:center; color:var(--texto-dim)">
      <div style="font-size:40px; margin-bottom:12px">📋</div>
      <div style="font-size:14px; margin-bottom:6px">Sin registros aún</div>
      <div style="font-size:12px">Las labores registradas aquí alimentan automáticamente el presupuesto</div>
    </div>`;
    return;
  }

  container.innerHTML = `<table class="lotes-table">
    <thead><tr><th>Fecha</th><th>Actividad</th><th>Ubicación</th><th>Cantidad</th><th>Trabajador</th><th>Costo</th><th>Estado</th><th></th></tr></thead>
    <tbody>${labores.map(l => `
      <tr style="${(l.estado||'pendiente')==='rechazada' ? 'opacity:0.45' : ''}">
        <td>${new Date(l.fecha+'T12:00:00').toLocaleDateString('es-CO',{month:'short',day:'numeric'})}</td>
        <td style="color:var(--verde-claro); font-weight:500">${catIcono[actividadCategoria[l.actividad]]||'📌'} ${l.actividad}</td>
        <td style="font-family:monospace; font-size:12px">${fmtUbicacion(l)}</td>
        <td>${l.cantidad ? l.cantidad.toLocaleString('es-CO') : '—'}</td>
        <td>${l.trabajador || '—'}</td>
        <td>${l.costo ? fmtCOP(l.costo) : '—'}</td>
        <td style="white-space:nowrap">${badgeEstado(l)}</td>
        <td><button class="btn-icon" onclick="eliminarLabor('${l.id}')" style="width:24px;height:24px;font-size:11px">🗑️</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}

// ── PRESUPUESTO ─────────────────────────────────────────
let presupuestos = JSON.parse(localStorage.getItem('agroweb_ppto') || '[]');

function savePpto() { localStorage.setItem('agroweb_ppto', JSON.stringify(presupuestos)); }

function initMesSelector() {
  const sel = document.getElementById('ppto-mes');
  const hoy = new Date();
  let opts = '';
  for (let i = -2; i <= 9; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    const val = d.toISOString().slice(0,7);
    const label = d.toLocaleDateString('es-CO', {month:'long', year:'numeric'});
    opts += `<option value="${val}" ${i===0?'selected':''}>${label.charAt(0).toUpperCase()+label.slice(1)}</option>`;
  }
  sel.innerHTML = opts;
}

function abrirModalPpto() {
  document.getElementById('ppto-mes-input').value = document.getElementById('ppto-mes').value;
  document.getElementById('modal-ppto').classList.add('open');
}

function cerrarModalPpto() { document.getElementById('modal-ppto').classList.remove('open'); }

function guardarPpto() {
  const valor = parseFloat(document.getElementById('ppto-valor').value) || 0;
  const meta = parseInt(document.getElementById('ppto-meta').value) || 0;
  if (!valor && !meta) { alert('Ingresa el presupuesto en dinero, la meta de actividades, o ambos'); return; }

  presupuestos.push({
    id: Date.now().toString(),
    actividad: document.getElementById('ppto-actividad').value,
    mes: document.getElementById('ppto-mes-input').value || document.getElementById('ppto-mes').value,
    valor,
    meta,
    notas: document.getElementById('ppto-notas').value.trim()
  });
  savePpto();
  cerrarModalPpto();
  renderPresupuesto();
  ['ppto-valor','ppto-meta','ppto-notas'].forEach(id => document.getElementById(id).value = '');
}

function eliminarPpto(id) {
  if (!confirm('¿Eliminar esta partida presupuestal?')) return;
  presupuestos = presupuestos.filter(x => x.id !== id);
  savePpto();
  renderPresupuesto();
}

function renderPresupuesto() {
  const mes = document.getElementById('ppto-mes').value;
  const partidas = presupuestos.filter(p => p.mes === mes);
  const container = document.getElementById('ppto-lista');

  // Cruce: solo labores APROBADAS del mes agrupadas por categoría
  const laboresMes = laboresAprobadas().filter(l => l.fecha && l.fecha.slice(0,7) === mes);
  const ejecutadoPorCat = {};
  const cantidadPorCat = {};
  laboresMes.forEach(l => {
    const cat = actividadCategoria[l.actividad] || 'Otro';
    ejecutadoPorCat[cat] = (ejecutadoPorCat[cat] || 0) + (l.costo || 0);
    cantidadPorCat[cat] = (cantidadPorCat[cat] || 0) + (l.cantidad || 0);
  });

  const totalPpto = partidas.reduce((s,p) => s + p.valor, 0);
  const totalEjec = partidas.reduce((s,p) => s + (ejecutadoPorCat[p.actividad] || 0), 0);
  const totalMeta = partidas.reduce((s,p) => s + (p.meta || 0), 0);
  const totalCant = partidas.reduce((s,p) => s + (cantidadPorCat[p.actividad] || 0), 0);

  document.getElementById('ppto-total').textContent = fmtCOP(totalPpto);
  document.getElementById('ppto-ejecutado').textContent = fmtCOP(totalEjec);
  document.getElementById('ppto-disponible').textContent = totalMeta
    ? `${totalCant.toLocaleString('es-CO')} / ${totalMeta.toLocaleString('es-CO')}`
    : fmtCOP(totalPpto - totalEjec);
  document.querySelector('#ppto-disponible').nextElementSibling.textContent = totalMeta ? 'Actividades (ejec/meta)' : 'Disponible';
  document.getElementById('ppto-pct').textContent = totalPpto ? Math.round(totalEjec/totalPpto*100) + '%' : (totalMeta ? Math.round(totalCant/totalMeta*100)+'%' : '0%');

  if (!partidas.length) {
    container.innerHTML = `<div style="padding:40px; text-align:center; color:var(--texto-dim); background:var(--fondo-card); border:1px solid var(--borde); border-radius:12px">
      <div style="font-size:40px; margin-bottom:12px">💰</div>
      <div style="font-size:14px; margin-bottom:6px; color:var(--texto-suave)">Sin partidas para este mes</div>
      <div style="font-size:12px">Crea partidas por actividad — el ejecutado en dinero y actividades se calcula automáticamente desde las labores registradas</div>
      <button class="btn-primary" onclick="abrirModalPpto()">+ Crear primera partida</button>
    </div>`;
    return;
  }

  container.innerHTML = partidas.map(p => {
    const ejec = ejecutadoPorCat[p.actividad] || 0;
    const cant = cantidadPorCat[p.actividad] || 0;
    const nLabores = laboresMes.filter(l => (actividadCategoria[l.actividad]||'Otro') === p.actividad).length;

    // Barra dinero
    const pctDinero = p.valor ? Math.min(ejec/p.valor*100, 100) : 0;
    const pctDineroReal = p.valor ? Math.round(ejec/p.valor*100) : 0;
    const barDinero = pctDineroReal > 100 ? 'excedido' : pctDineroReal > 80 ? 'alerta' : 'ok';

    // Barra actividades
    const pctAct = p.meta ? Math.min(cant/p.meta*100, 100) : 0;
    const pctActReal = p.meta ? Math.round(cant/p.meta*100) : 0;

    const alertaBadge = pctDineroReal > 100 ? '<span class="badge badge-rojo">Excedido $</span>'
      : pctDineroReal > 80 ? '<span class="badge badge-dorado">Alerta $</span>'
      : (p.meta && pctActReal >= 100) ? '<span class="badge badge-verde">Meta cumplida</span>' : '';

    return `<div class="ppto-item">
      <div class="ppto-item-top">
        <div class="ppto-item-name">${catIcono[p.actividad]||'📌'} ${p.actividad} ${alertaBadge}</div>
        <div class="ppto-item-nums">
          <div class="ppto-num">
            <div class="ppto-num-val" style="color:var(--texto-suave)">${p.valor ? fmtCOP(p.valor) : '—'}</div>
            <div class="ppto-num-label">Presupuestado</div>
          </div>
          <div class="ppto-num">
            <div class="ppto-num-val" style="color:${pctDineroReal>100?'var(--rojo)':'var(--dorado-claro)'}">${fmtCOP(ejec)}</div>
            <div class="ppto-num-label">Ejecutado</div>
          </div>
          <div class="ppto-num">
            <div class="ppto-num-val" style="color:var(--verde-claro)">${p.meta ? cant.toLocaleString('es-CO')+' / '+p.meta.toLocaleString('es-CO') : cant.toLocaleString('es-CO')}</div>
            <div class="ppto-num-label">Actividades</div>
          </div>
          <button class="btn-icon" onclick="eliminarPpto('${p.id}')" style="width:26px;height:26px;font-size:12px">🗑️</button>
        </div>
      </div>
      ${p.valor ? `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px">
        <span style="font-size:10px; color:var(--texto-dim); width:70px; text-transform:uppercase; letter-spacing:0.5px">💵 Dinero</span>
        <div class="ppto-bar-wrap" style="flex:1"><div class="ppto-bar ${barDinero}" style="width:${pctDinero}%"></div></div>
        <span style="font-size:11px; color:var(--texto-dim); width:38px; text-align:right">${pctDineroReal}%</span>
      </div>` : ''}
      ${p.meta ? `
      <div style="display:flex; align-items:center; gap:10px">
        <span style="font-size:10px; color:var(--texto-dim); width:70px; text-transform:uppercase; letter-spacing:0.5px">📊 Avance</span>
        <div class="ppto-bar-wrap" style="flex:1"><div class="ppto-bar" style="width:${pctAct}%; background:linear-gradient(90deg, var(--azul), #74b3ce)"></div></div>
        <span style="font-size:11px; color:var(--texto-dim); width:38px; text-align:right">${pctActReal}%</span>
      </div>` : ''}
      <div class="ppto-detail">
        <span>${nLabores} labor${nLabores!==1?'es':''} registrada${nLabores!==1?'s':''} este mes</span>
        <span>${p.notas || ''}</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('modal-labor').addEventListener('click', function(e) { if (e.target === this) cerrarModalLabor(); });
document.getElementById('modal-ppto').addEventListener('click', function(e) { if (e.target === this) cerrarModalPpto(); });

initMesSelector();
renderLabores();
renderPresupuesto();

// ── BÁSCULA ─────────────────────────────────────────────
let pesajes = JSON.parse(localStorage.getItem('agroweb_pesajes') || '[]');

function savePesajes() { localStorage.setItem('agroweb_pesajes', JSON.stringify(pesajes)); }

function calcNeto() {
  const bruto = parseFloat(document.getElementById('pesaje-bruto').value) || 0;
  const tara = parseFloat(document.getElementById('pesaje-tara').value) || 0;
  const display = document.getElementById('neto-display');
  if (bruto && tara && bruto > tara) {
    display.style.display = 'block';
    document.getElementById('neto-valor').textContent = (bruto - tara).toLocaleString('es-CO') + ' kg';
  } else {
    display.style.display = 'none';
  }
}

function abrirModalPesaje(id = null) {
  const sel = document.getElementById('pesaje-lote');
  sel.innerHTML = '<option value="">Sin especificar</option>' + lotes.map(l =>
    `<option value="${l.numero}">Lote ${l.numero}${l.nombre ? ' · '+l.nombre : ''}</option>`).join('');

  // Autocompletar placas desde maestro de vehículos
  const vehiculos = getMaestro('vehiculos');
  const placaField = document.getElementById('pesaje-placa');
  if (vehiculos.length) {
    let datalist = document.getElementById('placas-datalist');
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = 'placas-datalist';
      document.body.appendChild(datalist);
      placaField.setAttribute('list', 'placas-datalist');
    }
    datalist.innerHTML = vehiculos.map(v => `<option value="${v.placa}">${v.tipo}${v.conductor ? ' · '+v.conductor : ''}</option>`).join('');
    // Auto-llenar conductor al elegir placa conocida
    placaField.onchange = () => {
      const v = vehiculos.find(x => x.placa.toUpperCase() === placaField.value.trim().toUpperCase());
      if (v && v.conductor && !document.getElementById('pesaje-conductor').value) {
        document.getElementById('pesaje-conductor').value = v.conductor;
      }
    };
  }

  if (id) {
    const p = pesajes.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-pesaje-title').textContent = 'Completar pesaje — Salida (tara)';
    document.getElementById('pesaje-edit-id').value = id;
    document.getElementById('pesaje-placa').value = p.placa;
    document.getElementById('pesaje-conductor').value = p.conductor || '';
    document.getElementById('pesaje-lote').value = p.lote || '';
    document.getElementById('pesaje-destino').value = p.destino || '';
    document.getElementById('pesaje-bruto').value = p.bruto || '';
    document.getElementById('pesaje-tara').value = p.tara || '';
    document.getElementById('pesaje-racimos').value = p.racimos || '';
    document.getElementById('pesaje-obs').value = p.obs || '';
    calcNeto();
    document.getElementById('pesaje-tara').focus();
  } else {
    document.getElementById('modal-pesaje-title').textContent = 'Nuevo pesaje — Entrada';
    document.getElementById('pesaje-edit-id').value = '';
    ['pesaje-placa','pesaje-conductor','pesaje-destino','pesaje-bruto','pesaje-tara','pesaje-racimos','pesaje-obs'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('pesaje-lote').value = '';
    document.getElementById('neto-display').style.display = 'none';
  }
  document.getElementById('modal-pesaje').classList.add('open');
}

function cerrarModalPesaje() { document.getElementById('modal-pesaje').classList.remove('open'); }

function guardarPesaje() {
  const placa = document.getElementById('pesaje-placa').value.trim().toUpperCase();
  const bruto = parseFloat(document.getElementById('pesaje-bruto').value) || 0;
  if (!placa) { alert('Ingresa la placa del vehículo'); return; }
  if (!bruto) { alert('Ingresa el peso bruto de entrada'); return; }

  const tara = parseFloat(document.getElementById('pesaje-tara').value) || 0;
  const editId = document.getElementById('pesaje-edit-id').value;

  const pesaje = {
    id: editId || Date.now().toString(),
    tiquete: editId ? pesajes.find(x=>x.id===editId)?.tiquete : (pesajes.length + 1).toString().padStart(5, '0'),
    placa,
    conductor: document.getElementById('pesaje-conductor').value.trim(),
    lote: document.getElementById('pesaje-lote').value,
    destino: document.getElementById('pesaje-destino').value.trim(),
    bruto,
    tara,
    neto: (tara && bruto > tara) ? bruto - tara : 0,
    racimos: parseInt(document.getElementById('pesaje-racimos').value) || 0,
    obs: document.getElementById('pesaje-obs').value.trim(),
    fecha: editId ? pesajes.find(x=>x.id===editId)?.fecha : new Date().toISOString(),
    fechaSalida: (tara && !editId) ? new Date().toISOString() : (tara ? new Date().toISOString() : null)
  };

  if (editId) {
    const idx = pesajes.findIndex(x => x.id === editId);
    if (idx >= 0) pesajes[idx] = pesaje;
  } else {
    pesajes.unshift(pesaje);
  }

  savePesajes();
  cerrarModalPesaje();
  renderBascula();
  if (typeof renderCosecha === 'function') renderCosecha();
}

function eliminarPesaje(id) {
  if (!confirm('¿Eliminar este tiquete de báscula?')) return;
  pesajes = pesajes.filter(x => x.id !== id);
  savePesajes();
  renderBascula();
  if (typeof renderCosecha === 'function') renderCosecha();
}

function renderBascula() {
  const hoy = new Date().toISOString().slice(0,10);
  const mes = new Date().toISOString().slice(0,7);
  const hace7 = new Date(Date.now() - 7*86400000).toISOString();

  const filtro = document.getElementById('bas-filtro').value;
  let filtrados = pesajes;
  if (filtro === 'hoy') filtrados = pesajes.filter(p => p.fecha.slice(0,10) === hoy);
  else if (filtro === 'semana') filtrados = pesajes.filter(p => p.fecha >= hace7);
  else if (filtro === 'mes') filtrados = pesajes.filter(p => p.fecha.slice(0,7) === mes);

  // KPIs
  const deHoy = pesajes.filter(p => p.fecha.slice(0,10) === hoy);
  const delMes = pesajes.filter(p => p.fecha.slice(0,7) === mes);
  const pendientes = pesajes.filter(p => !p.tara);

  document.getElementById('bas-viajes').textContent = deHoy.length;
  document.getElementById('bas-neto-hoy').textContent = deHoy.reduce((s,p) => s + p.neto, 0).toLocaleString('es-CO');
  document.getElementById('bas-neto-mes').textContent = (delMes.reduce((s,p) => s + p.neto, 0) / 1000).toLocaleString('es-CO', {maximumFractionDigits:1});
  document.getElementById('bas-pendientes').textContent = pendientes.length;
  document.getElementById('bascula-sub').textContent = pesajes.length
    ? `${pesajes.length} tiquetes registrados` : 'Pesaje de vehículos y trazabilidad de fruta a planta';

  const container = document.getElementById('bascula-lista');
  if (!filtrados.length) {
    container.innerHTML = `<div style="padding:32px; text-align:center; color:var(--texto-dim)">
      <div style="font-size:40px; margin-bottom:12px">⚖️</div>
      <div style="font-size:14px; margin-bottom:6px">Sin tiquetes ${filtro==='hoy'?'hoy':'en este período'}</div>
      <div style="font-size:12px">Registra la entrada del vehículo con peso bruto — la tara se completa cuando sale vacío</div>
    </div>`;
    return;
  }

  container.innerHTML = `<table class="lotes-table">
    <thead><tr><th>Tiquete</th><th>Fecha</th><th>Placa</th><th>Lote</th><th>Bruto (kg)</th><th>Tara (kg)</th><th>Neto (kg)</th><th>Racimos</th><th>Estado</th><th></th></tr></thead>
    <tbody>${filtrados.map(p => `
      <tr>
        <td style="color:var(--verde-claro); font-weight:600; font-family:monospace">#${p.tiquete}</td>
        <td>${new Date(p.fecha).toLocaleDateString('es-CO',{month:'short',day:'numeric'})} ${new Date(p.fecha).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</td>
        <td style="font-weight:600">${p.placa}</td>
        <td>${p.lote ? 'Lote '+p.lote : '—'}</td>
        <td>${p.bruto.toLocaleString('es-CO')}</td>
        <td>${p.tara ? p.tara.toLocaleString('es-CO') : '—'}</td>
        <td style="color:var(--dorado-claro); font-weight:600">${p.neto ? p.neto.toLocaleString('es-CO') : '—'}</td>
        <td>${p.racimos ? p.racimos.toLocaleString('es-CO') : '—'}</td>
        <td>${p.tara
          ? '<span class="badge badge-verde">Completado</span>'
          : `<span class="badge badge-naranja" style="cursor:pointer" onclick="abrirModalPesaje('${p.id}')">⏳ En planta — dar salida</span>`}</td>
        <td><button class="btn-icon" onclick="eliminarPesaje('${p.id}')" style="width:24px;height:24px;font-size:11px">🗑️</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}

document.getElementById('modal-pesaje').addEventListener('click', function(e) { if (e.target === this) cerrarModalPesaje(); });
renderBascula();

// ── MAESTROS (motor genérico) ───────────────────────────
const maestrosDef = {
  trabajadores: {
    nombre: 'Trabajadores', icono: '👷', display: 'nombre',
    campos: [
      { k: 'nombre', l: 'Nombre completo', t: 'text', req: 1 },
      { k: 'cedula', l: 'Cédula', t: 'text' },
      { k: 'rol', l: 'Rol', t: 'select', opts: ['Trabajador de campo', 'Supervisor', 'Administrador de campo', 'Contratista', 'Operador báscula'] },
      { k: 'categoria', l: 'Categoría tarifaria', t: 'select', opts: ['Estándar', 'Experto', 'Aprendiz', 'Contratista'] },
      { k: 'cuadrilla', l: 'Cuadrilla', t: 'text' },
      { k: 'telefono', l: 'Teléfono', t: 'text' },
      { k: 'tarifa', l: 'Tarifa día (COP)', t: 'number' }
    ],
    ejemplo: 'Juan Pérez\t1120345678\tTrabajador de campo\tEstándar\tCuadrilla 1\t3101234567\t65000\nMaría Gómez\t1120987654\tSupervisor\tEstándar\tCuadrilla 1\t3129876543\t85000\nCarlos Ruiz\t1121112233\tTrabajador de campo\tExperto\tCuadrilla 2\t3115556677\t65000'
  },
  labores_cat: {
    nombre: 'Catálogo de labores', icono: '📋', display: 'nombre',
    campos: [
      { k: 'nombre', l: 'Nombre de la labor', t: 'text', req: 1 },
      { k: 'categoria', l: 'Categoría presupuestal', t: 'select', opts: ['Polinización', 'Cosecha', 'Mantenimiento', 'Sanidad', 'Censo', 'Fertilización', 'Otro'] },
      { k: 'unidad', l: 'Unidad de medida', t: 'text' },
      { k: 'costo', l: 'Costo unitario (COP)', t: 'number' },
      { k: 'tipo', l: 'Tipo de registro', t: 'select', opts: ['Rápida NFC', 'Con formulario'] }
    ],
    ejemplo: 'Polinización ANA 1\tPolinización\tpalma\t450\tRápida NFC\nPoda sanitaria\tMantenimiento\tpalma\t1200\tRápida NFC\nAplicación fungicida\tSanidad\tpalma\t2500\tCon formulario'
  },
  vehiculos: {
    nombre: 'Vehículos', icono: '🚛', display: 'placa',
    campos: [
      { k: 'placa', l: 'Placa', t: 'text', req: 1 },
      { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Camión sencillo', 'Doble troque', 'Tractomula', 'Tractor', 'Camioneta', 'Otro'] },
      { k: 'conductor', l: 'Conductor habitual', t: 'text' },
      { k: 'capacidad', l: 'Capacidad (kg)', t: 'number' },
      { k: 'propietario', l: 'Propietario / Empresa', t: 'text' }
    ],
    ejemplo: 'ABC123\tCamión sencillo\tPedro Martínez\t8000\tTransportes El Llano\nXYZ789\tDoble troque\tLuis Rojas\t17000\tPropio'
  },
  insumos: {
    nombre: 'Insumos', icono: '🧪', display: 'nombre',
    campos: [
      { k: 'nombre', l: 'Nombre del insumo', t: 'text', req: 1 },
      { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Fertilizante', 'Fitosanitario', 'Herramienta', 'Combustible', 'Otro'] },
      { k: 'unidad', l: 'Unidad', t: 'text' },
      { k: 'costo', l: 'Costo por unidad (COP)', t: 'number' },
      { k: 'proveedor', l: 'Proveedor', t: 'text' }
    ],
    ejemplo: 'Urea 46%\tFertilizante\tbulto 50kg\t145000\tAgroinsumos Casanare\nANA hormona\tFitosanitario\tfrasco 100ml\t85000\tQuímica Palm\nGlifosato\tFitosanitario\tlitro\t28000\tAgroinsumos Casanare'
  },
  enfermedades: {
    nombre: 'Enfermedades y plagas', icono: '🦠', display: 'nombre',
    campos: [
      { k: 'nombre', l: 'Nombre', t: 'text', req: 1 },
      { k: 'tipo', l: 'Tipo', t: 'select', opts: ['Enfermedad', 'Plaga'] },
      { k: 'letalidad', l: 'Nivel de riesgo', t: 'select', opts: ['Alto', 'Medio', 'Bajo'] },
      { k: 'manejo', l: 'Protocolo de manejo', t: 'text' }
    ],
    ejemplo: 'Pudrición del Cogollo (PC)\tEnfermedad\tAlto\tCirugía + fungicida sistémico\nAnillo Rojo\tEnfermedad\tAlto\tErradicación inmediata\nRhynchophorus palmarum\tPlaga\tAlto\tTrampeo con feromonas'
  },
  usuarios: {
    nombre: 'Usuarios', icono: '🔐', display: 'nombre',
    campos: [
      { k: 'nombre', l: 'Nombre completo', t: 'text', req: 1 },
      { k: 'pin', l: 'PIN de acceso (4 dígitos)', t: 'text', req: 1 },
      { k: 'rol', l: 'Rol de acceso', t: 'select', req: 1, opts: ['Administrador', 'Supervisor', 'Operador báscula', 'Trabajador de campo'] },
      { k: 'trabajador', l: 'Trabajador vinculado (opcional)', t: 'select', optsFn: () => getMaestro('trabajadores').map(t => t.nombre) },
      { k: 'activo', l: 'Estado', t: 'select', opts: ['Activo', 'Inactivo'] }
    ],
    ejemplo: 'Santiago\t1234\tAdministrador\t\tActivo\nJosé Alirio Pérez\t1111\tSupervisor\tJosé Alirio Pérez\tActivo\nAna Milena Torres\t2222\tOperador báscula\tAna Milena Torres\tActivo'
  },
  tarifas: {
    nombre: 'Tarifas', icono: '💲', display: 'labor',
    campos: [
      { k: 'labor', l: 'Labor', t: 'select', req: 1, optsFn: () => getMaestro('labores_cat').map(l => l.nombre) },
      { k: 'categoria', l: 'Categoría (vacío = tarifa general)', t: 'select', opts: ['Estándar', 'Experto', 'Aprendiz', 'Contratista'] },
      { k: 'tipo', l: 'Tipo de tarifa', t: 'select', opts: ['Por unidad (destajo)', 'Por día', 'Por hectárea'] },
      { k: 'valor', l: 'Valor (COP)', t: 'number', req: 1 },
      { k: 'vigencia', l: 'Vigente desde', t: 'date' },
      { k: 'notas', l: 'Notas', t: 'text' }
    ],
    ejemplo: 'Polinización ANA 1\t\tPor unidad (destajo)\t450\t2026-01-01\tTarifa general\nPolinización ANA 1\tExperto\tPor unidad (destajo)\t520\t2026-01-01\tAplica a todos los expertos\nPoda\tAprendiz\tPor unidad (destajo)\t950\t2026-01-01\tTarifa en formación'
  }
};

let maestroActivo = 'trabajadores';
const getMaestro = key => JSON.parse(localStorage.getItem('agroweb_m_' + key) || '[]');
const setMaestro = (key, data) => localStorage.setItem('agroweb_m_' + key, JSON.stringify(data));

// Migración: separar 'Plateo' viejo en Químico/Mecánico si existe en datos guardados
(function migrarPlateo() {
  const cat = getMaestro('labores_cat');
  const idx = cat.findIndex(c => c.nombre === 'Plateo');
  if (idx >= 0) {
    const viejo = cat[idx];
    cat.splice(idx, 1,
      { ...viejo, id: viejo.id, nombre: 'Plateo Químico' },
      { ...viejo, id: viejo.id + 'b', nombre: 'Plateo Mecánico' });
    setMaestro('labores_cat', cat);
  }
  const tar = getMaestro('tarifas');
  let cambio = false;
  tar.forEach(t => { if (t.labor === 'Plateo') { t.labor = 'Plateo Químico'; cambio = true; } });
  if (cambio) setMaestro('tarifas', tar);
})();

// Seed del catálogo de labores si está vacío
if (!getMaestro('labores_cat').length) {
  setMaestro('labores_cat', [
    { id: 'l1', nombre: 'Polinización ANA 1', categoria: 'Polinización', unidad: 'palma', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l2', nombre: 'Polinización ANA 2', categoria: 'Polinización', unidad: 'palma', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l3', nombre: 'Polinización ANA 3', categoria: 'Polinización', unidad: 'palma', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l4', nombre: 'Poda', categoria: 'Mantenimiento', unidad: 'palma', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l5', nombre: 'Plateo Químico', categoria: 'Mantenimiento', unidad: 'palma', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l5b', nombre: 'Plateo Mecánico', categoria: 'Mantenimiento', unidad: 'palma', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l6', nombre: 'Cosecha', categoria: 'Cosecha', unidad: 'racimo', costo: 0, tipo: 'Rápida NFC' },
    { id: 'l7', nombre: 'Censo Enfermedades', categoria: 'Censo', unidad: 'palma', costo: 0, tipo: 'Con formulario' },
    { id: 'l8', nombre: 'Censo Plagas', categoria: 'Censo', unidad: 'palma', costo: 0, tipo: 'Con formulario' },
    { id: 'l9', nombre: 'Sanidad', categoria: 'Sanidad', unidad: 'palma', costo: 0, tipo: 'Con formulario' },
    { id: 'l10', nombre: 'Fertilización', categoria: 'Fertilización', unidad: 'palma', costo: 0, tipo: 'Con formulario' }
  ]);
}

function renderMaestrosTabs() {
  document.getElementById('maestros-tabs').innerHTML = Object.entries(maestrosDef).map(([k, d]) =>
    `<button class="tab ${k === maestroActivo ? 'active' : ''}" onclick="cambiarMaestro('${k}')">
      ${d.icono} ${d.nombre} <span class="tab-count">${getMaestro(k).length}</span>
    </button>`).join('');
}

function cambiarMaestro(key) {
  maestroActivo = key;
  renderMaestrosTabs();
  renderMaestroLista();
}

function renderMaestroLista() {
  const def = maestrosDef[maestroActivo];
  const data = getMaestro(maestroActivo);
  const container = document.getElementById('maestros-lista');

  // Banner de cobertura: labores sin tarifa general
  let banner = '';
  if (maestroActivo === 'tarifas') {
    const laboresCat = getMaestro('labores_cat');
    const sinTarifa = laboresCat.filter(l => !data.some(t => t.labor === l.nombre && !t.categoria));
    if (sinTarifa.length) {
      banner = `<div style="background:rgba(244,162,97,0.08); border:1px solid rgba(244,162,97,0.3); border-radius:10px; padding:12px 16px; margin-bottom:14px; font-size:12.5px; color:var(--naranja)">
        ⚠ <strong>${sinTarifa.length} labor${sinTarifa.length>1?'es':''} sin tarifa general:</strong> ${sinTarifa.map(l=>l.nombre).join(', ')} — los registros de estas labores no calcularán costo automático
      </div>`;
    } else if (laboresCat.length) {
      banner = `<div style="background:rgba(82,183,136,0.06); border:1px solid rgba(82,183,136,0.25); border-radius:10px; padding:10px 16px; margin-bottom:14px; font-size:12.5px; color:var(--verde-claro)">
        ✓ Todas las labores del catálogo tienen tarifa general — cobertura completa
      </div>`;
    }
  }

  if (!data.length) {
    container.innerHTML = banner + `<div style="padding:32px; text-align:center; color:var(--texto-dim)">
      <div style="font-size:36px; margin-bottom:10px">${def.icono}</div>
      <div style="font-size:14px; margin-bottom:4px">Sin registros en ${def.nombre}</div>
      <div style="font-size:12px">Agrega registros individualmente o usa carga masiva</div>
    </div>`;
    return;
  }

  container.innerHTML = banner + `<table class="lotes-table">
    <thead><tr>${def.campos.map(c => `<th>${c.l}</th>`).join('')}<th></th></tr></thead>
    <tbody>${data.map(r => `<tr>
      ${def.campos.map((c, i) => `<td ${i === 0 ? 'style="color:var(--verde-claro); font-weight:600"' : ''}>${
        c.t === 'number' && r[c.k] ? Number(r[c.k]).toLocaleString('es-CO') : (r[c.k] || '—')
      }</td>`).join('')}
      <td style="white-space:nowrap">
        <button class="btn-icon edit" onclick="abrirModalMaestro('${r.id}')" style="width:24px;height:24px;font-size:11px">✏️</button>
        <button class="btn-icon" onclick="eliminarMaestro('${r.id}')" style="width:24px;height:24px;font-size:11px">🗑️</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function abrirModalMaestro(id = null) {
  const def = maestrosDef[maestroActivo];
  const reg = id ? getMaestro(maestroActivo).find(x => x.id === id) : null;
  document.getElementById('modal-maestro-title').textContent = (reg ? 'Editar' : 'Nuevo') + ' — ' + def.nombre;

  let html = `<input type="hidden" id="maestro-edit-id" value="${id || ''}">`;
  for (let i = 0; i < def.campos.length; i += 2) {
    const par = def.campos.slice(i, i + 2);
    html += `<div class="form-row ${par.length === 1 ? 'full' : ''}">` + par.map(c => {
      const opciones = c.optsFn ? c.optsFn() : (c.opts || []);
      return `
      <div class="field">
        <label>${c.l}${c.req ? ' *' : ''}</label>
        ${c.t === 'select'
          ? `<select id="m-${c.k}"><option value="">Seleccionar...</option>${opciones.map(o => `<option ${reg && reg[c.k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
          : `<input type="${c.t}" id="m-${c.k}" value="${reg ? (reg[c.k] || '') : ''}" placeholder="${c.l}">`}
      </div>`;
    }).join('') + '</div>';
  }
  document.getElementById('modal-maestro-body').innerHTML = html;
  document.getElementById('modal-maestro').classList.add('open');
}

function cerrarModalMaestro() { document.getElementById('modal-maestro').classList.remove('open'); }

function guardarMaestro() {
  const def = maestrosDef[maestroActivo];
  const id = document.getElementById('maestro-edit-id').value;
  const reg = { id: id || Date.now().toString() };

  for (const c of def.campos) {
    const val = document.getElementById('m-' + c.k).value.trim();
    if (c.req && !val) { alert('El campo "' + c.l + '" es obligatorio'); return; }
    reg[c.k] = c.t === 'number' ? (parseFloat(val) || 0) : val;
  }

  const data = getMaestro(maestroActivo);
  if (id) {
    const idx = data.findIndex(x => x.id === id);
    if (idx >= 0) data[idx] = reg;
  } else {
    data.push(reg);
  }
  setMaestro(maestroActivo, data);
  cerrarModalMaestro();
  renderMaestrosTabs();
  renderMaestroLista();
}

function eliminarMaestro(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  setMaestro(maestroActivo, getMaestro(maestroActivo).filter(x => x.id !== id));
  renderMaestrosTabs();
  renderMaestroLista();
}

// Carga masiva genérica de maestros
function abrirMasivaMaestro() {
  const def = maestrosDef[maestroActivo];
  document.getElementById('masiva-maestro-title').textContent = 'Carga masiva — ' + def.nombre;
  document.getElementById('masiva-maestro-help').innerHTML =
    `Columnas en este orden:<br><span style="color:var(--verde-claro); font-family:monospace; font-size:12px">${def.campos.map(c => c.l).join(' · ')}</span>`;
  document.getElementById('masiva-maestro-data').value = '';
  document.getElementById('masiva-maestro-preview').style.display = 'none';
  document.getElementById('modal-masiva-maestro').classList.add('open');
}

function cerrarMasivaMaestro() { document.getElementById('modal-masiva-maestro').classList.remove('open'); }

function usarEjemploMaestro() {
  document.getElementById('masiva-maestro-data').value = maestrosDef[maestroActivo].ejemplo;
}

function parseMasivaMaestro() {
  const def = maestrosDef[maestroActivo];
  const raw = document.getElementById('masiva-maestro-data').value.trim();
  if (!raw) return { regs: [], errores: ['Sin datos'] };
  const regs = [], errores = [];
  raw.split('\n').map(l => l.trim()).filter(Boolean).forEach((linea, i) => {
    const cols = linea.includes('\t') ? linea.split('\t') : linea.split(';');
    const primera = (cols[0] || '').trim();
    // Ignorar fila de encabezado si la primera celda coincide con la etiqueta de la primera columna
    if (i === 0 && primera.toLowerCase() === def.campos[0].l.toLowerCase()) return;
    if (!primera) { errores.push(`Línea ${i + 1}: campo obligatorio vacío`); return; }
    const reg = { id: Date.now().toString() + '_' + i };
    def.campos.forEach((c, j) => {
      const val = (cols[j] || '').trim();
      reg[c.k] = c.t === 'number' ? (parseFloat(val.replace(',', '.')) || 0) : val;
    });
    regs.push(reg);
  });
  return { regs, errores };
}

function previewMasivaMaestro() {
  const { regs, errores } = parseMasivaMaestro();
  const p = document.getElementById('masiva-maestro-preview');
  p.style.display = 'block';
  p.innerHTML = `✓ <strong>${regs.length} registros</strong> listos para cargar` +
    (errores.length ? `<br><span style="color:var(--naranja)">⚠ ${errores.join(' · ')}</span>` : '');
}

function cargarMasivaMaestro() {
  const { regs } = parseMasivaMaestro();
  if (!regs.length) { alert('No hay registros válidos'); return; }
  const data = getMaestro(maestroActivo);
  setMaestro(maestroActivo, data.concat(regs));
  cerrarMasivaMaestro();
  renderMaestrosTabs();
  renderMaestroLista();
  alert(`✓ ${regs.length} registros cargados en ${maestrosDef[maestroActivo].nombre}`);
}

['modal-maestro', 'modal-masiva-maestro'].forEach(id =>
  document.getElementById(id).addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); }));

renderMaestrosTabs();
renderMaestroLista();

// ── FORM BUILDER ────────────────────────────────────────
let customForms = JSON.parse(localStorage.getItem('agroweb_forms') || '[]');
let formResp = JSON.parse(localStorage.getItem('agroweb_form_resp') || '[]');

const saveForms = () => localStorage.setItem('agroweb_forms', JSON.stringify(customForms));
const saveResp = () => localStorage.setItem('agroweb_form_resp', JSON.stringify(formResp));

const tiposCampoFB = [
  { v: 'text', l: '📝 Texto' },
  { v: 'number', l: '🔢 Número' },
  { v: 'date', l: '📅 Fecha' },
  { v: 'select', l: '📃 Lista fija (opciones separadas por coma)' },
  { v: 'maestro:trabajadores', l: '👷 Maestro: Trabajadores' },
  { v: 'maestro:lotes', l: '🏞️ Maestro: Lotes' },
  { v: 'maestro:labores_cat', l: '📋 Maestro: Labores' },
  { v: 'maestro:vehiculos', l: '🚛 Maestro: Vehículos' },
  { v: 'maestro:insumos', l: '🧪 Maestro: Insumos' }
];

function abrirFormBuilder(id = null) {
  const f = id ? customForms.find(x => x.id === id) : null;
  document.getElementById('fb-edit-id').value = id || '';
  document.getElementById('fb-nombre').value = f ? f.nombre : '';
  document.getElementById('fb-icono').value = f ? f.icono : '';
  document.getElementById('fb-desc').value = f ? f.desc : '';
  document.getElementById('fb-campos').innerHTML = '';
  if (f) f.campos.forEach(c => agregarCampoFB(c));
  else agregarCampoFB();
  document.getElementById('modal-fb').classList.add('open');
}

function cerrarFormBuilder() { document.getElementById('modal-fb').classList.remove('open'); }

function agregarCampoFB(campo = null) {
  const div = document.createElement('div');
  div.className = 'fb-field-row';
  div.innerHTML = `
    <input type="text" class="fb-label" placeholder="Nombre del campo" value="${campo ? campo.label : ''}">
    <select class="fb-tipo" onchange="this.parentElement.querySelector('.fb-opts').style.display = this.value === 'select' ? 'block' : 'none'">
      ${tiposCampoFB.map(t => `<option value="${t.v}" ${campo && campo.tipo === t.v ? 'selected' : ''}>${t.l}</option>`).join('')}
    </select>
    <input type="text" class="fb-opts" placeholder="opción1, opción2..." value="${campo && campo.opts ? campo.opts : ''}" style="display:${campo && campo.tipo === 'select' ? 'block' : 'none'}; flex:1.5">
    <button class="btn-icon" onclick="this.parentElement.remove()" style="flex-shrink:0">🗑️</button>`;
  document.getElementById('fb-campos').appendChild(div);
}

function guardarFormulario() {
  const nombre = document.getElementById('fb-nombre').value.trim();
  if (!nombre) { alert('Ponle nombre al formulario'); return; }

  const campos = [...document.querySelectorAll('#fb-campos .fb-field-row')].map(row => ({
    label: row.querySelector('.fb-label').value.trim(),
    tipo: row.querySelector('.fb-tipo').value,
    opts: row.querySelector('.fb-opts').value.trim()
  })).filter(c => c.label);

  if (!campos.length) { alert('Agrega al menos un campo'); return; }

  const id = document.getElementById('fb-edit-id').value;
  const form = {
    id: id || Date.now().toString(),
    nombre,
    icono: document.getElementById('fb-icono').value.trim() || '📝',
    desc: document.getElementById('fb-desc').value.trim(),
    campos
  };

  if (id) {
    const idx = customForms.findIndex(x => x.id === id);
    if (idx >= 0) customForms[idx] = form;
  } else customForms.push(form);

  saveForms();
  cerrarFormBuilder();
  renderCustomForms();
}

function eliminarFormulario(id) {
  if (!confirm('¿Eliminar este formulario y sus respuestas?')) return;
  customForms = customForms.filter(x => x.id !== id);
  formResp = formResp.filter(r => r.formId !== id);
  saveForms(); saveResp();
  renderCustomForms();
}

function renderCustomForms() {
  const grid = document.getElementById('custom-forms-grid');
  if (!customForms.length) {
    grid.innerHTML = `<div class="empty-lotes" style="padding:28px">
      <div style="font-size:32px; margin-bottom:8px">📝</div>
      <div class="empty-lotes-text">Sin formularios personalizados</div>
      <div class="empty-lotes-sub">Crea formularios que jalan datos de tus maestros</div>
    </div>`;
    return;
  }
  grid.innerHTML = customForms.map(f => {
    const nResp = formResp.filter(r => r.formId === f.id).length;
    const maestrosUsados = [...new Set(f.campos.filter(c => c.tipo.startsWith('maestro:')).map(c => {
      const key = c.tipo.split(':')[1];
      return key === 'lotes' ? '🏞️' : maestrosDef[key]?.icono || '';
    }))].join(' ');
    return `<div class="form-card" style="cursor:default">
      <div style="display:flex; justify-content:space-between; align-items:flex-start">
        <div class="form-card-icon">${f.icono}</div>
        <div style="display:flex; gap:4px">
          <button class="btn-icon edit" onclick="abrirFormBuilder('${f.id}')" style="width:24px;height:24px;font-size:11px">✏️</button>
          <button class="btn-icon" onclick="eliminarFormulario('${f.id}')" style="width:24px;height:24px;font-size:11px">🗑️</button>
        </div>
      </div>
      <div class="form-card-name">${f.nombre}</div>
      <div class="form-card-type">${f.desc || 'Formulario personalizado'}</div>
      <div class="form-card-fields">${f.campos.length} campos ${maestrosUsados ? '· conecta ' + maestrosUsados : ''}</div>
      <div style="display:flex; gap:8px; margin-top:12px">
        <button class="btn-primary" style="margin:0; padding:6px 14px; font-size:12px; flex:1" onclick="abrirFill('${f.id}')">✍️ Diligenciar</button>
        <button class="btn-cancel" style="padding:6px 14px; font-size:12px" onclick="verRespuestas('${f.id}')">${nResp} resp.</button>
      </div>
    </div>`;
  }).join('');
}

let fillFormId = null;

function abrirFill(id) {
  const f = customForms.find(x => x.id === id);
  if (!f) return;
  fillFormId = id;
  document.getElementById('fill-title').textContent = f.icono + ' ' + f.nombre;

  document.getElementById('fill-body').innerHTML = f.campos.map((c, i) => {
    let input = '';
    if (c.tipo === 'select') {
      input = `<select id="fill-${i}"><option value="">Seleccionar...</option>${c.opts.split(',').map(o => `<option>${o.trim()}</option>`).join('')}</select>`;
    } else if (c.tipo.startsWith('maestro:')) {
      const key = c.tipo.split(':')[1];
      let opciones = [];
      if (key === 'lotes') {
        opciones = lotes.map(l => `Lote ${l.numero}${l.nombre ? ' · ' + l.nombre : ''}`);
      } else {
        const def = maestrosDef[key];
        opciones = getMaestro(key).map(r => r[def.display]);
      }
      input = opciones.length
        ? `<select id="fill-${i}"><option value="">Seleccionar...</option>${opciones.map(o => `<option>${o}</option>`).join('')}</select>`
        : `<select id="fill-${i}" disabled><option>⚠ Sin registros en el maestro</option></select>`;
    } else {
      input = `<input type="${c.tipo}" id="fill-${i}" ${c.tipo === 'date' ? `value="${new Date().toISOString().slice(0,10)}"` : ''} placeholder="${c.label}">`;
    }
    return `<div class="field"><label>${c.label}</label>${input}</div>`;
  }).join('');

  document.getElementById('modal-fill').classList.add('open');
}

function cerrarFill() { document.getElementById('modal-fill').classList.remove('open'); }

function guardarRespuesta() {
  const f = customForms.find(x => x.id === fillFormId);
  if (!f) return;
  const valores = {};
  f.campos.forEach((c, i) => {
    const el = document.getElementById('fill-' + i);
    valores[c.label] = el && !el.disabled ? el.value : '';
  });
  formResp.unshift({ id: Date.now().toString(), formId: fillFormId, fecha: new Date().toISOString(), valores });
  saveResp();
  cerrarFill();
  renderCustomForms();
  alert('✓ Registro guardado');
}

function verRespuestas(id) {
  const f = customForms.find(x => x.id === id);
  const resp = formResp.filter(r => r.formId === id);
  document.getElementById('resp-title').textContent = f.icono + ' ' + f.nombre + ' — ' + resp.length + ' respuestas';
  document.getElementById('resp-body').innerHTML = !resp.length
    ? '<div style="text-align:center; color:var(--texto-dim); padding:24px">Sin respuestas aún</div>'
    : `<table class="lotes-table"><thead><tr><th>Fecha</th>${f.campos.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${resp.map(r => `<tr>
        <td>${new Date(r.fecha).toLocaleDateString('es-CO', {month:'short', day:'numeric'})} ${new Date(r.fecha).toLocaleTimeString('es-CO', {hour:'2-digit', minute:'2-digit'})}</td>
        ${f.campos.map(c => `<td>${r.valores[c.label] || '—'}</td>`).join('')}
      </tr>`).join('')}</tbody></table>`;
  document.getElementById('modal-resp').classList.add('open');
}

['modal-fb', 'modal-fill', 'modal-resp'].forEach(id =>
  document.getElementById(id).addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); }));

renderCustomForms();

// ── DATOS DEMO ──────────────────────────────────────────
function cargarDemo() {
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0,7);
  const d = (diasAtras, hora = 8) => {
    const dt = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diasAtras, hora, Math.floor(Math.random()*50));
    return dt.toISOString();
  };
  const df = diasAtras => d(diasAtras).slice(0,10);

  // LOTES
  lotes = [
    { id: 'dl1', numero: 1, nombre: 'La Esperanza', has: 285, palmas: 36480, variedad: 'Híbrido OxG Corpoica', estado: 'establecimiento', fecha: '2024-11-10', densidad: 128, lineas: 190, palmasLinea: 192, obs: 'Terreno plano, buen drenaje', creadoEn: d(90) },
    { id: 'dl2', numero: 2, nombre: 'El Progreso', has: 310, palmas: 39680, variedad: 'Híbrido OxG Corpoica', estado: 'establecimiento', fecha: '2025-01-20', densidad: 128, lineas: 205, palmasLinea: 194, obs: '', creadoEn: d(90) },
    { id: 'dl3', numero: 3, nombre: 'Los Corozos', has: 265, palmas: 33920, variedad: 'Tenera OxG', estado: 'establecimiento', fecha: '2025-03-05', densidad: 128, lineas: 176, palmasLinea: 193, obs: 'Sector con nivel freático alto en invierno', creadoEn: d(90) },
    { id: 'dl4', numero: 4, nombre: 'La Palmita', has: 298, palmas: 38144, variedad: 'Híbrido OxG ASD', estado: 'preparacion', fecha: '', densidad: 128, lineas: 0, palmasLinea: 0, obs: 'Adecuación de drenajes en curso', creadoEn: d(90) },
    { id: 'dl5', numero: 5, nombre: 'El Mirador', has: 340, palmas: 0, variedad: 'Por definir', estado: 'preparacion', fecha: '', densidad: 0, lineas: 0, palmasLinea: 0, obs: 'Pendiente análisis de suelos', creadoEn: d(90) },
    { id: 'dl6', numero: 6, nombre: 'Sabana Alta', has: 596, palmas: 0, variedad: 'Por definir', estado: 'preparacion', fecha: '', densidad: 0, lineas: 0, palmasLinea: 0, obs: 'Fase de topografía', creadoEn: d(90) }
  ];
  saveLotes();

  // TRABAJADORES
  setMaestro('trabajadores', [
    { id: 'dt1', nombre: 'José Alirio Pérez', cedula: '1120345678', rol: 'Supervisor', categoria: 'Estándar', cuadrilla: 'Cuadrilla 1', telefono: '3101234567', tarifa: 95000 },
    { id: 'dt2', nombre: 'María Fernanda Gómez', cedula: '1120987654', rol: 'Supervisor', categoria: 'Estándar', cuadrilla: 'Cuadrilla 2', telefono: '3129876543', tarifa: 95000 },
    { id: 'dt3', nombre: 'Carlos Andrés Ruiz', cedula: '1121112233', rol: 'Trabajador de campo', categoria: 'Experto', cuadrilla: 'Cuadrilla 1', telefono: '3115556677', tarifa: 62000 },
    { id: 'dt4', nombre: 'Luz Dary Martínez', cedula: '1122334455', rol: 'Trabajador de campo', categoria: 'Experto', cuadrilla: 'Cuadrilla 1', telefono: '3134445566', tarifa: 62000 },
    { id: 'dt5', nombre: 'Wilmer Rodríguez', cedula: '1123456789', rol: 'Trabajador de campo', categoria: 'Estándar', cuadrilla: 'Cuadrilla 2', telefono: '3146667788', tarifa: 62000 },
    { id: 'dt6', nombre: 'Yeison Castañeda', cedula: '1124567890', rol: 'Trabajador de campo', categoria: 'Aprendiz', cuadrilla: 'Cuadrilla 2', telefono: '3157778899', tarifa: 62000 },
    { id: 'dt7', nombre: 'Ana Milena Torres', cedula: '1125678901', rol: 'Operador báscula', categoria: 'Estándar', cuadrilla: '', telefono: '3168889900', tarifa: 70000 },
    { id: 'dt8', nombre: 'Hernán Buitrago', cedula: '1126789012', rol: 'Administrador de campo', categoria: 'Estándar', cuadrilla: '', telefono: '3179990011', tarifa: 120000 }
  ]);

  // CATÁLOGO DE LABORES con costos
  setMaestro('labores_cat', [
    { id: 'l1', nombre: 'Polinización ANA 1', categoria: 'Polinización', unidad: 'palma', costo: 450, tipo: 'Rápida NFC' },
    { id: 'l2', nombre: 'Polinización ANA 2', categoria: 'Polinización', unidad: 'palma', costo: 450, tipo: 'Rápida NFC' },
    { id: 'l3', nombre: 'Polinización ANA 3', categoria: 'Polinización', unidad: 'palma', costo: 450, tipo: 'Rápida NFC' },
    { id: 'l4', nombre: 'Poda', categoria: 'Mantenimiento', unidad: 'palma', costo: 1200, tipo: 'Rápida NFC' },
    { id: 'l5', nombre: 'Plateo Químico', categoria: 'Mantenimiento', unidad: 'palma', costo: 850, tipo: 'Rápida NFC' },
    { id: 'l5b', nombre: 'Plateo Mecánico', categoria: 'Mantenimiento', unidad: 'palma', costo: 780, tipo: 'Rápida NFC' },
    { id: 'l6', nombre: 'Cosecha', categoria: 'Cosecha', unidad: 'racimo', costo: 320, tipo: 'Rápida NFC' },
    { id: 'l7', nombre: 'Censo Enfermedades', categoria: 'Censo', unidad: 'palma', costo: 180, tipo: 'Con formulario' },
    { id: 'l8', nombre: 'Censo Plagas', categoria: 'Censo', unidad: 'palma', costo: 180, tipo: 'Con formulario' },
    { id: 'l9', nombre: 'Sanidad', categoria: 'Sanidad', unidad: 'palma', costo: 2500, tipo: 'Con formulario' },
    { id: 'l10', nombre: 'Fertilización', categoria: 'Fertilización', unidad: 'palma', costo: 1800, tipo: 'Con formulario' }
  ]);

  // VEHÍCULOS
  setMaestro('vehiculos', [
    { id: 'dv1', placa: 'SRT482', tipo: 'Camión sencillo', conductor: 'Pedro Martínez', capacidad: 8000, propietario: 'Transportes El Llano' },
    { id: 'dv2', placa: 'WKM915', tipo: 'Doble troque', conductor: 'Luis Eduardo Rojas', capacidad: 17000, propietario: 'Transportes El Llano' },
    { id: 'dv3', placa: 'THX330', tipo: 'Camión sencillo', conductor: 'Fabián Cruz', capacidad: 8500, propietario: 'Propio' },
    { id: 'dv4', placa: 'JDZ204', tipo: 'Tractor', conductor: 'Yeison Castañeda', capacidad: 4000, propietario: 'Propio' }
  ]);

  // INSUMOS
  setMaestro('insumos', [
    { id: 'di1', nombre: 'Urea 46%', tipo: 'Fertilizante', unidad: 'bulto 50kg', costo: 145000, proveedor: 'Agroinsumos Casanare' },
    { id: 'di2', nombre: 'KCl (Cloruro de potasio)', tipo: 'Fertilizante', unidad: 'bulto 50kg', costo: 168000, proveedor: 'Agroinsumos Casanare' },
    { id: 'di3', nombre: 'ANA hormona polinización', tipo: 'Fitosanitario', unidad: 'frasco 100ml', costo: 85000, proveedor: 'Química Palm' },
    { id: 'di4', nombre: 'Fungicida sistémico', tipo: 'Fitosanitario', unidad: 'litro', costo: 96000, proveedor: 'Química Palm' },
    { id: 'di5', nombre: 'Glifosato', tipo: 'Fitosanitario', unidad: 'litro', costo: 28000, proveedor: 'Agroinsumos Casanare' },
    { id: 'di6', nombre: 'ACPM', tipo: 'Combustible', unidad: 'galón', costo: 10200, proveedor: 'EDS Maní' }
  ]);

  // LABORES del mes (histórico)
  labores = [
    { id: 'lb1', actividad: 'Polinización ANA 1', lote: '1', fecha: df(1), cantidad: 420, trabajador: 'Carlos Andrés Ruiz', costo: 189000, obs: '', estado: 'aprobada' },
    { id: 'lb2', actividad: 'Polinización ANA 2', lote: '1', fecha: df(1), cantidad: 385, trabajador: 'Luz Dary Martínez', costo: 173250, obs: '', estado: 'aprobada' },
    { id: 'lb3', actividad: 'Polinización ANA 1', lote: '2', fecha: df(2), cantidad: 450, trabajador: 'Wilmer Rodríguez', costo: 202500, obs: '', estado: 'aprobada' },
    { id: 'lb4', actividad: 'Poda', lote: '1', lineaR: {desde:10,hasta:14}, linea: 10, fecha: df(3), cantidad: 180, trabajador: 'Yeison Castañeda', costo: 216000, obs: 'Poda sanitaria sector norte', estado: 'aprobada' },
    { id: 'lb5', actividad: 'Plateo Químico', lote: '2', lineaR: {desde:1,hasta:8}, palmaR: {desde:1,hasta:40}, linea: 1, fecha: df(4), cantidad: 320, trabajador: 'Carlos Andrés Ruiz', costo: 272000, obs: '', estado: 'aprobada' },
    { id: 'lb6', actividad: 'Plateo Mecánico', lote: '3', lineaR: {desde:50,hasta:57}, linea: 50, fecha: df(5), cantidad: 290, trabajador: 'Wilmer Rodríguez', costo: 246500, obs: '', estado: 'aprobada' },
    { id: 'lb7', actividad: 'Censo Enfermedades', lote: '3', linea: 42, palma: null, fecha: df(6), cantidad: 500, trabajador: 'José Alirio Pérez', costo: 90000, obs: '2 casos sospechosos PC: Ln42-P18 y Ln67-P103', estado: 'aprobada' },
    { id: 'lb8', actividad: 'Censo Plagas', lote: '1', linea: 15, palma: null, fecha: df(7), cantidad: 500, trabajador: 'María Fernanda Gómez', costo: 90000, obs: 'Strategus en 8 palmas de Ln15 a Ln22', estado: 'aprobada' },
    { id: 'lb9', actividad: 'Sanidad', lote: '3', linea: 42, palma: 18, fecha: df(8), cantidad: 12, trabajador: 'José Alirio Pérez', costo: 30000, obs: 'Cirugía preventiva PC', estado: 'aprobada' },
    { id: 'lb10', actividad: 'Polinización ANA 3', lote: '1', fecha: df(9), cantidad: 405, trabajador: 'Luz Dary Martínez', costo: 182250, obs: '', estado: 'aprobada' },
    { id: 'lb11', actividad: 'Fertilización', lote: '2', fecha: df(10), cantidad: 800, trabajador: 'Cuadrilla 2', costo: 1440000, obs: 'Urea + KCl según plan', estado: 'aprobada' },
    { id: 'lb12', actividad: 'Cosecha', lote: '1', fecha: df(2), cantidad: 340, trabajador: 'Cuadrilla 1', costo: 108800, obs: 'Primera cosecha piloto', estado: 'aprobada' },
    { id: 'lb13', actividad: 'Polinización ANA 1', lote: '1', linea: 45, fecha: df(0), cantidad: 1, trabajador: 'Carlos Andrés Ruiz', costo: 450, obs: '', estado: 'pendiente', gps: { lat: 4.81652, lng: -72.28934 } },
    { id: 'lb14', actividad: 'Polinización ANA 1', lote: '1', linea: 45, fecha: df(0), cantidad: 1, trabajador: 'Carlos Andrés Ruiz', costo: 450, obs: '', estado: 'pendiente', gps: { lat: 4.81658, lng: -72.28921 } },
    { id: 'lb15', actividad: 'Polinización ANA 1', lote: '1', linea: 46, fecha: df(0), cantidad: 1, trabajador: 'Carlos Andrés Ruiz', costo: 450, obs: '', estado: 'pendiente', gps: { lat: 4.81671, lng: -72.28919 } },
    { id: 'lb16', actividad: 'Polinización ANA 2', lote: '2', fecha: df(1), cantidad: 410, trabajador: 'Wilmer Rodríguez', costo: 184500, obs: '', estado: 'aprobada' },
    { id: 'lb17', actividad: 'Polinización ANA 3', lote: '2', fecha: df(6), cantidad: 395, trabajador: 'Luz Dary Martínez', costo: 177750, obs: '', estado: 'aprobada' },
    { id: 'lb18', actividad: 'Poda', lote: '2', lineaR: {desde:20,hasta:28}, linea: 20, fecha: df(2), cantidad: 220, trabajador: 'Yeison Castañeda', costo: 264000, obs: 'Poda de producción', estado: 'aprobada' },
    { id: 'lb19', actividad: 'Plateo Químico', lote: '1', lineaR: {desde:60,hasta:75}, linea: 60, fecha: df(1), cantidad: 480, trabajador: 'Carlos Andrés Ruiz', costo: 408000, obs: '', estado: 'aprobada' },
    { id: 'lb20', actividad: 'Fertilización', lote: '1', lineaR: {desde:1,hasta:30}, linea: 1, fecha: df(4), cantidad: 950, trabajador: 'Cuadrilla 1', costo: 1710000, obs: 'Primera aplicación KCl', estado: 'aprobada' },
    { id: 'lb21', actividad: 'Fertilización', lote: '3', fecha: df(7), cantidad: 620, trabajador: 'Cuadrilla 2', costo: 1116000, obs: '', estado: 'pendiente' },
    { id: 'lb22', actividad: 'Cosecha', lote: '2', fecha: df(1), cantidad: 180, trabajador: 'Cuadrilla 2', costo: 57600, obs: '', estado: 'aprobada' }
  ];
  saveLabores();

  // PRESUPUESTOS del mes actual
  presupuestos = [
    { id: 'dp1', actividad: 'Polinización', mes: mesActual, valor: 3500000, meta: 8000, notas: 'Lotes 1 y 2' },
    { id: 'dp2', actividad: 'Mantenimiento', mes: mesActual, valor: 4200000, meta: 3500, notas: 'Poda + plateo programado' },
    { id: 'dp3', actividad: 'Censo', mes: mesActual, valor: 600000, meta: 2000, notas: 'Censo fitosanitario mensual' },
    { id: 'dp4', actividad: 'Sanidad', mes: mesActual, valor: 1500000, meta: 50, notas: 'Intervenciones PC' },
    { id: 'dp5', actividad: 'Fertilización', mes: mesActual, valor: 6000000, meta: 3000, notas: 'Segunda aplicación del año' },
    { id: 'dp6', actividad: 'Cosecha', mes: mesActual, valor: 800000, meta: 1500, notas: 'Cosecha piloto lote 1' }
  ];
  savePpto();

  // PESAJES BÁSCULA
  pesajes = [
    { id: 'ps1', tiquete: '00001', placa: 'SRT482', conductor: 'Pedro Martínez', lote: '1', destino: 'Extractora del Llano', bruto: 14850, tara: 7200, neto: 7650, racimos: 480, obs: '', fecha: d(2, 7), fechaSalida: d(2, 9) },
    { id: 'ps2', tiquete: '00002', placa: 'THX330', conductor: 'Fabián Cruz', lote: '1', destino: 'Extractora del Llano', bruto: 15200, tara: 7450, neto: 7750, racimos: 495, obs: '', fecha: d(2, 10), fechaSalida: d(2, 12) },
    { id: 'ps3', tiquete: '00003', placa: 'WKM915', conductor: 'Luis Eduardo Rojas', lote: '1', destino: 'Extractora del Llano', bruto: 24300, tara: 11800, neto: 12500, racimos: 790, obs: 'Fruta en buen estado', fecha: d(1, 8), fechaSalida: d(1, 11) },
    { id: 'ps4', tiquete: '00004', placa: 'SRT482', conductor: 'Pedro Martínez', lote: '2', destino: 'Extractora del Llano', bruto: 14100, tara: 7200, neto: 6900, racimos: 430, obs: '', fecha: d(0, 7), fechaSalida: d(0, 9) },
    { id: 'ps5', tiquete: '00005', placa: 'THX330', conductor: 'Fabián Cruz', lote: '1', destino: 'Extractora del Llano', bruto: 15600, tara: 0, neto: 0, racimos: 0, obs: 'En descargue', fecha: d(0, 11), fechaSalida: null },
    { id: 'ps6', tiquete: '00006', placa: 'WKM915', conductor: 'Luis Eduardo Rojas', lote: '2', destino: 'Extractora del Llano', bruto: 23800, tara: 11800, neto: 12000, racimos: 760, obs: '', fecha: d(3, 9), fechaSalida: d(3, 12) },
    { id: 'ps7', tiquete: '00007', placa: 'SRT482', conductor: 'Pedro Martínez', lote: '1', destino: 'Extractora del Llano', bruto: 14600, tara: 7200, neto: 7400, racimos: 465, obs: '', fecha: d(4, 8), fechaSalida: d(4, 10) }
  ];
  savePesajes();

  // ENFERMEDADES Y PLAGAS
  setMaestro('enfermedades', [
    { id: 'e1', nombre: 'Pudrición del Cogollo (PC)', tipo: 'Enfermedad', letalidad: 'Alto', manejo: 'Cirugía + fungicida sistémico' },
    { id: 'e2', nombre: 'Anillo Rojo', tipo: 'Enfermedad', letalidad: 'Alto', manejo: 'Erradicación inmediata' },
    { id: 'e3', nombre: 'Marchitez Sorpresiva', tipo: 'Enfermedad', letalidad: 'Alto', manejo: 'Erradicación y control de vector' },
    { id: 'e4', nombre: 'Pestalotiopsis', tipo: 'Enfermedad', letalidad: 'Medio', manejo: 'Fungicida foliar' },
    { id: 'e5', nombre: 'Rhynchophorus palmarum', tipo: 'Plaga', letalidad: 'Alto', manejo: 'Trampeo con feromonas' },
    { id: 'e6', nombre: 'Strategus aloeus', tipo: 'Plaga', letalidad: 'Medio', manejo: 'Control manual y trampas' }
  ]);

  // DETECCIONES individuales por palma
  detecciones = [
    { id: 'det1', enfermedad: 'Pudrición del Cogollo (PC)', lote: '3', linea: 42, palma: 18, severidad: 'Moderada', detectadaPor: 'José Alirio Pérez', fechaDeteccion: df(8), estado: 'tratamiento', obs: 'Hoja flecha doblada, tejido blando', historial: [{fecha: df(8), estado:'activo', nota:'Detección inicial'},{fecha: df(6), estado:'tratamiento', nota:'Cirugía realizada'}] },
    { id: 'det2', enfermedad: 'Pudrición del Cogollo (PC)', lote: '3', linea: 67, palma: 103, severidad: 'Severa', detectadaPor: 'José Alirio Pérez', fechaDeteccion: df(8), estado: 'erradicada', obs: 'Avanzada, no recuperable', historial: [{fecha: df(8), estado:'activo', nota:'Detección inicial'},{fecha: df(5), estado:'erradicada', nota:'Palma eliminada'}] },
    { id: 'det3', enfermedad: 'Strategus aloeus', lote: '1', linea: 15, palma: 8, severidad: 'Leve', detectadaPor: 'María Fernanda Gómez', fechaDeteccion: df(7), estado: 'recuperada', obs: 'Daño en base del estípite', historial: [{fecha: df(7), estado:'activo', nota:'Detección'},{fecha: df(2), estado:'recuperada', nota:'Control exitoso'}] },
    { id: 'det4', enfermedad: 'Pestalotiopsis', lote: '2', linea: 30, palma: 45, severidad: 'Moderada', detectadaPor: 'María Fernanda Gómez', fechaDeteccion: df(3), estado: 'activo', obs: 'Manchas foliares en tercio inferior', historial: [{fecha: df(3), estado:'activo', nota:'Detección inicial'}] },
    { id: 'det5', enfermedad: 'Anillo Rojo', lote: '1', linea: 22, palma: 60, severidad: 'Severa', detectadaPor: 'José Alirio Pérez', fechaDeteccion: df(1), estado: 'activo', obs: 'Confirmar con laboratorio', historial: [{fecha: df(1), estado:'activo', nota:'Sospecha, pendiente confirmación'}] }
  ];
  saveDet();

  // TARIFAS vigentes
  setMaestro('tarifas', [
    { id: 'tf0', labor: 'Polinización ANA 1', categoria: 'Experto', tipo: 'Por unidad (destajo)', valor: 520, vigencia: '2026-01-01', notas: 'Aplica a todos los polinizadores expertos' },
    { id: 'tf1', labor: 'Polinización ANA 1', categoria: '', tipo: 'Por unidad (destajo)', valor: 450, vigencia: '2026-01-01', notas: 'Tarifa 2026' },
    { id: 'tf2', labor: 'Polinización ANA 2', tipo: 'Por unidad (destajo)', valor: 450, vigencia: '2026-01-01', notas: 'Tarifa 2026' },
    { id: 'tf3', labor: 'Polinización ANA 3', tipo: 'Por unidad (destajo)', valor: 450, vigencia: '2026-01-01', notas: 'Tarifa 2026' },
    { id: 'tf4', labor: 'Poda', tipo: 'Por unidad (destajo)', valor: 1200, vigencia: '2026-01-01', notas: '' },
    { id: 'tf5', labor: 'Plateo Químico', tipo: 'Por unidad (destajo)', valor: 850, vigencia: '2026-01-01', notas: 'Incluye manejo de producto' },
    { id: 'tf5b', labor: 'Plateo Mecánico', tipo: 'Por unidad (destajo)', valor: 780, vigencia: '2026-01-01', notas: 'Con guadaña' },
    { id: 'tf5c', labor: 'Plateo Químico', categoria: 'Aprendiz', tipo: 'Por unidad (destajo)', valor: 700, vigencia: '2026-01-01', notas: 'En formación, con supervisión' },
    { id: 'tf6', labor: 'Cosecha', tipo: 'Por unidad (destajo)', valor: 320, vigencia: '2026-01-01', notas: 'Por racimo cortado' },
    { id: 'tf7', labor: 'Censo Enfermedades', tipo: 'Por unidad (destajo)', valor: 180, vigencia: '2026-01-01', notas: 'Por palma censada' },
    { id: 'tf8', labor: 'Censo Plagas', tipo: 'Por unidad (destajo)', valor: 180, vigencia: '2026-01-01', notas: 'Por palma censada' },
    { id: 'tf9', labor: 'Sanidad', tipo: 'Por día', valor: 75000, vigencia: '2026-01-01', notas: 'Jornal especializado' },
    { id: 'tf10', labor: 'Fertilización', tipo: 'Por unidad (destajo)', valor: 1800, vigencia: '2026-01-01', notas: 'Incluye aplicación' }
  ]);

  // CENSOS DE PRODUCCIÓN
  censosProduccion = [
    { id: 'cp1', lote: '1', lineaR: {desde:1,hasta:50}, fecha: df(5), verdes: 890, pintones: 210, maduros: 145, censadoPor: 'José Alirio Pérez', obs: '' },
    { id: 'cp2', lote: '1', lineaR: {desde:51,hasta:100}, fecha: df(5), verdes: 820, pintones: 185, maduros: 132, censadoPor: 'José Alirio Pérez', obs: '' },
    { id: 'cp3', lote: '2', lineaR: {desde:1,hasta:60}, fecha: df(3), verdes: 940, pintones: 160, maduros: 98, censadoPor: 'María Fernanda Gómez', obs: 'Maduración pareja' }
  ];
  saveCensos();

  // USUARIOS con permisos
  setMaestro('usuarios', [
    { id: 'u1', nombre: 'Santiago', pin: '1234', rol: 'Administrador', trabajador: '', activo: 'Activo' },
    { id: 'u2', nombre: 'José Alirio Pérez', pin: '1111', rol: 'Supervisor', trabajador: 'José Alirio Pérez', activo: 'Activo' },
    { id: 'u3', nombre: 'Ana Milena Torres', pin: '2222', rol: 'Operador báscula', trabajador: 'Ana Milena Torres', activo: 'Activo' },
    { id: 'u4', nombre: 'Carlos Andrés Ruiz', pin: '3333', rol: 'Trabajador de campo', trabajador: 'Carlos Andrés Ruiz', activo: 'Activo' }
  ]);

  // FORMULARIO PERSONALIZADO de ejemplo
  customForms = [
    { id: 'df1', nombre: 'Inspección de drenajes', icono: '💧', desc: 'Revisión mensual de canales por lote',
      campos: [
        { label: 'Lote', tipo: 'maestro:lotes', opts: '' },
        { label: 'Responsable', tipo: 'maestro:trabajadores', opts: '' },
        { label: 'Estado del canal', tipo: 'select', opts: 'Bueno, Requiere limpieza, Obstruido, Colapsado' },
        { label: 'Metros afectados', tipo: 'number', opts: '' },
        { label: 'Fecha', tipo: 'date', opts: '' },
        { label: 'Observaciones', tipo: 'text', opts: '' }
      ] },
    { id: 'df2', nombre: 'Entrega de insumos', icono: '📦', desc: 'Control de salida de bodega',
      campos: [
        { label: 'Insumo', tipo: 'maestro:insumos', opts: '' },
        { label: 'Cantidad entregada', tipo: 'number', opts: '' },
        { label: 'Recibe', tipo: 'maestro:trabajadores', opts: '' },
        { label: 'Lote destino', tipo: 'maestro:lotes', opts: '' },
        { label: 'Fecha', tipo: 'date', opts: '' }
      ] }
  ];
  saveForms();

  formResp = [
    { id: 'dr1', formId: 'df1', fecha: d(3), valores: { 'Lote': 'Lote 3 · Los Corozos', 'Responsable': 'José Alirio Pérez', 'Estado del canal': 'Requiere limpieza', 'Metros afectados': '120', 'Fecha': df(3), 'Observaciones': 'Sedimentación en canal principal sector sur' } },
    { id: 'dr2', formId: 'df2', fecha: d(10), valores: { 'Insumo': 'Urea 46%', 'Cantidad entregada': '40', 'Recibe': 'Wilmer Rodríguez', 'Lote destino': 'Lote 2 · El Progreso', 'Fecha': df(10) } }
  ];
  saveResp();

  // Re-render todo
  renderLotes();
  actualizarDashboard();
  renderLabores();
  renderPresupuesto();
  renderBascula();
  renderMaestrosTabs();
  renderMaestroLista();
  renderCustomForms();
  actualizarDashboardLabores();
}

function actualizarDashboardLabores() {
  // Actualizar gráfico de labores del dashboard
  const mes = new Date().toISOString().slice(0,7);
  const laboresMes = labores.filter(l => l.fecha && l.fecha.slice(0,7) === mes);
  const conteos = {
    'Polinización': laboresMes.filter(l => (actividadCategoria[l.actividad]) === 'Polinización').length,
    'Poda': laboresMes.filter(l => l.actividad === 'Poda').length,
    'Plateo': laboresMes.filter(l => l.actividad.startsWith('Plateo')).length,
    'Cosecha RFF': laboresMes.filter(l => (actividadCategoria[l.actividad]) === 'Cosecha').length,
    'Censo enf.': laboresMes.filter(l => (actividadCategoria[l.actividad]) === 'Censo').length,
    'Sanidad': laboresMes.filter(l => (actividadCategoria[l.actividad]) === 'Sanidad').length
  };
  const max = Math.max(...Object.values(conteos), 1);
  document.querySelectorAll('.labores-chart .labor-row').forEach(row => {
    const name = row.querySelector('.labor-name').textContent.trim();
    const count = conteos[name] ?? 0;
    row.querySelector('.labor-bar').style.width = (count / max * 100) + '%';
    row.querySelector('.labor-count').textContent = count;
  });

  // KPI labores del mes
  const kpiLabores = document.querySelector('.kpi-card.naranja .kpi-value');
  if (kpiLabores) kpiLabores.textContent = laboresMes.length;
  const kpiLaboresSub = document.querySelector('.kpi-card.naranja .kpi-sub');
  if (kpiLaboresSub) kpiLaboresSub.textContent = laboresMes.length ? 'Registradas este mes' : 'Sin registros aún';

  // KPI trabajadores
  const trabajadores = getMaestro('trabajadores');
  const kpiTrab = document.querySelector('.kpi-card.azul .kpi-value');
  if (kpiTrab) kpiTrab.textContent = trabajadores.length;
  const kpiTrabSub = document.querySelector('.kpi-card.azul .kpi-sub');
  if (kpiTrabSub) kpiTrabSub.textContent = trabajadores.length ? 'Registrados en maestros' : 'Por configurar';
}

// (la inicialización del demo se hace al final del script, cuando todas las variables existen)

// ── COSECHA (módulo) ────────────────────────────────────
function tablaLabores(lista, container, vacio) {
  if (!lista.length) {
    container.innerHTML = `<div style="padding:28px; text-align:center; color:var(--texto-dim)">
      <div style="font-size:36px; margin-bottom:10px">${vacio.icono}</div>
      <div style="font-size:14px; margin-bottom:4px">${vacio.titulo}</div>
      <div style="font-size:12px">${vacio.sub}</div>
    </div>`;
    return;
  }
  container.innerHTML = `<table class="lotes-table">
    <thead><tr><th>Fecha</th><th>Actividad</th><th>Ubicación</th><th>Cantidad</th><th>Trabajador</th><th>Costo</th><th>Estado</th><th>Obs.</th><th></th></tr></thead>
    <tbody>${lista.map(l => `
      <tr style="${(l.estado||'pendiente')==='rechazada' ? 'opacity:0.45' : ''}">
        <td>${new Date(l.fecha+'T12:00:00').toLocaleDateString('es-CO',{month:'short',day:'numeric'})}</td>
        <td style="color:var(--verde-claro); font-weight:500">${catIcono[actividadCategoria[l.actividad]]||'📌'} ${l.actividad}</td>
        <td style="font-family:monospace; font-size:12px">${fmtUbicacion(l)}</td>
        <td>${l.cantidad ? l.cantidad.toLocaleString('es-CO') : '—'}</td>
        <td>${l.trabajador || '—'}</td>
        <td>${l.costo ? fmtCOP(l.costo) : '—'}</td>
        <td style="white-space:nowrap">${badgeEstado(l)}</td>
        <td style="max-width:140px; font-size:12px">${l.obs || '—'}</td>
        <td><button class="btn-icon" onclick="eliminarLabor('${l.id}')" style="width:24px;height:24px;font-size:11px">🗑️</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}

function renderCosecha() {
  const mes = new Date().toISOString().slice(0,7);
  const cosechas = labores.filter(l => actividadCategoria[l.actividad] === 'Cosecha');
  const cosechasAprob = laboresAprobadas().filter(l => actividadCategoria[l.actividad] === 'Cosecha');
  const cosechasMes = cosechasAprob.filter(l => l.fecha && l.fecha.slice(0,7) === mes);
  const pesajesMes = pesajes.filter(p => p.fecha.slice(0,7) === mes);

  const racimos = cosechasMes.reduce((s,l) => s + (l.cantidad||0), 0);
  const kgNetos = pesajesMes.reduce((s,p) => s + (p.neto||0), 0);
  const racimosBascula = pesajesMes.reduce((s,p) => s + (p.racimos||0), 0);
  const costo = cosechasMes.reduce((s,l) => s + (l.costo||0), 0);

  document.getElementById('cos-racimos').textContent = racimos.toLocaleString('es-CO');
  document.getElementById('cos-ton').textContent = (kgNetos/1000).toLocaleString('es-CO',{maximumFractionDigits:1});
  document.getElementById('cos-peso-prom').textContent = racimosBascula ? Math.round(kgNetos/racimosBascula) : '—';
  document.getElementById('cos-costo').textContent = fmtCOP(costo);
  document.getElementById('cosecha-sub').textContent = cosechas.length
    ? `${cosechas.length} registros de cosecha` : 'Control de producción y trazabilidad';

  tablaLabores(cosechas, document.getElementById('cosecha-lista'), {
    icono: '🌴', titulo: 'Sin registros de cosecha',
    sub: 'Registra la cosecha por lote — se cruza con la báscula y el presupuesto'
  });
}

// ── SANIDAD (labores de censo/costos) ───────────────────
function renderSanidad() {
  const sanitarias = labores.filter(l => ['Censo','Sanidad'].includes(actividadCategoria[l.actividad]));
  tablaLabores(sanitarias, document.getElementById('sanidad-lista'), {
    icono: '🔬', titulo: 'Sin labores de censo registradas',
    sub: 'Registra los censos como labor para llevar su costo; las detecciones individuales van arriba'
  });
  if (typeof renderDetecciones === 'function') renderDetecciones();
}

// ── ATAJO A MAESTROS ────────────────────────────────────
function irMaestro(key, el) {
  showPage('maestros', el);
  cambiarMaestro(key);
}

// ── MÓDULOS DE ACTIVIDAD (motor genérico) ───────────────
// Cada módulo es solo configuración — el motor genera página, KPIs e historial
const modulosActividad = {
  polinizacion: {
    titulo: 'Polinización', icono: '🌸', categoria: 'Polinización',
    sub: 'Ciclos ANA por lote y línea',
    botones: [
      { label: '+ ANA 1', actividad: 'Polinización ANA 1', primario: false },
      { label: '+ ANA 2', actividad: 'Polinización ANA 2', primario: false },
      { label: '+ ANA 3', actividad: 'Polinización ANA 3', primario: true }
    ],
    kpis: (delMes) => [
      { label: 'ANA 1 (palmas)', valor: delMes.filter(l => l.actividad.includes('ANA 1')).reduce((s,l)=>s+(l.cantidad||0),0).toLocaleString('es-CO'), color: '' },
      { label: 'ANA 2 (palmas)', valor: delMes.filter(l => l.actividad.includes('ANA 2')).reduce((s,l)=>s+(l.cantidad||0),0).toLocaleString('es-CO'), color: 'var(--dorado-claro)' },
      { label: 'ANA 3 (palmas)', valor: delMes.filter(l => l.actividad.includes('ANA 3')).reduce((s,l)=>s+(l.cantidad||0),0).toLocaleString('es-CO'), color: '#74b3ce' },
      { label: 'Costo del mes', valor: null, esCosto: true, color: 'var(--naranja)' }
    ]
  },
  mantenimiento: {
    titulo: 'Mantenimiento', icono: '✂️', categoria: 'Mantenimiento',
    sub: 'Poda, plateo y labores culturales',
    botones: [
      { label: '+ Poda', actividad: 'Poda', primario: false },
      { label: '+ Plateo Químico', actividad: 'Plateo Químico', primario: false },
      { label: '+ Plateo Mecánico', actividad: 'Plateo Mecánico', primario: true }
    ],
    kpis: (delMes) => [
      { label: 'Palmas podadas (mes)', valor: delMes.filter(l => l.actividad==='Poda').reduce((s,l)=>s+(l.cantidad||0),0).toLocaleString('es-CO'), color: '' },
      { label: 'Palmas plateadas (mes)', valor: delMes.filter(l => l.actividad.startsWith('Plateo')).reduce((s,l)=>s+(l.cantidad||0),0).toLocaleString('es-CO'), color: 'var(--dorado-claro)' },
      { label: 'Jornadas registradas', valor: delMes.length, color: '#74b3ce' },
      { label: 'Costo del mes', valor: null, esCosto: true, color: 'var(--naranja)' }
    ]
  },
  fertilizacion: {
    titulo: 'Fertilización', icono: '🌱', categoria: 'Fertilización',
    sub: 'Aplicaciones de fertilizante por lote',
    botones: [
      { label: '+ Registrar aplicación', actividad: 'Fertilización', primario: true }
    ],
    kpis: (delMes) => [
      { label: 'Palmas fertilizadas (mes)', valor: delMes.reduce((s,l)=>s+(l.cantidad||0),0).toLocaleString('es-CO'), color: '' },
      { label: 'Aplicaciones', valor: delMes.length, color: 'var(--dorado-claro)' },
      { label: 'Lotes cubiertos', valor: [...new Set(delMes.map(l=>l.lote).filter(Boolean))].length, color: '#74b3ce' },
      { label: 'Costo del mes', valor: null, esCosto: true, color: 'var(--naranja)' }
    ]
  }
};

// Generar las páginas HTML de cada módulo de actividad
function generarPaginasActividad() {
  document.getElementById('paginas-actividad').innerHTML = Object.entries(modulosActividad).map(([key, m]) => `
    <div class="page" id="page-${key}">
      <div class="page-header">
        <div>
          <div class="page-heading">${m.icono} ${m.titulo}</div>
          <div class="page-sub" id="${key}-sub">${m.sub}</div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn-cancel" style="margin-top:0" onclick="abrirMasivaLabores('${key}')">📥 Masiva</button>
          <button class="btn-cancel" style="margin-top:0; border-color:var(--dorado); color:var(--dorado-claro)" onclick="abrirModoNFC('${key}')">📡 Modo NFC</button>
          <button class="btn-primary" style="margin-top:0" onclick="abrirModalLabor('${m.botones.find(b=>b.primario).actividad}')">＋ Manual</button>
        </div>
      </div>
      <div class="lotes-resumen" id="${key}-kpis"></div>
      <div class="panel-full">
        <div class="panel-header"><div class="panel-title">Historial de ${m.titulo.toLowerCase()}</div></div>
        <div class="panel-body" id="${key}-lista"></div>
      </div>
    </div>`).join('');
}

function renderModuloActividad(key) {
  const m = modulosActividad[key];
  const mes = new Date().toISOString().slice(0,7);
  const registros = labores.filter(l => actividadCategoria[l.actividad] === m.categoria);
  const aprobadasCat = laboresAprobadas().filter(l => actividadCategoria[l.actividad] === m.categoria);
  const delMes = aprobadasCat.filter(l => l.fecha && l.fecha.slice(0,7) === mes);
  const costoMes = delMes.reduce((s,l) => s + (l.costo||0), 0);

  // KPIs
  document.getElementById(key + '-kpis').innerHTML = m.kpis(delMes).map(k => `
    <div class="resumen-chip">
      <div class="resumen-val" ${k.color ? `style="color:${k.color}"` : ''}>${k.esCosto ? fmtCOP(costoMes) : k.valor}</div>
      <div class="resumen-label">${k.label}</div>
    </div>`).join('');

  document.getElementById(key + '-sub').textContent = registros.length
    ? `${registros.length} registros · ${m.sub}` : m.sub;

  // Historial (reutiliza la tabla compartida)
  tablaLabores(registros, document.getElementById(key + '-lista'), {
    icono: m.icono, titulo: `Sin registros de ${m.titulo.toLowerCase()}`,
    sub: 'Los registros aparecerán aquí y alimentarán el presupuesto automáticamente'
  });
}

function renderTodosModulosActividad() {
  Object.keys(modulosActividad).forEach(renderModuloActividad);
}

generarPaginasActividad();

// Config de actividades por módulo (para masiva y NFC) — incluye cosecha y sanidad
const actividadesPorModulo = {
  polinizacion: ['Polinización ANA 1', 'Polinización ANA 2', 'Polinización ANA 3'],
  mantenimiento: ['Poda', 'Plateo Químico', 'Plateo Mecánico'],
  fertilizacion: ['Fertilización'],
  cosecha: ['Cosecha'],
  sanidad: ['Censo Enfermedades', 'Censo Plagas', 'Sanidad']
};

// ── REGISTRO MASIVO DE LABORES ──────────────────────────
let masivaLaboresModulo = null;

function abrirMasivaLabores(moduloKey) {
  masivaLaboresModulo = moduloKey;
  const acts = actividadesPorModulo[moduloKey] || [];
  document.getElementById('masiva-lab-title').textContent = '📥 Carga masiva — ' + (modulosActividad[moduloKey]?.titulo || moduloKey);
  document.getElementById('masiva-lab-help').innerHTML =
    `Columnas: <span style="color:var(--verde-claro); font-family:monospace; font-size:12px">Actividad · Lote · Línea · Palma · Fecha (AAAA-MM-DD) · Cantidad · Trabajador · Costo</span><br>
    <span style="font-size:12px; color:var(--texto-dim)">Actividades válidas: ${acts.join(', ')}<br>
    💡 Línea y Palma aceptan rangos con guion (ej: 20-35). Si cantidad va vacía se calcula del rango; si costo va vacío se aplica la tarifa vigente</span>`;
  const hoy = new Date().toISOString().slice(0,10);
  document.getElementById('masiva-lab-data').value = '';
  document.getElementById('masiva-lab-data').placeholder = `${acts[0]}\t1\t24\t\t${hoy}\t350\tCarlos Andrés Ruiz\t\n${acts[0]}\t1\t25\t\t${hoy}\t280\tLuz Dary Martínez\t`;
  document.getElementById('masiva-lab-preview').style.display = 'none';
  document.getElementById('modal-masiva-lab').classList.add('open');
}

function cerrarMasivaLabores() { document.getElementById('modal-masiva-lab').classList.remove('open'); }

function parseMasivaLabores() {
  const raw = document.getElementById('masiva-lab-data').value.trim();
  if (!raw) return { regs: [], errores: ['Sin datos'] };
  const acts = actividadesPorModulo[masivaLaboresModulo] || [];
  const regs = [], errores = [];
  raw.split('\n').map(l => l.trim()).filter(Boolean).forEach((linea, i) => {
    const c = linea.includes('\t') ? linea.split('\t') : linea.split(';');
    const actividad = (c[0]||'').trim();
    if (i === 0 && actividad.toLowerCase() === 'actividad') return;
    if (!acts.includes(actividad)) { errores.push(`Línea ${i+1}: actividad "${actividad}" no válida para este módulo`); return; }
    const fecha = (c[4]||'').trim() || new Date().toISOString().slice(0,10);
    const lineaR = parseRango((c[2]||'').trim());
    const palmaR = parseRango((c[3]||'').trim());

    let cantidad = parseInt((c[5]||'').trim()) || 0;
    // Auto-calcular cantidad desde rangos si viene vacía
    if (!cantidad && (lineaR || palmaR)) {
      const nL = lineaR ? lineaR.hasta - lineaR.desde + 1 : 1;
      const nP = palmaR ? palmaR.hasta - palmaR.desde + 1 : 0;
      if (nP) cantidad = nL * nP;
    }

    let costo = parseFloat((c[7]||'').trim().replace(',','.')) || 0;
    if (!costo && cantidad) {
      const t = tarifaVigente(actividad, fecha);
      if (t && t.tipo === 'Por unidad (destajo)') costo = Math.round(cantidad * t.valor);
    }
    regs.push({
      id: Date.now().toString() + '_' + i,
      actividad,
      lote: (c[1]||'').trim(),
      lineaR, palmaR,
      linea: lineaR ? lineaR.desde : null,
      palma: palmaR ? palmaR.desde : null,
      fecha, cantidad,
      trabajador: (c[6]||'').trim(),
      costo, obs: '', estado: 'pendiente'
    });
  });
  return { regs, errores };
}

function previewMasivaLabores() {
  const { regs, errores } = parseMasivaLabores();
  const p = document.getElementById('masiva-lab-preview');
  p.style.display = 'block';
  const totalCant = regs.reduce((s,r) => s + r.cantidad, 0);
  const totalCosto = regs.reduce((s,r) => s + r.costo, 0);
  p.innerHTML = `✓ <strong>${regs.length} registros</strong> · ${totalCant.toLocaleString('es-CO')} unidades · ${fmtCOP(totalCosto)} (tarifas aplicadas)` +
    (errores.length ? `<br><span style="color:var(--naranja)">⚠ ${errores.join(' · ')}</span>` : '');
}

function cargarMasivaLabores() {
  const { regs, errores } = parseMasivaLabores();
  if (!regs.length) { alert(errores.length ? errores.join('\n') : 'Sin registros válidos'); return; }
  labores = regs.concat(labores);
  saveLabores();
  cerrarMasivaLabores();
  refrescarModulosLabores();
  alert(`✓ ${regs.length} labores cargadas`);
}

// ── MODO NFC ────────────────────────────────────────────
let nfcModulo = null;
let nfcActividad = null;
let nfcGPS = null;
let nfcContador = 0;

function abrirModoNFC(moduloKey) {
  nfcModulo = moduloKey;
  nfcContador = 0;
  const m = modulosActividad[moduloKey] || { titulo: moduloKey, icono: '📡' };
  const acts = actividadesPorModulo[moduloKey] || [];
  nfcActividad = acts[0];

  document.getElementById('nfc-title').textContent = `📡 Modo NFC — ${m.titulo}`;

  // Botones de actividad (simulan las tarjetas físicas)
  document.getElementById('nfc-actividades').innerHTML = acts.map((a, i) => `
    <button class="nfc-card-btn ${i===0?'active':''}" id="nfc-act-${i}" onclick="seleccionarActividadNFC('${a}', ${i})">
      ${catIcono[actividadCategoria[a]]||'📌'}<br><span style="font-size:12px">${a}</span>
    </button>`).join('');

  // Lote selector
  document.getElementById('nfc-lote').innerHTML = '<option value="">Lote...</option>' +
    lotes.map(l => `<option value="${l.numero}">Lote ${l.numero}</option>`).join('');

  // Trabajador selector
  const trabajadores = getMaestro('trabajadores');
  document.getElementById('nfc-trabajador').innerHTML = '<option value="">Trabajador...</option>' +
    trabajadores.map(t => `<option>${t.nombre}</option>`).join('');

  document.getElementById('nfc-log').innerHTML = '';
  document.getElementById('nfc-contador').textContent = '0';

  // GPS
  document.getElementById('nfc-gps-status').textContent = '📍 Obteniendo GPS...';
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      pos => {
        nfcGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById('nfc-gps-status').textContent = `📍 GPS activo: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      },
      () => { document.getElementById('nfc-gps-status').textContent = '📍 GPS no disponible (los registros irán sin coordenadas)'; },
      { enableHighAccuracy: true }
    );
  } else {
    document.getElementById('nfc-gps-status').textContent = '📍 GPS no soportado en este dispositivo';
  }

  // Lector NFC real (Android Chrome)
  const nfcHW = document.getElementById('nfc-hw-status');
  if ('NDEFReader' in window) {
    nfcHW.innerHTML = '✅ Lector NFC disponible — <button class="btn-primary" style="margin:0; padding:4px 12px; font-size:12px" onclick="activarLectorNFC()">Activar lector</button>';
  } else {
    nfcHW.textContent = 'ℹ️ NFC físico no disponible en este dispositivo (funciona en Android + Chrome). Usa el botón de registro simulado.';
  }

  document.getElementById('modal-nfc').classList.add('open');
}

function cerrarModoNFC() {
  document.getElementById('modal-nfc').classList.remove('open');
  refrescarModulosLabores();
}

function seleccionarActividadNFC(actividad, idx) {
  nfcActividad = actividad;
  document.querySelectorAll('.nfc-card-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
}

async function activarLectorNFC() {
  try {
    const reader = new NDEFReader();
    await reader.scan();
    document.getElementById('nfc-hw-status').textContent = '📡 Lector activo — acerca una tarjeta NFC';
    reader.onreading = (event) => {
      // Leer texto de la tarjeta: si coincide con una actividad, la selecciona; siempre registra
      let textoTarjeta = '';
      for (const record of event.message.records) {
        if (record.recordType === 'text') {
          textoTarjeta = new TextDecoder().decode(record.data);
        }
      }
      const acts = actividadesPorModulo[nfcModulo] || [];
      const idx = acts.findIndex(a => a.toLowerCase() === textoTarjeta.toLowerCase().trim());
      if (idx >= 0) seleccionarActividadNFC(acts[idx], idx);
      registrarNFC(textoTarjeta ? `Tarjeta: ${textoTarjeta}` : 'Tarjeta NFC');
    };
  } catch (err) {
    document.getElementById('nfc-hw-status').textContent = '⚠ No se pudo activar el lector: ' + err.message;
  }
}

function registrarNFC(origen = 'Registro simulado') {
  if (!nfcActividad) { alert('Selecciona una actividad'); return; }
  const trabajador = document.getElementById('nfc-trabajador').value;
  const lote = document.getElementById('nfc-lote').value;
  const linea = parseInt(document.getElementById('nfc-linea').value) || null;
  const fecha = new Date().toISOString().slice(0,10);

  const t = tarifaVigente(nfcActividad, fecha);
  const costo = (t && t.tipo === 'Por unidad (destajo)') ? t.valor : 0;

  labores.unshift({
    id: Date.now().toString(),
    actividad: nfcActividad,
    lote, linea, palma: null,
    fecha, cantidad: 1,
    trabajador, costo,
    obs: '', estado: 'pendiente',
    gps: nfcGPS ? { ...nfcGPS } : null
  });
  saveLabores();

  nfcContador++;
  document.getElementById('nfc-contador').textContent = nfcContador;

  const hora = new Date().toLocaleTimeString('es-CO', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  const coords = nfcGPS ? `📍 ${nfcGPS.lat.toFixed(5)}, ${nfcGPS.lng.toFixed(5)}` : '';
  const log = document.getElementById('nfc-log');
  log.innerHTML = `<div style="padding:8px 12px; background:rgba(82,183,136,0.08); border:1px solid rgba(82,183,136,0.25); border-radius:8px; margin-bottom:6px; font-size:12.5px">
    ✓ <strong>${nfcActividad}</strong> · ${lote ? 'L'+lote : 'sin lote'}${linea ? ' Ln'+linea : ''} · ${hora}
    ${costo ? ' · '+fmtCOP(costo) : ''}
    ${coords ? `<br><span style="color:var(--texto-dim); font-size:11px; font-family:monospace">${coords}</span>` : ''}
  </div>` + log.innerHTML;

  // Auto-incrementar línea si está en modo secuencial
  if (document.getElementById('nfc-auto-linea').checked && linea) {
    document.getElementById('nfc-linea').value = linea + 1;
  }
}

['modal-masiva-lab', 'modal-nfc'].forEach(id =>
  document.getElementById(id).addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); }));

// ── DETECCIONES FITOSANITARIAS ──────────────────────────
let detecciones = JSON.parse(localStorage.getItem('agroweb_detecciones') || '[]');
const saveDet = () => localStorage.setItem('agroweb_detecciones', JSON.stringify(detecciones));

const estadoDet = {
  activo:      { label: '🔴 Activo',         clase: 'badge-rojo' },
  tratamiento: { label: '🟡 En tratamiento', clase: 'badge-dorado' },
  recuperada:  { label: '🟢 Recuperada',      clase: 'badge-verde' },
  erradicada:  { label: '⚫ Erradicada',      clase: 'badge' }
};

function abrirModalDeteccion(id = null) {
  const enfs = getMaestro('enfermedades');
  document.getElementById('det-enfermedad').innerHTML = enfs.length
    ? enfs.map(e => `<option value="${e.nombre}">${e.tipo==='Plaga'?'🐛':'🦠'} ${e.nombre}</option>`).join('')
    : '<option value="">⚠ Registra enfermedades en Configuración</option>';
  document.getElementById('det-lote').innerHTML = '<option value="">Lote...</option>' +
    lotes.map(l => `<option value="${l.numero}">Lote ${l.numero}${l.nombre?' · '+l.nombre:''}</option>`).join('');
  document.getElementById('det-por').innerHTML = '<option value="">Seleccionar...</option>' +
    getMaestro('trabajadores').map(t => `<option>${t.nombre}</option>`).join('');
  document.getElementById('det-fecha').value = new Date().toISOString().slice(0,10);
  const seg = document.getElementById('det-seguimiento-section');
  const btnSave = document.getElementById('det-btn-save');
  if (id) {
    const d = detecciones.find(x => x.id === id);
    if (!d) return;
    document.getElementById('modal-det-title').textContent = '🦠 Seguimiento — ' + d.enfermedad;
    document.getElementById('det-edit-id').value = id;
    document.getElementById('det-enfermedad').value = d.enfermedad;
    document.getElementById('det-severidad').value = d.severidad;
    document.getElementById('det-lote').value = d.lote;
    document.getElementById('det-linea').value = d.linea || '';
    document.getElementById('det-palma').value = d.palma || '';
    document.getElementById('det-fecha').value = d.fechaDeteccion;
    document.getElementById('det-por').value = d.detectadaPor || '';
    document.getElementById('det-obs').value = d.obs || '';
    document.getElementById('det-nuevo-estado').value = d.estado;
    document.getElementById('det-seg-fecha').value = new Date().toISOString().slice(0,10);
    document.getElementById('det-seg-nota').value = '';
    if (seg) seg.style.display = 'block';
    if (btnSave) btnSave.textContent = 'Guardar seguimiento';
    const hist = d.historial || [];
    const hr = document.getElementById('det-historial-render');
    if (hr) hr.innerHTML = hist.length
      ? '<div style="font-size:11px;font-weight:600;color:var(--texto-dim);text-transform:uppercase;margin-bottom:6px">Historial (' + hist.length + ' eventos)</div>' +
        hist.slice().reverse().map(h =>
          `<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px">
            <span style="font-family:monospace;font-size:11px;color:var(--texto-dim);white-space:nowrap;min-width:80px">${h.fecha}</span>
            <span class="badge ${estadoDet[h.estado]?.clase||'badge'}" style="font-size:10px">${estadoDet[h.estado]?.label||h.estado}</span>
            <span style="font-size:12.5px;color:var(--texto-suave)">${h.nota}</span>
          </div>`).join('') : '';
  } else {
    document.getElementById('modal-det-title').textContent = '🦠 Nueva detección fitosanitaria';
    document.getElementById('det-edit-id').value = '';
    ['det-linea','det-palma','det-obs'].forEach(i => document.getElementById(i).value = '');
    if (seg) seg.style.display = 'none';
    if (btnSave) btnSave.textContent = 'Registrar detección';
  }
  document.getElementById('modal-deteccion').classList.add('open');
}

function cerrarModalDeteccion() { document.getElementById('modal-deteccion').classList.remove('open'); }

function guardarDeteccion() {
  const enfermedad = document.getElementById('det-enfermedad').value;
  const lote = document.getElementById('det-lote').value;
  const linea = parseInt(document.getElementById('det-linea').value);
  const palma = parseInt(document.getElementById('det-palma').value);
  if (!enfermedad) { alert('Selecciona la enfermedad o plaga'); return; }
  if (!lote || !linea || !palma) { alert('Ingresa Lote, Línea y Palma — cada detección debe tener ubicación exacta'); return; }
  const editId = document.getElementById('det-edit-id').value;
  if (editId) {
    const d = detecciones.find(x => x.id === editId);
    if (!d) return;
    const nuevoEstado = document.getElementById('det-nuevo-estado').value;
    const nota = document.getElementById('det-seg-nota').value.trim() || 'Seguimiento sin nota';
    const fecha = document.getElementById('det-seg-fecha').value;
    d.estado = nuevoEstado;
    d.severidad = document.getElementById('det-severidad').value;
    d.obs = document.getElementById('det-obs').value.trim();
    d.historial = d.historial || [];
    d.historial.push({ fecha, estado: nuevoEstado, nota });
  } else {
    detecciones.unshift({
      id: Date.now().toString(), enfermedad, lote, linea, palma,
      fechaDeteccion: document.getElementById('det-fecha').value,
      severidad: document.getElementById('det-severidad').value,
      detectadaPor: document.getElementById('det-por').value,
      obs: document.getElementById('det-obs').value.trim(),
      estado: 'activo',
      historial: [{ fecha: document.getElementById('det-fecha').value, estado: 'activo', nota: 'Detección inicial' }]
    });
  }
  saveDet(); cerrarModalDeteccion(); renderDetecciones();
}

function cambiarEstadoDeteccion(id, nuevoEstado) {
  const det = detecciones.find(d => d.id === id);
  if (!det) return;
  det.estado = nuevoEstado;
  det.historial = det.historial || [];
  det.historial.push({ fecha: new Date().toISOString().slice(0,10), estado: nuevoEstado, nota: 'Actualización rápida de estado' });
  saveDet(); renderDetecciones();
}

function eliminarDeteccion(id) {
  if (!confirm('¿Eliminar este caso?')) return;
  detecciones = detecciones.filter(d => d.id !== id);
  saveDet(); renderDetecciones();
}

function cargarMasivaDetecciones() {
  const raw = document.getElementById('masiva-det-data').value.trim();
  if (!raw) { alert('Sin datos'); return; }
  let n = 0;
  raw.split('\n').map(l=>l.trim()).filter(Boolean).forEach((linea, i) => {
    const c = linea.includes('\t') ? linea.split('\t') : linea.split(';');
    const primera = (c[0]||'').trim();
    if (i === 0 && primera.toLowerCase() === 'enfermedad') return;
    if (!primera || !c[1] || !c[2] || !c[3]) return;
    const fecha = (c[4]||'').trim() || new Date().toISOString().slice(0,10);
    detecciones.unshift({
      id: Date.now().toString() + '_' + n,
      enfermedad: primera, lote: c[1].trim(),
      linea: parseInt(c[2])||null, palma: parseInt(c[3])||null,
      fechaDeteccion: fecha, severidad: (c[5]||'Moderada').trim(),
      detectadaPor: (c[6]||'').trim(), obs: (c[7]||'').trim(),
      estado: 'activo',
      historial: [{ fecha, estado: 'activo', nota: 'Carga masiva' }]
    });
    n++;
  });
  saveDet();
  document.getElementById('modal-masiva-det').classList.remove('open');
  document.getElementById('masiva-det-data').value = '';
  renderDetecciones();
  alert('✓ ' + n + ' detecciones cargadas');
}

function abrirMasivaDetecciones() { document.getElementById('modal-masiva-det').classList.add('open'); }

function renderDetecciones() {
  const enfsUnicas = [...new Set(detecciones.map(d => d.enfermedad))];
  const filtroSel = document.getElementById('det-filtro');
  const filtroActual = filtroSel ? filtroSel.value : '';
  if (filtroSel) filtroSel.innerHTML = '<option value="">Todas las enfermedades</option>' +
    enfsUnicas.map(e => `<option ${e===filtroActual?'selected':''}>${e}</option>`).join('');
  const lista = filtroActual ? detecciones.filter(d => d.enfermedad === filtroActual) : detecciones;
  document.getElementById('det-activas').textContent = detecciones.filter(d=>d.estado==='activo').length;
  document.getElementById('det-tratamiento').textContent = detecciones.filter(d=>d.estado==='tratamiento').length;
  document.getElementById('det-recuperadas').textContent = detecciones.filter(d=>d.estado==='recuperada').length;
  document.getElementById('det-erradicadas').textContent = detecciones.filter(d=>d.estado==='erradicada').length;
  document.getElementById('sanidad-sub').textContent = detecciones.length
    ? detecciones.length + ' palmas en seguimiento fitosanitario'
    : 'Cada caso fitosanitario con su palma, severidad y ciclo de tratamiento';
  const cont = document.getElementById('detecciones-lista');
  if (!lista.length) {
    cont.innerHTML = '<div style="padding:28px;text-align:center;color:var(--texto-dim)"><div style="font-size:36px;margin-bottom:10px">🦠</div><div style="font-size:14px;margin-bottom:4px">Sin detecciones registradas</div><div style="font-size:12px">Registra cada palma enferma con ubicación exacta: Lote, Línea y Palma — y hazle seguimiento hasta recuperación o erradicación</div></div>';
    return;
  }
  const sevColor = { 'Leve':'var(--verde-claro)', 'Moderada':'var(--dorado-claro)', 'Severa':'var(--rojo)' };
  cont.innerHTML = '<table class="lotes-table"><thead><tr><th>Detección</th><th>Enfermedad</th><th>Palma exacta</th><th>Severidad</th><th>Detectada por</th><th>Seguimientos</th><th>Estado</th><th>Acciones</th><th></th></tr></thead><tbody>' +
    lista.map(d => {
      const enf = getMaestro('enfermedades').find(e => e.nombre === d.enfermedad);
      const icono = enf && enf.tipo==='Plaga' ? '🐛' : '🦠';
      const nSeg = (d.historial||[]).length - 1;
      return '<tr style="' + (d.estado==='erradicada'||d.estado==='recuperada'?'opacity:0.6':'') + '">' +
        '<td>' + new Date(d.fechaDeteccion+'T12:00:00').toLocaleDateString('es-CO',{month:'short',day:'numeric'}) + '</td>' +
        '<td style="color:var(--verde-claro);font-weight:500">' + icono + ' ' + d.enfermedad + '</td>' +
        '<td style="font-family:monospace;font-size:12px;color:var(--dorado-claro)">L' + d.lote + ' · Ln' + d.linea + ' · P' + d.palma + '</td>' +
        '<td><span style="color:' + (sevColor[d.severidad]||'var(--texto-suave)') + ';font-weight:600">' + d.severidad + '</span></td>' +
        '<td>' + (d.detectadaPor||'—') + '</td>' +
        '<td><span style="color:var(--texto-dim);font-size:12px">' + (nSeg>0?nSeg+' nota'+(nSeg>1?'s':''):'—') + '</span></td>' +
        '<td><span class="badge ' + (estadoDet[d.estado]?.clase||'badge') + '">' + (estadoDet[d.estado]?.label||d.estado) + '</span></td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-icon edit" onclick="abrirModalDeteccion(\''+d.id+'\')" title="Ver / seguimiento" style="width:26px;height:26px;font-size:12px">📋</button>' +
          (d.estado==='activo'?'<button class="btn-icon" onclick="cambiarEstadoDeteccion(\''+d.id+'\',\'tratamiento\')" title="Iniciar tratamiento" style="width:26px;height:26px;font-size:12px;border-color:var(--dorado)">🟡</button>':'') +
          (['activo','tratamiento'].includes(d.estado)?
            '<button class="btn-icon" onclick="cambiarEstadoDeteccion(\''+d.id+'\',\'recuperada\')" title="Recuperada" style="width:26px;height:26px;font-size:12px;border-color:var(--verde-claro)">🟢</button>' +
            '<button class="btn-icon" onclick="cambiarEstadoDeteccion(\''+d.id+'\',\'erradicada\')" title="Erradicada" style="width:26px;height:26px;font-size:12px">⚫</button>':'') +
        '</td>' +
        '<td><button class="btn-icon" onclick="eliminarDeteccion(\''+d.id+'\')" style="width:24px;height:24px;font-size:11px">🗑️</button></td>' +
      '</tr>';
    }).join('') + '</tbody></table>';
}

document.getElementById('modal-deteccion').addEventListener('click', function(e){ if(e.target===this) cerrarModalDeteccion(); });
document.getElementById('modal-masiva-det').addEventListener('click', function(e){ if(e.target===this) this.classList.remove('open'); });

// ── CENSO DE PRODUCCIÓN ─────────────────────────────────
let censosProduccion = JSON.parse(localStorage.getItem('agroweb_censos_prod') || '[]');
const saveCensos = () => localStorage.setItem('agroweb_censos_prod', JSON.stringify(censosProduccion));

function abrirModalCenso() {
  document.getElementById('cen-lote').innerHTML = '<option value="">Lote...</option>' +
    lotes.map(l => `<option value="${l.numero}">Lote ${l.numero}${l.nombre?' · '+l.nombre:''}</option>`).join('');
  document.getElementById('cen-por').innerHTML = '<option value="">Seleccionar...</option>' +
    getMaestro('trabajadores').map(t => `<option>${t.nombre}</option>`).join('');
  document.getElementById('cen-fecha').value = new Date().toISOString().slice(0,10);
  ['cen-linea','cen-verdes-inp','cen-pintones-inp','cen-maduros-inp','cen-obs'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('modal-censo').classList.add('open');
}

function cerrarModalCenso() { document.getElementById('modal-censo').classList.remove('open'); }

function guardarCenso() {
  const lote = document.getElementById('cen-lote').value;
  if (!lote) { alert('Selecciona el lote'); return; }
  const lineaR = parseRango(document.getElementById('cen-linea').value);
  censosProduccion.unshift({
    id: Date.now().toString(),
    lote, lineaR,
    fecha: document.getElementById('cen-fecha').value,
    verdes: parseInt(document.getElementById('cen-verdes-inp').value) || 0,
    pintones: parseInt(document.getElementById('cen-pintones-inp').value) || 0,
    maduros: parseInt(document.getElementById('cen-maduros-inp').value) || 0,
    censadoPor: document.getElementById('cen-por').value,
    obs: document.getElementById('cen-obs').value.trim()
  });
  saveCensos();
  cerrarModalCenso();
  renderCensoProduccion();
}

function eliminarCenso(id) {
  if (!confirm('¿Eliminar este censo?')) return;
  censosProduccion = censosProduccion.filter(c => c.id !== id);
  saveCensos();
  renderCensoProduccion();
}

function abrirMasivaCenso() { document.getElementById('modal-masiva-censo').classList.add('open'); }

function cargarMasivaCenso() {
  const raw = document.getElementById('masiva-censo-data').value.trim();
  if (!raw) { alert('Sin datos'); return; }
  let n = 0;
  raw.split('\n').map(l=>l.trim()).filter(Boolean).forEach((linea, i) => {
    const c = linea.includes('\t') ? linea.split('\t') : linea.split(';');
    const lote = (c[0]||'').trim();
    if (i === 0 && lote.toLowerCase() === 'lote') return;
    if (!lote) return;
    censosProduccion.unshift({
      id: Date.now().toString() + '_' + n,
      lote, lineaR: parseRango((c[1]||'').trim()),
      fecha: (c[2]||'').trim() || new Date().toISOString().slice(0,10),
      verdes: parseInt(c[3]) || 0,
      pintones: parseInt(c[4]) || 0,
      maduros: parseInt(c[5]) || 0,
      censadoPor: (c[6]||'').trim(),
      obs: (c[7]||'').trim()
    });
    n++;
  });
  saveCensos();
  document.getElementById('modal-masiva-censo').classList.remove('open');
  document.getElementById('masiva-censo-data').value = '';
  renderCensoProduccion();
  alert('✓ ' + n + ' censos cargados');
}

function renderCensoProduccion() {
  // Solo el censo más reciente por lote+rango cuenta para la proyección (foto actual)
  // Simplificación: sumamos los censos de los últimos 45 días
  const hace45 = new Date(Date.now() - 45*86400000).toISOString().slice(0,10);
  const vigentes = censosProduccion.filter(c => c.fecha >= hace45);

  const tVerdes = vigentes.reduce((s,c) => s + c.verdes, 0);
  const tPintones = vigentes.reduce((s,c) => s + c.pintones, 0);
  const tMaduros = vigentes.reduce((s,c) => s + c.maduros, 0);
  // Proyección en toneladas: peso promedio racimo ~16kg (ajustable)
  const pesoProm = 16;
  const tonProy = ((tMaduros + tPintones) * pesoProm / 1000);

  document.getElementById('cen-maduros').textContent = tMaduros.toLocaleString('es-CO');
  document.getElementById('cen-pintones').textContent = tPintones.toLocaleString('es-CO');
  document.getElementById('cen-verdes').textContent = tVerdes.toLocaleString('es-CO');
  document.getElementById('cen-ton-proy').textContent = tonProy.toLocaleString('es-CO', {maximumFractionDigits:1});

  const cont = document.getElementById('censo-lista');
  if (!censosProduccion.length) {
    cont.innerHTML = '<div style="padding:20px; text-align:center; color:var(--texto-dim); font-size:12.5px">Sin censos de producción — cuenta los racimos por madurez en cada lote para proyectar la cosecha de las próximas semanas</div>';
    return;
  }

  cont.innerHTML = '<table class="lotes-table"><thead><tr><th>Fecha</th><th>Ubicación</th><th>🟢 Verdes</th><th>🟠 Pintones</th><th>🟡 Maduros</th><th>Censado por</th><th>Obs.</th><th></th></tr></thead><tbody>' +
    censosProduccion.map(c =>
      '<tr>' +
      '<td>' + new Date(c.fecha+'T12:00:00').toLocaleDateString('es-CO',{month:'short',day:'numeric'}) + '</td>' +
      '<td style="font-family:monospace; font-size:12px">L' + c.lote + (c.lineaR ? ' · Ln' + fmtRango(c.lineaR) : '') + '</td>' +
      '<td>' + c.verdes.toLocaleString('es-CO') + '</td>' +
      '<td style="color:var(--naranja)">' + c.pintones.toLocaleString('es-CO') + '</td>' +
      '<td style="color:var(--dorado-claro); font-weight:600">' + c.maduros.toLocaleString('es-CO') + '</td>' +
      '<td>' + (c.censadoPor||'—') + '</td>' +
      '<td style="font-size:12px">' + (c.obs||'—') + '</td>' +
      '<td><button class="btn-icon" onclick="eliminarCenso(\'' + c.id + '\')" style="width:24px;height:24px;font-size:11px">🗑️</button></td>' +
      '</tr>').join('') + '</tbody></table>';
}

['modal-censo','modal-masiva-censo'].forEach(id =>
  document.getElementById(id).addEventListener('click', function(e){ if(e.target===this) this.classList.remove('open'); }));

// ── USUARIOS Y PERMISOS ─────────────────────────────────
// (permisosPorRol y sesion declarados al inicio del script)

function sesionPuedeVer(pagina) {
  if (!sesion) return true; // sin sesión activa aún, permitir (login gestiona el acceso)
  const p = permisosPorRol[sesion.rol];
  if (!p) return false;
  return p.paginas === '*' || p.paginas.includes(pagina);
}

function sesionPuedeAprobar() {
  return !sesion || (permisosPorRol[sesion.rol]?.aprobar === true);
}

function mostrarLogin() {
  const usuarios = getMaestro('usuarios').filter(u => u.activo !== 'Inactivo');
  document.getElementById('login-usuario').innerHTML = usuarios.length
    ? usuarios.map(u => `<option value="${u.nombre}">${u.nombre} · ${u.rol}</option>`).join('')
    : '<option value="">Sin usuarios — se ingresará como Administrador</option>';
  document.getElementById('login-pin').value = '';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-overlay').style.display = 'flex';
}

function ingresar() {
  const usuarios = getMaestro('usuarios');
  if (!usuarios.length) {
    // Primera vez sin usuarios: entrar como admin
    sesion = { nombre: 'Administrador', rol: 'Administrador' };
    localStorage.setItem('agroweb_sesion', JSON.stringify(sesion));
    document.getElementById('login-overlay').style.display = 'none';
    aplicarPermisos();
    return;
  }
  const nombre = document.getElementById('login-usuario').value;
  const pin = document.getElementById('login-pin').value.trim();
  const u = usuarios.find(x => x.nombre === nombre && String(x.pin) === pin && x.activo !== 'Inactivo');
  if (!u) {
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('login-pin').value = '';
    return;
  }
  sesion = { nombre: u.nombre, rol: u.rol, trabajador: u.trabajador || '' };
  localStorage.setItem('agroweb_sesion', JSON.stringify(sesion));
  document.getElementById('login-overlay').style.display = 'none';
  aplicarPermisos();
}

function cerrarSesion() {
  sesion = null;
  localStorage.removeItem('agroweb_sesion');
  mostrarLogin();
}

function aplicarPermisos() {
  if (!sesion) return;
  const p = permisosPorRol[sesion.rol] || { paginas: [] };

  // Ocultar/mostrar items del nav según permisos
  document.querySelectorAll('.nav-item').forEach(item => {
    const oc = item.getAttribute('onclick') || '';
    let pagina = null;
    const mShow = oc.match(/showPage\('([^']+)'/);
    const mMaestro = oc.match(/irMaestro\(/);
    if (mShow) pagina = mShow[1];
    else if (mMaestro) pagina = 'maestros';
    if (!pagina) return;
    const visible = p.paginas === '*' || p.paginas.includes(pagina);
    item.style.display = visible ? '' : 'none';
  });

  // Ocultar secciones del nav que quedaron vacías
  document.querySelectorAll('.nav-section').forEach(sec => {
    let el = sec.nextElementSibling;
    let alguno = false;
    while (el && !el.classList.contains('nav-section')) {
      if (el.classList.contains('nav-item') && el.style.display !== 'none') { alguno = true; break; }
      el = el.nextElementSibling;
    }
    sec.style.display = alguno ? '' : 'none';
  });

  // Actualizar pill de usuario en sidebar
  const avatar = document.querySelector('.user-avatar');
  const uname = document.querySelector('.user-name');
  const urole = document.querySelector('.user-role');
  if (avatar) avatar.textContent = sesion.nombre.charAt(0).toUpperCase();
  if (uname) uname.textContent = sesion.nombre.split(' ')[0];
  if (urole) urole.innerHTML = sesion.rol + ' · <span style="color:var(--verde-claro); cursor:pointer; text-decoration:underline" onclick="cerrarSesion()">Salir</span>';

  // Si la página activa no está permitida, ir a la primera permitida
  const activa = document.querySelector('.page.active');
  const idActiva = (activa && activa.id) ? activa.id.replace('page-','') : 'dashboard';
  if (!(p.paginas === '*' || p.paginas.includes(idActiva))) {
    const primera = p.paginas === '*' ? 'dashboard' : p.paginas[0];
    const navItem = [...document.querySelectorAll('.nav-item')].find(i => (i.getAttribute('onclick')||'').includes(`'${primera}'`));
    showPage(primera, navItem || null);
  }
}

// ── SIDEBAR TOGGLE ──────────────────────────────────────
const esMovil = () => window.innerWidth <= 900;

function toggleSidebar() {
  if (esMovil()) {
    // En móvil: abrir/cerrar off-canvas
    document.body.classList.toggle('sidebar-open');
    document.getElementById('btn-toggle').textContent = document.body.classList.contains('sidebar-open') ? '✕' : '☰';
  } else {
    // En escritorio: colapsar/expandir
    document.body.classList.toggle('sidebar-collapsed');
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    document.getElementById('btn-toggle').textContent = collapsed ? '▶' : '◀';
    localStorage.setItem('agroweb_sidebar', collapsed ? '1' : '0');
  }
}

// Cerrar menú móvil al navegar
document.querySelector('.nav').addEventListener('click', function(e) {
  if (esMovil() && e.target.closest('.nav-item')) {
    document.body.classList.remove('sidebar-open');
    document.getElementById('btn-toggle').textContent = '☰';
  }
});

// Ajustar ícono del toggle según el tamaño de pantalla
function ajustarToggle() {
  const btn = document.getElementById('btn-toggle');
  if (esMovil()) {
    btn.textContent = document.body.classList.contains('sidebar-open') ? '✕' : '☰';
  } else {
    document.body.classList.remove('sidebar-open');
    btn.textContent = document.body.classList.contains('sidebar-collapsed') ? '▶' : '◀';
  }
}
window.addEventListener('resize', ajustarToggle);

// Restaurar estado del sidebar (solo escritorio)
if (localStorage.getItem('agroweb_sidebar') === '1' && !esMovil()) {
  document.body.classList.add('sidebar-collapsed');
}
ajustarToggle();

// ── PLANTILLA ───────────────────────────────────────────
const plantillaEjemplo = `Numero\tNombre\tHectareas\tPalmas\tVariedad\tEstado\tFecha_siembra\tDensidad
1\tLote Norte\t120.5\t15424\tTenera OxG\testablecimiento\t2025-03-15\t128
2\tLote Sur\t95\t11495\tHibrido OxG Corpoica\tpreparacion\t2025-06-01\t121
3\tLote Oriental\t200\t25600\tMixta\tpreparacion\t\t128
4\tLote Occidental\t150\t\tPor definir\tpreparacion\t\t
5\tLote Central\t180.5\t23104\tHibrido OxG ASD\testablecimiento\t2025-04-20\t128`;

function verPlantilla() {
  const box = document.getElementById('plantilla-box');
  const content = document.getElementById('plantilla-content');
  if (box.style.display === 'none') {
    content.value = plantillaEjemplo;
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

function copiarContenidoPlantilla() {
  const content = document.getElementById('plantilla-content');
  content.select();
  try {
    navigator.clipboard.writeText(content.value).then(() => mostrarCopiado());
  } catch (e) {
    document.execCommand('copy');
    mostrarCopiado();
  }
}

function mostrarCopiado() {
  const el = document.getElementById('plantilla-copiado');
  el.style.display = 'inline';
  setTimeout(() => el.style.display = 'none', 2500);
}

function copiarPlantilla() {
  // Sin fila de encabezado para pegar directo en el textarea
  const sinHeader = plantillaEjemplo.split('\n').slice(1).join('\n');
  navigator.clipboard.writeText(sinHeader).then(() => {
    document.getElementById('masiva-data').value = sinHeader;
    document.getElementById('masiva-preview').style.display = 'block';
    document.getElementById('masiva-preview').innerHTML = '📋 Plantilla de ejemplo cargada en el campo — edítala con tus datos reales y previsualiza';
  }).catch(() => {
    document.getElementById('masiva-data').value = sinHeader;
  });
}

// ── CARGA MASIVA ────────────────────────────────────────
function abrirModalMasiva() {
  document.getElementById('modal-masiva').classList.add('open');
  document.getElementById('masiva-preview').style.display = 'none';
}

function cerrarModalMasiva() {
  document.getElementById('modal-masiva').classList.remove('open');
}

function parseMasiva() {
  const raw = document.getElementById('masiva-data').value.trim();
  if (!raw) return { lotes: [], errores: ['No hay datos para procesar'] };

  const lineas = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const parsed = [];
  const errores = [];
  const estadosValidos = ['preparacion', 'establecimiento', 'produccion'];

  lineas.forEach((linea, i) => {
    // Separador: tab o punto y coma
    const cols = linea.includes('\t') ? linea.split('\t') : linea.split(';');
    const primeraCol = (cols[0]||'').trim().toLowerCase();
    // Ignorar fila de encabezado
    if (i === 0 && (primeraCol === 'numero' || primeraCol === 'número' || primeraCol === 'lote' || primeraCol === '#')) return;
    const numero = parseInt(primeraCol);
    if (!numero) {
      errores.push(`Línea ${i+1}: número de lote inválido`);
      return;
    }

    let estado = (cols[5]||'').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita tildes
    if (estado.startsWith('prod')) estado = 'produccion';
    else if (estado.startsWith('estab')) estado = 'establecimiento';
    else if (estado.startsWith('prep')) estado = 'preparacion';
    if (!estadosValidos.includes(estado)) estado = 'preparacion';

    const has = parseFloat((cols[2]||'').trim().replace(',', '.')) || 0;
    const densidad = parseInt((cols[7]||'').trim()) || 0;
    let palmas = parseInt((cols[3]||'').trim()) || 0;
    if (!palmas && has && densidad) palmas = Math.round(has * densidad);

    parsed.push({
      id: Date.now().toString() + '_' + i,
      numero,
      nombre: (cols[1]||'').trim(),
      has,
      palmas,
      variedad: (cols[4]||'').trim(),
      estado,
      fecha: (cols[6]||'').trim(),
      densidad,
      obs: '',
      creadoEn: new Date().toISOString()
    });
  });

  return { lotes: parsed, errores };
}

function previewMasiva() {
  const { lotes: parsed, errores } = parseMasiva();
  const preview = document.getElementById('masiva-preview');
  preview.style.display = 'block';

  const totalHas = parsed.reduce((s,l) => s + l.has, 0);
  const totalPalmas = parsed.reduce((s,l) => s + l.palmas, 0);
  const duplicados = parsed.filter(p => lotes.some(l => l.numero === p.numero)).map(p => p.numero);

  let html = `✓ <strong>${parsed.length} lotes</strong> listos para cargar · ${totalHas.toLocaleString('es-CO',{maximumFractionDigits:1})} ha · ${totalPalmas.toLocaleString('es-CO')} palmas`;
  if (duplicados.length) {
    html += `<br>⚠️ Lotes ${duplicados.join(', ')} ya existen — ${document.getElementById('masiva-reemplazar').checked ? 'serán reemplazados' : 'serán omitidos (marca la casilla para reemplazar)'}`;
  }
  if (errores.length) {
    html += `<br><span style="color:var(--naranja)">⚠ ${errores.join(' · ')}</span>`;
  }
  preview.innerHTML = html;
}

function cargarMasiva() {
  const { lotes: parsed, errores } = parseMasiva();
  if (!parsed.length) {
    alert(errores.length ? errores.join('\n') : 'No hay lotes válidos para cargar');
    return;
  }

  const reemplazar = document.getElementById('masiva-reemplazar').checked;
  let agregados = 0, reemplazados = 0, omitidos = 0;

  parsed.forEach(p => {
    const idx = lotes.findIndex(l => l.numero === p.numero);
    if (idx >= 0) {
      if (reemplazar) {
        p.id = lotes[idx].id;
        lotes[idx] = p;
        reemplazados++;
      } else {
        omitidos++;
      }
    } else {
      lotes.push(p);
      agregados++;
    }
  });

  lotes.sort((a,b) => a.numero - b.numero);
  saveLotes();
  renderLotes();
  actualizarDashboard();
  cerrarModalMasiva();
  document.getElementById('masiva-data').value = '';

  let msg = `✓ ${agregados} lotes agregados`;
  if (reemplazados) msg += ` · ${reemplazados} reemplazados`;
  if (omitidos) msg += ` · ${omitidos} omitidos (ya existían)`;
  alert(msg);
}

document.getElementById('modal-masiva').addEventListener('click', function(e) {
  if (e.target === this) cerrarModalMasiva();
});

// ── LOTES ──────────────────────────────────────────────
let lotes = JSON.parse(localStorage.getItem('agroweb_lotes') || '[]');

function saveLotes() {
  localStorage.setItem('agroweb_lotes', JSON.stringify(lotes));
}

function abrirModalLote(id = null) {
  document.getElementById('modal-lote').classList.add('open');
  if (id !== null) {
    const l = lotes.find(x => x.id === id);
    if (!l) return;
    document.getElementById('modal-lote-title').textContent = 'Editar lote';
    document.getElementById('lote-edit-id').value = id;
    document.getElementById('lote-numero').value = l.numero;
    document.getElementById('lote-nombre').value = l.nombre || '';
    document.getElementById('lote-has').value = l.has || '';
    document.getElementById('lote-palmas').value = l.palmas || '';
    document.getElementById('lote-variedad').value = l.variedad || '';
    document.getElementById('lote-estado').value = l.estado || 'preparacion';
    document.getElementById('lote-fecha').value = l.fecha || '';
    document.getElementById('lote-densidad').value = l.densidad || '';
    document.getElementById('lote-lineas').value = l.lineas || '';
    document.getElementById('lote-palmas-linea').value = l.palmasLinea || '';
    document.getElementById('lote-obs').value = l.obs || '';
  } else {
    document.getElementById('modal-lote-title').textContent = 'Nuevo lote';
    document.getElementById('lote-edit-id').value = '';
    ['lote-numero','lote-nombre','lote-has','lote-palmas','lote-fecha','lote-densidad','lote-lineas','lote-palmas-linea','lote-obs'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('lote-variedad').value = '';
    document.getElementById('lote-estado').value = 'preparacion';
  }
}

function cerrarModalLote() {
  document.getElementById('modal-lote').classList.remove('open');
}

function guardarLote() {
  const numero = parseInt(document.getElementById('lote-numero').value);
  if (!numero) { alert('Ingresa el número del lote'); return; }

  const editId = document.getElementById('lote-edit-id').value;
  const lote = {
    id: editId || Date.now().toString(),
    numero,
    nombre: document.getElementById('lote-nombre').value.trim(),
    has: parseFloat(document.getElementById('lote-has').value) || 0,
    palmas: parseInt(document.getElementById('lote-palmas').value) || 0,
    variedad: document.getElementById('lote-variedad').value,
    estado: document.getElementById('lote-estado').value,
    fecha: document.getElementById('lote-fecha').value,
    densidad: parseInt(document.getElementById('lote-densidad').value) || 0,
    lineas: parseInt(document.getElementById('lote-lineas').value) || 0,
    palmasLinea: parseInt(document.getElementById('lote-palmas-linea').value) || 0,
    obs: document.getElementById('lote-obs').value.trim(),
    creadoEn: editId ? (lotes.find(x=>x.id===editId)?.creadoEn || new Date().toISOString()) : new Date().toISOString()
  };

  // Auto-calcular palmas si hay has y densidad
  if (lote.has && lote.densidad && !lote.palmas) {
    lote.palmas = Math.round(lote.has * lote.densidad);
  }

  if (editId) {
    const idx = lotes.findIndex(x => x.id === editId);
    if (idx >= 0) lotes[idx] = lote;
  } else {
    lotes.push(lote);
  }

  lotes.sort((a,b) => a.numero - b.numero);
  saveLotes();
  cerrarModalLote();
  renderLotes();
  actualizarDashboard();
}

function eliminarLote(id) {
  if (!confirm('¿Eliminar este lote? Esta acción no se puede deshacer.')) return;
  lotes = lotes.filter(x => x.id !== id);
  saveLotes();
  renderLotes();
  actualizarDashboard();
}

const estadoLabel = { preparacion: 'En preparación', establecimiento: 'Establecimiento', produccion: 'En producción' };
const estadoClass = { preparacion: 'estado-preparacion', establecimiento: 'estado-establecimiento', produccion: 'estado-produccion' };

function renderLotes() {
  const container = document.getElementById('lotes-cards');
  const totalHas = lotes.reduce((s,l) => s + (l.has||0), 0);
  const totalPalmas = lotes.reduce((s,l) => s + (l.palmas||0), 0);
  const variedades = [...new Set(lotes.map(l => l.variedad).filter(Boolean))].length;

  document.getElementById('res-lotes').textContent = lotes.length;
  document.getElementById('res-has').textContent = totalHas.toLocaleString('es-CO', {maximumFractionDigits:1});
  document.getElementById('res-palmas').textContent = totalPalmas.toLocaleString('es-CO');
  document.getElementById('res-variedades').textContent = variedades;
  document.getElementById('lotes-sub').textContent = lotes.length
    ? `${lotes.length} lote${lotes.length>1?'s':''} · ${totalHas.toLocaleString('es-CO', {maximumFractionDigits:1})} ha registradas`
    : 'Sin lotes registrados aún';

  if (!lotes.length) {
    container.innerHTML = `<div class="empty-lotes">
      <div class="empty-lotes-icon">🏞️</div>
      <div class="empty-lotes-text">No hay lotes registrados aún</div>
      <div class="empty-lotes-sub">Crea tu primer lote para comenzar a organizar Valparaíso</div>
      <button class="btn-primary" onclick="abrirModalLote()">+ Crear primer lote</button>
    </div>`;
    return;
  }

  container.innerHTML = lotes.map(l => `
    <div class="lote-card">
      <div class="lote-card-top">
        <div>
          <div class="lote-num">Lote ${l.numero}</div>
          <div class="lote-name">${l.nombre || 'Sin nombre'}</div>
        </div>
        <div class="lote-actions">
          <button class="btn-icon edit" onclick="abrirModalLote('${l.id}')" title="Editar">✏️</button>
          <button class="btn-icon" onclick="eliminarLote('${l.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="lote-card-body">
        <div class="lote-stat-row">
          <span class="lote-stat-label">Hectáreas</span>
          <span class="lote-stat-val">${l.has ? l.has.toLocaleString('es-CO', {maximumFractionDigits:1}) + ' ha' : '—'}</span>
        </div>
        <div class="lote-stat-row">
          <span class="lote-stat-label">Palmas</span>
          <span class="lote-stat-val">${l.palmas ? l.palmas.toLocaleString('es-CO') : '—'}</span>
        </div>
        <div class="lote-stat-row">
          <span class="lote-stat-label">Líneas</span>
          <span class="lote-stat-val">${l.lineas ? l.lineas + (l.palmasLinea ? ' × ~' + l.palmasLinea + ' palmas' : '') : '—'}</span>
        </div>
        <div class="lote-stat-row">
          <span class="lote-stat-label">Variedad</span>
          <span class="lote-stat-val">${l.variedad || '—'}</span>
        </div>
        <div class="lote-stat-row">
          <span class="lote-stat-label">Siembra</span>
          <span class="lote-stat-val">${l.fecha ? new Date(l.fecha+'T12:00:00').toLocaleDateString('es-CO',{year:'numeric',month:'short',day:'numeric'}) : '—'}</span>
        </div>
        ${l.obs ? `<div style="font-size:12px; color:var(--texto-dim); margin-top:4px; line-height:1.4">${l.obs}</div>` : ''}
      </div>
      <div class="lote-card-footer">
        <span class="estado-chip ${estadoClass[l.estado]||'estado-preparacion'}">${estadoLabel[l.estado]||l.estado}</span>
        <span class="lote-labores">${labores.filter(x => String(x.lote) === String(l.numero)).length} labores</span>
      </div>
    </div>
  `).join('');
}

function actualizarDashboard() {
  const totalPalmas = lotes.reduce((s,l) => s + (l.palmas||0), 0);
  const kpiPalmas = document.querySelector('.kpi-card.dorado .kpi-value');
  if (kpiPalmas) kpiPalmas.textContent = totalPalmas.toLocaleString('es-CO');
  const kpiSub = document.querySelector('.kpi-card.dorado .kpi-sub');
  if (kpiSub) kpiSub.textContent = totalPalmas ? `En ${lotes.length} lote${lotes.length>1?'s':''}` : 'Pendiente georeferenciación';

  // Actualizar tabla de lotes en dashboard
  const tbody = document.querySelector('#page-dashboard .lotes-table tbody');
  if (tbody) {
    if (!lotes.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--texto-dim); padding:32px">No hay lotes registrados — cree su primer lote en la sección Lotes</td></tr>`;
    } else {
      tbody.innerHTML = lotes.map(l => `
        <tr>
          <td style="color:var(--verde-claro); font-weight:600">Lote ${l.numero}${l.nombre ? ' · '+l.nombre : ''}</td>
          <td>${l.has ? l.has.toLocaleString('es-CO', {maximumFractionDigits:1}) + ' ha' : '—'}</td>
          <td>${l.palmas ? l.palmas.toLocaleString('es-CO') : '—'}</td>
          <td>${l.variedad || '—'}</td>
          <td><span class="badge ${l.estado==='produccion'?'badge-verde':l.estado==='establecimiento'?'badge-dorado':'badge-naranja'}">${estadoLabel[l.estado]||l.estado}</span></td>
          <td style="color:var(--texto-dim)">Sin registros</td>
        </tr>
      `).join('');
    }
  }
}

// Cerrar modal al hacer click afuera
document.getElementById('modal-lote').addEventListener('click', function(e) {
  if (e.target === this) cerrarModalLote();
});

// Init
renderLotes();
actualizarDashboard();

// ── NAVEGACIÓN ──────────────────────────────────────────
function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (el) el.classList.add('active');

  const titles = {
    dashboard: 'Dashboard general',
    mapa: 'Mapa de palmas',
    lotes: 'Lotes de Valparaíso',
    maestros: 'Configuración',
    labores: 'Historial de labores',
    formularios: 'Formularios NFC',
    trabajadores: 'Trabajadores',
    cosecha: 'Cosecha RFF',
    polinizacion: 'Polinización',
    mantenimiento: 'Mantenimiento',
    fertilizacion: 'Fertilización',
    bascula: 'Báscula — Despacho RFF',
    sanidad: 'Sanidad y plagas',
    presupuesto: 'Presupuesto de actividades',
    coroz: 'Coroz:IA'
  };
  document.getElementById('topbar-title').textContent = titles[id] || id;
}

function setMsg(text) {
  document.getElementById('chat-input').value = text;
  document.getElementById('chat-input').focus();
}

async function sendMsg() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  const messages = document.getElementById('chat-messages');

  // User message
  const userDiv = document.createElement('div');
  userDiv.className = 'msg msg-user';
  userDiv.textContent = msg;
  messages.appendChild(userDiv);
  input.value = '';
  messages.scrollTop = messages.scrollHeight;

  // Typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'msg msg-bot';
  typingDiv.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  messages.appendChild(typingDiv);
  messages.scrollTop = messages.scrollHeight;

  try {
    // NOTA: Coroz:IA requiere una clave de API de Anthropic para funcionar.
    // Por seguridad, la clave NUNCA debe incluirse en este archivo (quedaría
    // expuesta a cualquier usuario). En producción, enruta esta petición a
    // través de un backend/proxy propio que agregue el header 'x-api-key'.
    // Sin backend, la llamada fallará y se mostrará el mensaje de ayuda del catch.
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        system: `Eres Coroz:IA, el asistente inteligente de AgroWeb para la finca Valparaíso, una plantación de palma africana de 2.094 hectáreas ubicada en Maní, Casanare, Colombia. La finca está en fase pre-operacional.

Tu especialidad es el manejo técnico de palma de aceite (Elaeis guineensis): polinización asistida (ANA 1, ANA 2, ANA 3), manejo fitosanitario (PC - Pudrición del Cogollo, Marchitez Sorpresiva, Anillo Rojo, Pestalotiopsis, Flecha Seca), plagas (Rhynchophorus palmarum, Strategus spp., Opsiphanes spp., Sagalassa valida), cosecha de RFF (Racimos de Fruta Fresca), labores culturales (poda, plateo, fertilización) y gestión agronómica general.

El administrador es Santiago. Respondes en español, de forma concisa y técnicamente precisa. Si no tienes datos reales de la finca aún (porque el sistema acaba de iniciar), lo indicas con amabilidad y orientas sobre cómo obtenerlos.`,
        messages: [{ role: "user", content: msg }]
      })
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text
      || "No pude procesar tu consulta. Verifica que Coroz:IA esté conectado a un backend con clave de API.";

    typingDiv.innerHTML = '';
    typingDiv.textContent = reply;
  } catch (err) {
    typingDiv.innerHTML = '';
    typingDiv.textContent = "Coroz:IA aún no está conectado a la API de Claude. Para activarlo, enruta las consultas a través de un backend propio con tu clave de API de Anthropic.";
  }

  messages.scrollTop = messages.scrollHeight;
}

// ── INICIALIZACIÓN FINAL ────────────────────────────────
// Cargar demo si no hay datos (primera vez) — al final porque ya existen todas las variables
if (!lotes.length && !labores.length && !pesajes.length) {
  cargarDemo();
} else {
  actualizarDashboardLabores();
}
renderCosecha();
renderSanidad();
renderDetecciones();
renderCensoProduccion();
renderTodosModulosActividad();

// Sesión: login si no hay, permisos si hay
if (sesion) {
  aplicarPermisos();
} else {
  mostrarLogin();
}
