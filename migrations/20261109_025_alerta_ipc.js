// La alerta de IPC avisa 15 días antes del mes que se ajusta (editable en Alertas) y con el texto nuevo.
export async function up(knex) {
  await knex('reglas_alerta').where({ tipo: 'ajuste_ipc_pendiente' }).whereNull('umbral').update({ umbral: 15, unidad: 'días antes' });
  await knex('reglas_alerta').where({ tipo: 'ajuste_ipc_pendiente' }).where('plantilla_cuerpo', 'like', 'El contrato "{contrato}" de {cliente} tiene los mismos precios%').update({
    plantilla_asunto: 'Ajuste por IPC: {cliente} desde {mes}',
    plantilla_cuerpo: 'El contrato "{contrato}" de {cliente} se ajusta por IPC desde el servicio de {mes}. {estado_ipc} Se revisa y confirma en Ajustes por IPC; lo valida una persona.' });
}
export async function down() {}
