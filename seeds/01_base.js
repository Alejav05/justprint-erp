import { AREA, PERMISOS, ROLES, NUMERADORES, REGLAS_ALERTA, FERIADOS, PUENTES, RUBROS } from '../src/lib/catalogo.js';

/** Idempotente: se puede correr en cada despliegue sin duplicar nada. */
export async function seed(knex) {
  const nuevos = new Set(); // permisos creados en esta corrida
  for (const [clave, modulo, descripcion] of PERMISOS) {
    const hay = await knex('permisos').where({ clave }).first();
    if (!hay) { await knex('permisos').insert({ clave, modulo, descripcion }); nuevos.add(clave); }
  }

  for (const [nombre, def] of Object.entries(ROLES)) {
    let rol = await knex('roles').where({ nombre }).first();
    const rolNuevo = !rol;
    if (!rol) {
      await knex('roles').insert({ nombre, descripcion: def.descripcion, es_sistema: true });
      rol = await knex('roles').where({ nombre }).first();
    }
    // Un rol que ya existe conserva los permisos que Dirección le dejó: solo se le suman los permisos nuevos del sistema.
    const permisos = await knex('permisos').whereIn('clave', rolNuevo ? def.permisos : def.permisos.filter((c) => nuevos.has(c))).select('id');
    for (const p of permisos) {
      const hay = await knex('rol_permiso').where({ rol_id: rol.id, permiso_id: p.id }).first();
      if (!hay) await knex('rol_permiso').insert({ rol_id: rol.id, permiso_id: p.id });
    }
  }

  let ordenRubro = 0;
  for (const [nombre, subs] of Object.entries(RUBROS)) {
    let r = await knex('rubros').whereNull('parent_id').where({ nombre }).first();
    if (!r) { const [id] = await knex('rubros').insert({ nombre, orden: ordenRubro }); r = { id }; }
    ordenRubro += 1; let o = 0;
    for (const sub of subs) {
      if (!(await knex('rubros').where({ parent_id: r.id, nombre: sub }).first())) await knex('rubros').insert({ nombre: sub, parent_id: r.id, orden: o });
      o += 1;
    }
  }

  for (const nombre of Object.values(AREA)) {
    const hay = await knex('areas').where({ nombre }).first();
    if (!hay) await knex('areas').insert({ nombre });
  }

  for (const [fecha, nombre] of FERIADOS) {
    if (!(await knex('feriados').where({ fecha }).first())) await knex('feriados').insert({ fecha, nombre, tipo: 'feriado', no_habil: true });
  }
  for (const [fecha, nombre] of PUENTES) {
    if (!(await knex('feriados').where({ fecha }).first())) await knex('feriados').insert({ fecha, nombre, tipo: 'puente', no_habil: false });
  }

  for (const n of NUMERADORES) {
    const hay = await knex('numeradores').where({ clave: n.clave }).first();
    if (!hay) await knex('numeradores').insert(n);
  }

  for (const [tipo, umbral, unidad, destinatarios] of REGLAS_ALERTA) {
    const hay = await knex('reglas_alerta').where({ tipo }).first();
    if (!hay) {
      await knex('reglas_alerta').insert({
        tipo, umbral, unidad, destinatarios: JSON.stringify(destinatarios), canales: JSON.stringify(['app', 'mail']),
      });
    }
  }
}
