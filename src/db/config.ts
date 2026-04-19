export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function getPostgresConfig(): PostgresConfig {
  return {
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? "5433"),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "reactivepass",
    database: process.env.PGDATABASE ?? "mini_agent"
  };
}
