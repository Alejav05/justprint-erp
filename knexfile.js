import 'dotenv/config';

const comun = {
  migrations: { directory: './migrations' },
  seeds: { directory: './seeds' },
};

export default {
  development: {
    client: 'better-sqlite3',
    connection: { filename: './dev.sqlite3' },
    useNullAsDefault: true,
    ...comun,
  },
  test: {
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    ...comun,
  },
  production: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
      decimalNumbers: true,
    },
    pool: { min: 0, max: 10 },
    ...comun,
  },
};
