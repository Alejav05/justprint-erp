# JustPrint ERP — Fase 1: base del sistema

Backend en Node.js (Fastify + Knex). Desarrollo y pruebas con SQLite; producción con MySQL.

## Qué incluye
- 49 tablas (44 del modelo + `sesiones`, `feriados`, `indices_ipc`, `alertas_eventos` y `alertas_envios`) con migraciones que suben y bajan.
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
- Facturación: liquidación mensual por contador (prorrateo, franquicia, excedentes; verificada contra la planilla), borradores, emisión con IVA 21 %, venta directa, cobros aplicados a facturas y cuentas sin comprobante aparte. Todo en USD neto con cotización BNA.
- Rentabilidad y cobranzas, en dos carriles. **Rentabilidad** (solapa Negocio del cliente): ingresos (facturas) contra egresos (costos) por mes, con el mes en que los ingresos superan a los costos; no depende de si se cobró. **Cobranzas** (menú propio, rol Facturación): el plazo de pago se acuerda en el contrato y la factura lo copia al emitirse; semáforo verde (en plazo), amarillo (vencida hasta 15 días) y rojo (más de 15 días). Cobranzas registra gestiones (llamada, mail, WhatsApp, visita, promesa de pago) con fecha de seguimiento y, si el cliente no responde, pasa la factura al comercial de la cuenta, que la ve en su lista y puede devolverla. Permisos `cobranzas.gestionar` y `cobranzas.escaladas`.
- Configuración (solo Dirección, permiso `sistema.configurar`): valores editables (plazo por defecto, días de gracia, intervalo de ajuste por IPC, eslogan), módulos que se pueden ocultar para todos, y matriz de permisos por rol (Dirección es fija y siempre tiene todo). Cada cambio queda en Auditoría. El ajuste por IPC existe solo para contratos en pesos: el sistema calcula y avisa (también al comercial de la cuenta) y una persona lo valida y lo carga. Alertas: factura vencida, seguimiento del día y factura pasada al comercial.
- Ajuste trimestral por IPC compuesto: se cargan los índices mensuales a mano, el contrato propone los precios nuevos (abono y páginas, franquicia sin cambios) y al aplicar cierra la condición anterior. Las bonificaciones manuales en una factura quedan marcadas.
- Mi día (técnico): al entrar ve sus visitas de hoy por hora, las atrasadas, lo pendiente ordenado por urgencia de SLA, cuántos cerró hoy y su propio SLA contra el mes anterior y el histórico. Cada tarjeta lleva al cierre móvil y al domicilio en el mapa.
- Tableros de inicio por área: Atención (para asignar, SLA por vencer, esperando al cliente, insumos), Comercial (cartera, abono, deuda, contratos por vencer, clientes con tickets abiertos; el head ve además al equipo y lo que no tiene responsable) y Facturación (listos para facturar, faltan lecturas, borradores y deuda más antigua).
- Alertas configurables por regla (canales sistema, mail y WhatsApp, destinatarios, umbral, frecuencia y texto con datos del momento), campana de notificaciones y alta de usuarios desde la pantalla.
- 114 pruebas automáticas (`npm test`).

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

**Sin terminal (Hostinger):** con `AUTO_MIGRAR=1` la app, al arrancar, aplica las migraciones, carga los datos base y, si todavía no hay usuarios y están `ADMIN_EMAIL`, `ADMIN_NOMBRE` y `ADMIN_PASSWORD`, crea el primer usuario de Dirección. Es idempotente. Una vez creado el administrador se puede quitar `ADMIN_PASSWORD`.
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

## Verificado en MySQL
Las pruebas pasan también contra MariaDB 10.11 (`TEST_DB=mysql DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD=… npm test`: crea una base descartable por archivo, hay que dar un usuario con permiso para crear bases). La planilla real también se importó completa en MariaDB. Falta confirmar contra la versión exacta del plan de Hostinger cuando esté la base creada.

## Próximas fases
Importador desde las hojas actuales, pantallas (a partir del prototipo), tableros por área, app del técnico, motor de alertas, facturación electrónica por proveedor.

## Clientes, contactos y Hunting

**Alta de cliente** (Clientes › Nuevo cliente): datos de la empresa con CUIT validado (dígito verificador, sin duplicados), rubro y subrubro (catálogo editable por Dirección en `/api/rubros`), domicilio fiscal, sede principal con su zona de SLA, contactos y responsable comercial, todo en una sola operación. **Contactos**: varios por cliente, con roles (decisor, comercial, compras, administración, *recibe facturas*, *gestiona cobranzas*, IT, técnico, usuario), teléfonos y mails múltiples, fecha de nacimiento (edad y próximo cumpleaños calculados), canal y horario preferido, intereses y consentimiento. La ficha avisa si falta quién recibe las facturas o quién reclama el pago.

**Hunting**: leads en un tablero por etapa (Nuevo, Contactado, Reunión, Propuesta, Negociación, Ganado, Perdido), con arrastrar y soltar, historial de gestiones, próxima acción con alerta de vencida y motivo obligatorio al perder. Un comercial ve solo sus leads; `leads.todos` (líder y Dirección) ve los de todo el equipo. *Ganado* se logra convirtiendo el lead: crea el cliente (prospecto), su sede, el contacto y la cuenta a nombre del comercial. El cliente pasa a Activo al activar su primer contrato.

**Clientes y Hunting van separados.** Un prospecto vive solo en Hunting; recién al ganarlo se lo convierte en cliente y el sistema lleva directo a cargar el contrato cerrado. Clientes es para las cuentas que ya trabajan con nosotros (Activos e Inactivos) y tiene su propio seguimiento (farming): historial de gestiones y próximos pasos. Cada cliente tiene varios **locales** (domicilios); los equipos se asignan a un contrato y a un local, y la pantalla **Equipos** los muestra agrupados por cliente › contrato con la dirección de cada uno.
