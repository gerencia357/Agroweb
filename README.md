# AgroWeb — Valparaíso

Aplicación web de gestión palmicultora para la finca **Valparaíso** (Maní, Casanare — 2.094 ha de palma de aceite). Es una SPA (single-page application) sin dependencias ni backend: toda la información se guarda en el `localStorage` del navegador.

## Estructura del proyecto

Antes todo vivía en un único archivo HTML de ~2.500 líneas. Se reorganizó en tres archivos con una responsabilidad clara cada uno:

```
Agroweb/
├── index.html        # Estructura HTML: sidebar, páginas y modales
├── css/
│   └── styles.css    # Todos los estilos (variables de tema, layout, responsive)
└── js/
    └── app.js        # Toda la lógica: estado, render, persistencia
```

Para usarla, basta abrir `index.html` en un navegador moderno (Chrome, Edge, Firefox).

## Módulos

- **Dashboard** — resumen operativo con KPIs y gráfico de labores del mes.
- **Mapa de palmas** — importación de KML/GeoJSON (marcador de posición).
- **Historial de labores** — vista consolidada con flujo de aprobación.
- **Campo** — Polinización (ANA 1/2/3), Mantenimiento (poda, plateo), Fertilización, Sanidad, Cosecha RFF. Todos con registro manual, carga masiva y **Modo NFC** (con lector real vía Web NFC en Android/Chrome + GPS).
- **Báscula** — pesaje de vehículos (bruto/tara/neto) y trazabilidad a planta.
- **Presupuesto** — presupuestado vs. ejecutado, cruzado automáticamente con las labores aprobadas.
- **Sanidad** — detecciones fitosanitarias por palma con ciclo de seguimiento (activo → tratamiento → recuperada / erradicada).
- **Coroz:IA** — asistente conversacional especializado en palma (requiere backend, ver abajo).
- **Configuración (maestros)** — trabajadores, catálogo de labores, tarifas (con categorías), vehículos, insumos, enfermedades/plagas, usuarios y formularios personalizados.

## Roles y acceso

Login con PIN. Roles: Administrador, Supervisor, Operador báscula y Trabajador de campo, cada uno con páginas y permiso de aprobación distintos. Usuarios demo:

| Usuario | Rol | PIN |
|---|---|---|
| Santiago | Administrador | 1234 |
| José Alirio Pérez | Supervisor | 1111 |
| Ana Milena Torres | Operador báscula | 2222 |
| Carlos Andrés Ruiz | Trabajador de campo | 3333 |

## Datos

- Persistencia en `localStorage` (claves con prefijo `agroweb_`).
- Botón **🎬 Demo** recarga un set de datos de demostración; **🧹** borra todo.

## Revisión de código — correcciones aplicadas

Durante la reorganización se revisó el código y se corrigieron estos puntos:

1. **Gráfico "Plateo" del dashboard** siempre mostraba 0: comparaba `actividad === 'Plateo'` cuando las actividades reales son `Plateo Químico`/`Plateo Mecánico`. Ahora usa `startsWith('Plateo')`.
2. **Coroz:IA** usaba un id de modelo inexistente (`claude-sonnet-4-6`) y le faltaban cabeceras. Se corrigió a un modelo válido y se añadieron `anthropic-version` y `anthropic-dangerous-direct-browser-access`. Ver nota de seguridad abajo.
3. **Tabla de lotes del dashboard**: el selector `.lotes-table tbody` era frágil (varias páginas usan esa clase). Ahora está acotado a `#page-dashboard .lotes-table tbody`.
4. **Tarjetas de lote** mostraban "0 labores" fijo; ahora cuentan las labores reales del lote.
5. Se simplificó la detección de fila de encabezado en la carga masiva de maestros (condición equivalente pero legible).

## Nota de seguridad — Coroz:IA

El asistente llama a la API de Anthropic desde el navegador. **Nunca** incluyas la clave de API (`x-api-key`) en `app.js`: quedaría expuesta a cualquier usuario. En producción, enruta la petición a través de un **backend/proxy propio** que agregue la clave. Sin ese backend, la llamada falla de forma controlada y se muestra un mensaje de ayuda.
