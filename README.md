# JustPrint ERP — Fase 1: base del sistema

Backend en Node.js (Fastify + Knex). Desarrollo y pruebas con SQLite; producción con MySQL.

## Qué incluye
- 46 tablas (44 del modelo + `sesiones` + `feriados`) con migraciones que suben y bajan.
- Ingreso con sesión en cookie httpOnly, bloqueo tras 5 fallos, límite por IP, control de Origin, cabeceras de seguridad.
- Permisos por rol y alcance de datos (propio / equipo / todo). Un cliente fuera de alcance responde 404.
- Cartera comercial con historial: una sola responsable vigente por cuenta, reasignación por el head, todo auditado.
- Los importes solo llegan a quien tiene el permiso `importes.ver`.
- Auditoría de cambios, sin guardar contraseñas.
- Importador de la planilla de Google Sheets (ver abajo).
- Pantallas: ingreso, menú por permisos, tablero de Dirección (facturado y cobrado separados, USD netos), clientes con detalle y contratos, usuarios y auditoría.
- Tickets: alta con SLA por zona de la sede (CABA 24 h, resto 48 h hábiles), asignación con fecha de visita, historial, y cierre del técnico en una sola operación (parte, contadores validados, repuestos con baja de stock y remito de servicio, conformidad con firma). Todo o nada.
- Tablero de Servicio y bloque de SLA en Dirección: tiempo medio, % dentro de SLA y primera respuesta del mes contra el mes anterior y contra el histórico. Los tickets migrados no cuentan (no tienen tiempos reales).
- Equipos: inventario, ficha con historial (dónde estuvo, contadores, tickets), instalar/retirar/baja, lecturas de contadores validadas y etiqueta autoadhesiva de soporte (el QR abre WhatsApp con el número de serie ya cargado).
- Insumos: stock por movimientos, mínimo por insumo, entregas por remito (todo o nada) y remito imprimible.
- Cotización del dólar oficial BNA (vendedor) tomada de DolarAPI al arrancar y cada 6 horas.
- Facturación y cobranzas: liquidación mensual por contador (prorrateo, franquicia, excedentes; verificada contra la planilla), borradores, emisión con IVA 21 %, venta directa, cobros aplicados a facturas, antigüedad de deuda y cuentas sin comprobante aparte. Todo en USD neto con cotización BNA.
- 98 pruebas automáticas (`npm test`).

## SLA: cómo se cuenta
Horas hábiles de lunes a viernes, de 9 a 18 (hora de Buenos Aires), salteando los feriados nacionales. Los feriados se traen solos de ArgentinaDatos al arrancar el servidor y cada 24 horas (`npm run feriados` lo hace a mano); si la API no responde se usan los ya cargados. Los puentes turísticos entran como días hábiles, pero se pueden marcar como no hábiles en la tabla `feriados`. El reloj corre desde que se abre el ticket hasta que se resuelve, sin pausas. Se puede cambiar la jornada con `SLA_JORNADA_DESDE` y `SLA_JORNADA_HASTA`. Con 0 y 24, una hora hábil es una hora corrida de un día hábil. Las firmas se guardan en `storage/` (o en `ARCHIVOS_DIR`): incluirlo en el backup.

## Probarlo en tu máquina
```
npm install
cp .env.example .env     # NODE_ENV=development para SQLite
npx knex migrate:latest
npm run seed:base
npm run seed:demo        # solo desarrollo: 10 usuarios @demo.local, clave Demo-JustPrint-2026
npm run dev              # http://localhost:3000 (pantalla) y /api/salud
npm test
```

## Publicar en Hostinger Business
1. hPanel → Sitios web → Agregar sitio → **Aplicación web Node.js**. Elegí Node 20 o superior y subí este proyecto (por GitHub o por zip). Comando de inicio: `npm start`.
2. hPanel → Bases de datos → crear una base MySQL y su usuario. Anotá nombre, usuario y clave.
3. En las variables de entorno de la aplicación cargá lo de `.env.example` (NODE_ENV=production, ALLOWED_ORIGIN con tu dominio, DB_*).
4. En la terminal SSH o en la consola de la app: `npm install --omit=dev`, `npx knex migrate:latest --env production`, `npm run seed:base`.
5. Crear tu usuario de Dirección: `ADMIN_EMAIL=... ADMIN_NOMBRE=... ADMIN_PASSWORD='...' npm run crear-admin`. No cargues los datos demo en producción (el script se niega).
6. Copias de seguridad: en hPanel → Cron Jobs, todos los días 03:30: `/bin/sh $HOME/<carpeta-de-la-app>/scripts/backup.sh`. Guarda 14 días.

> Nota: los pasos de hPanel pueden variar de nombre. Verificá la versión de Node que ofrece tu plan antes de subir.

Para usar el logo real, copiá el archivo (blanco sobre fondo transparente) a `public/img/logo.png`: se muestra solo, y si no está se usa el nombre en texto.

## Cargar los datos de la planilla
Descargá el Sheet como `.xlsx` (Archivo > Descargar > Microsoft Excel). Con la base ya migrada, los datos base cargados y tu usuario creado:
```
npm install                                  # completo, el importador usa exceljs
npm run importar -- planilla.xlsx            # ENSAYO: muestra el informe y no guarda nada
npm run importar -- planilla.xlsx --aplicar  # guarda
```
Solo corre sobre una base sin clientes. Deja afuera la cuenta de pruebas (`--incluir-prueba` para cargarla), corrige el corrimiento de huso horario de las fechas, carga facturas y cobros por separado y deja el próximo número de remito donde corresponde. El informe lista lo que hay que confirmar.

## Pendiente de verificar
Todo se probó sobre SQLite. Antes de usar datos reales hay que correr las migraciones y las pruebas contra una base MySQL real (sumas decimales y columnas JSON).

## Próximas fases
Importador desde las hojas actuales, pantallas (a partir del prototipo), tableros por área, app del técnico, motor de alertas, facturación electrónica por proveedor.
