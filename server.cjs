// Puerta de entrada para hostings que cargan la app con require() (LiteSpeed / lsnode de Hostinger).
// El servidor real es un módulo ESM con await de nivel superior, que require() no puede cargar;
// import() dinámico sí. Con `npm start` se sigue usando src/server.js directamente.
import('./src/server.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
