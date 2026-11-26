# Agente de toma de contadores

Programa que se instala en **una PC de cada cliente**. A fin de mes busca las impresoras de la red, les lee los contadores por SNMP y los manda al ERP. El ERP los valida: las lecturas normales entran solas a Contadores como *automáticas*; las dudosas quedan en **Contadores › Toma automática › A revisar**.

## Cómo funciona

- **Cuándo toma:** la tarea programada corre todos los días (9, 12, 15 y 18 h), pero solo hace algo **los últimos 3 días del mes** y, si algún equipo no respondió, sigue intentando **hasta el día 10** del mes siguiente. Cuando todos los equipos del cliente tienen su lectura del período, no hace nada más. Si la PC estaba apagada a esa hora, corre apenas se prende.
- **Qué período factura:** lo decide el ERP con la fecha: desde el día 20 cuenta para el mes en curso; hasta el día 10 cuenta para el mes anterior. Una toma de mitad de mes queda a revisar.
- **Cómo reconoce los equipos:** por número de serie. Las impresoras del cliente que no son de JustPrint se informan como *no registradas* y no molestan.
- **Qué valida el ERP:** que el contador no baje, que el consumo no sea cero ni más del doble de lo habitual, que el equipo sea de ese cliente y que no haya una lectura cargada a mano (la manual siempre gana).
- **Sin internet:** guarda la toma y la manda en la próxima corrida (el ERP acepta tomas de hasta 15 días atrás con su fecha original).
- **Seguridad:** cada agente tiene su propio token. Solo puede mandar lecturas y ver la lista de equipos de su cliente. Se desactiva o se renueva desde el ERP.

## Instalación en un cliente (Windows)

Lo más simple: **doble clic en `agente-contadores.exe`** abre un menú (configurar, buscar impresoras, probar, diagnóstico, instalar la toma automática). Para instalar la toma automática hay que abrirlo con *clic derecho › Ejecutar como administrador*. Lo mismo por consola:


1. En el ERP: **Contadores › Toma automática › Nuevo agente**. Elegí el cliente, poné un nombre (por ejemplo "Recepción") y copiá el token. Se muestra una sola vez.
2. Copiá `agente-contadores.exe` a la PC del cliente, en `C:\Program Files\JustPrint\` (cualquier PC que quede prendida y esté en la misma red que las impresoras).
3. Abrí una consola **como administrador** en esa carpeta y corré:
   ```
   agente-contadores configurar --url https://TU-ERP --token jpa_XXXX
   agente-contadores probar
   agente-contadores instalar
   ```
   `probar` muestra las impresoras que encontró, con sus contadores, y manda una toma de prueba (en el ERP se ve, pero no se usa para facturar). Si falta alguna, revisá que esté prendida, que tenga SNMP activado y su IP.
4. Listo. En el ERP, la lista de agentes muestra la última conexión de cada uno.

Si las impresoras están en otra red o la PC tiene varias placas, indicá las redes o las IPs:
```
agente-contadores configurar --url https://TU-ERP --token jpa_XXXX --redes 192.168.10.0/24 --ips 10.0.5.20,10.0.5.21
```

Todo queda en `C:\ProgramData\JustPrint\Contadores\` (`config.json`, `agente.log`, envíos pendientes).

## Requisitos en las impresoras

SNMP v2c activado con la comunidad de lectura `public` (es lo que viene de fábrica en Brother, HP, Lexmark y Konica Minolta). Si un cliente la cambió: `--comunidad otra`. El firewall de la PC no necesita puertos de entrada; sale por UDP 161 hacia las impresoras y por HTTPS hacia el ERP.

## Marcas y contadores

| Marca | Negro / color | Estado |
|---|---|---|
| HP | MIB de HP (`total-mono-page-count` / `total-color-page-count`) | A confirmar en un equipo real |
| Lexmark | MIB de Lexmark (`pgMono` / `pgColor`) | A confirmar en un equipo real |
| Konica Minolta | Copias + impresiones, negro y color (dos variantes según la generación del bizhub) | A confirmar en un equipo real |
| Brother | Solo el total estándar. Sirve para los monocromo; los color quedan a revisar hasta confirmar el OID | A confirmar en un equipo real |

Para cualquier equipo nuevo, o para confirmar los de la tabla, en la PC del cliente:
```
agente-contadores diagnostico 192.168.1.50
```
Lista todos los contadores que informa el equipo. Comparalos con la hoja de contadores que imprime el equipo (o su página web) para ver cuál es negro y cuál color. Si un modelo usa otros OID, se agregan en `src/perfiles.js` o, sin recompilar, en `config.json`:
```json
"perfiles": { "brother": { "negro": ["1.3.6.1.4.1.2435.…"], "color": ["1.3.6.1.4.1.2435.…"] } }
```

## Otros comandos

- `agente-contadores buscar`: solo busca y muestra, no manda nada.
- `agente-contadores tomar --forzar`: toma y manda ahora aunque no sea fin de mes.
- `agente-contadores estado`: configuración actual y envíos pendientes.
- `agente-contadores desinstalar`: borra la tarea programada.

## Desarrollo

```
npm install
npm test             # incluye impresoras simuladas por SNMP y una prueba de punta a punta contra el ERP (necesita npm install en la raíz)
npm run empaquetar   # arma dist/agente-contadores.exe (Windows x64, sin Node instalado)
```
El .exe no está firmado: Windows SmartScreen puede pedir confirmación la primera vez ("Más información › Ejecutar de todas formas").
