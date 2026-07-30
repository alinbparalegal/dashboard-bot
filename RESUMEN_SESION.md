# Resumen de sesión — Dashboard de Funnel GHL

Documento de traspaso para retomar el trabajo en una nueva conversación. Fecha: 2026-07-30/31 (sesión larga, varios días).

## ⚠️ Punto urgente pendiente

**El último `git push` (commit `8028426`) no se ha desplegado en Render.** Al comprobar `https://dashboard-bot-paralegal.onrender.com/api/stats/attribution` sigue dando 404 — la ruta no existe, señal de que Render se quedó en un commit anterior (probablemente `1a91c43`). Antes de nada, en la nueva sesión:
1. Entrar al panel de Render → pestaña **Events**/**Deploys** del servicio → ver si el deploy de `8028426` falló, se quedó en cola, o simplemente no se disparó.
2. Si hace falta, lanzar un **Manual Deploy → Deploy latest commit** desde el propio panel de Render.
3. Verificar tras el deploy que `GET /api/stats/attribution` (con Basic Auth) ya no da 404.

## Qué es el proyecto

Dashboard de funnel del bot conversacional de GoHighLevel (GHL), para 5 marcas: **CYA** (Cohen & Aguirre), **ETH** (España te homologa), **ETV** (Estuvisa), **NAC** (Nacionalízate), **MNEE** (Mi negocio en España).

- **Repo**: `C:\Users\Portatil 4\estadistica-bot-api`, GitHub `alinbparalegal/dashboard-bot`, rama `master`.
- **Desplegado en**: Render (plan Free, se duerme tras inactividad) → `https://dashboard-bot-paralegal.onrender.com`
  - Usuario: `Paralegal2026` / Contraseña: `Dashbot-6202` (HTTP Basic Auth, protege toda la web y la API)
- **Base de datos**: MongoDB Atlas (`cluster-bot2`, nivel gratuito probablemente), histórico diario por marca.
- **Fuente de datos**: API de GHL, **solo lectura**, con tokens PIT por marca en `.env` (nunca en el repo).

## Definiciones del funnel (acordadas con el usuario)

El bot marca cada contacto con 1 de 6 tags de estado (mutuamente excluyentes, se sobrescriben): `lead_cualificando`, `lead_potencial`, `pago_pendiente`, `consulta_agendada`, `cliente_postventa`, `lead_no_potencial`.

- **Conversación** = unión de los 6 tags.
- **Cualificado** = `lead_potencial` ∪ `pago_pendiente` ∪ `consulta_agendada` ∪ `cliente_postventa`.
- **Cita** = solo `consulta_agendada` (se excluyó `cliente_postventa` a petición del usuario: el bot no gestiona la fase de posventa, y ese tag es de origen mixto bot/humano).
- **Ingreso estimado** = Citas × precio de asesoría por marca (rango online–presencial, en `src/config/brands.js`), porque no hay tag fiable de modalidad.
- **Periodo**: desde `BOT_LAUNCH_DATE=2026-06-25` (lanzamiento del bot actual) hasta hoy — nunca una ventana móvil de 30 días para las métricas de negocio (el heatmap de "últimos 30 días" es la excepción, ver abajo).

## Hallazgos importantes sobre fiabilidad de los datos

1. **`consulta_agendada` no siempre implica reserva real.** Se validó cruzando contra calendarios de GHL: ~44-50% de las citas marcadas no tenían evento de calendario. Se investigó por qué y se descubrió que muchas se coordinan manualmente por chat (sobre todo en leads de Instagram, donde el bot no puede capturar teléfono/email para crear el evento formal).

2. **El tag `pago info` (+ campo "Fecha de Pago" no vacío) es un indicador 100% fiable** de que la cita/pago es real — se validó con correlación perfecta (32 de 32 casos verificados por calendario en las 4 marcas principales) tanto si gestiona el bot como un humano. **Esto reemplazó el cruce con calendarios en el timeline** (mucho más barato: de ~90-110s a pocos segundos).

3. **`cliente_postventa`** es un tag de origen mixto (a veces lo pone el bot, a veces un humano tras escalar) — por eso se excluye de "Cita".

4. **Autogestión** (`autogestion` + `pago info`, cliente gestiona el trámite él mismo sin asesoría pagada) existe y es significativa en volumen, pero se decidió **no** contarla como métrica porque no es 100% verificable (podría ser una excusa del cliente para posponer).

5. **El canal de entrada importa mucho**: WhatsApp convierte a Cita un 4-6%, Instagram y Facebook casi 0% en la mayoría de marcas. Los tags `canal_*` (whatsapp/instagram/facebook) solo cubren ~75% de los leads; `attributionSource.sessionSource` de GHL cubre el 100% pero no se puede filtrar en la API — hay que leerlo contacto a contacto (paginado).

6. **Solo ~4-5% de los Cualificados llegan a pagar.** No hay tag de motivo para el 85% que no avanza — es la mayor "fuga" del funnel, sin explicación clara en los datos.

7. **Bot vs. humano**: se añadió el campo "gestionado por" al timeline — muestra cuántas citas cierra el bot en automático vs. cuántas se escalan a un humano.

## Arquitectura técnica (backend)

```
src/
  app.js                    # Express + Basic Auth (middleware/basicAuth.js)
  config/brands.js          # 5 marcas: tokens (env), locationId, catálogo trámites, precios
  config/db.js              # Mongo (fuerza DNS 8.8.8.8 por workaround conocido)
  models/DailyStat.js        # 1 doc por (marca, fecha)
  services/ghlClient.js      # Cliente GHL: rate-limit global (~2.4 req/s), countTag,
                              # listByTag, listByAnyTag (paginado con searchAfter), getContact
  services/statsService.js   # Toda la lógica: getSummary, getDailyTotals, getChannelBreakdown,
                              # getCitasTimeline, getAttribution — todas con caché in-memory
  services/dailyStatsCron.js # Cron 00:30, recalcula últimos 7 días (node-cron)
  scripts/backfillDailyStats.js
```

### Cachés in-memory (todas con patrón `force=true` para saltarlas)
- "Hoy en vivo": 3 min.
- Timeline de citas: 3 min.
- Canales: 10 min.
- Atribución (sessionSource/campañas): 20 min — es la consulta más cara (~60-70s, pagina contacto a contacto porque GHL no permite filtrar por `sessionSource`).

### Autorreparación de huecos
Si el cron nocturno no se ejecuta (el plan Free de Render se duerme y puede coincidir con las 00:30), `getDailyTotals` detecta días recientes (últimos 10) sin datos y los recalcula al vuelo — **con cuidado de no intentar reparar fechas anteriores a `BOT_LAUNCH_DATE`** (bug real que apareció al probar el filtro de junio: intentaba "reparar" días de antes del lanzamiento del bot, gastando cientos de llamadas a GHL inútilmente — ya arreglado).

## Frontend (`frontend/`, estático, sin build)

- `index.html` + `dashboard.css` + `dashboard.js`
- Pestañas de periodo **Todo / Junio / Julio / ...** (generadas dinámicamente) — filtran KPIs, comparativa, roscos, tarjetas de marca, timeline. El heatmap y la tendencia ahora **también** respetan el periodo (antes eran fijos a "últimos 30 días" siempre, causaba confusión).
- Botón **"Actualizar datos"** fuerza recálculo real (bypassa cachés) — se añadió tras detectar que con cachés largas el botón no traía datos nuevos.
- Secciones: KPIs, heatmap 30 días, tendencia, comparativa entre marcas, roscos (citas por marca / canal), tarjetas por marca con análisis detallado (trámites/motivos con etiquetas en lenguaje simple), timeline de citas con desglose bot/humano, **"Últimas 10 citas"** (todas las marcas juntas), rosco de **procedencia real (sessionSource)**, tabla de **rendimiento por campaña** (UTM).

## Pendiente / ideas no implementadas (mencionadas pero no construidas)

- Guardado incremental de la atribución (sessionSource/campañas) — se decidió NO implementarlo todavía porque no se confirmó que GHL cobre por volumen de llamadas (habría que preguntar a GHL directamente).
- Show-up real de citas (`appointmentStatus`: confirmed/showed/noshow) — se abandonó como base del dashboard al pasar a `pago info`, pero podría recuperarse como informe puntual si se necesita.
- Coste por lead / ROI real (necesitaría el gasto real de las campañas, que no tenemos).
- Filtros adicionales sugeridos y aceptados en concepto pero no construidos: por marca, por confirmado/sin confirmar, por bot/escalada — el usuario pidió primero el cuadro de "Últimas 10 citas" en su lugar, ya construido.

## Notas de proceso importantes

- El usuario usa "New Web Service" manual en Render (no Blueprint) → `render.yaml` **no se lee**, todas las env vars se añaden a mano en el panel de Render.
- MongoDB Atlas tiene el whitelist en `0.0.0.0/0` (necesario porque Render no da IP fija en este plan).
- Nunca commitear `.env` (ya en `.gitignore`) ni mostrar tokens/contraseñas salvo que el usuario lo pida explícitamente.
- El usuario prefiere confirmar explícitamente cada `git push` antes de que se ejecute.
