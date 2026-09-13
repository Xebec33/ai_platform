import { Pool } from 'pg';
import { PostgresPersistence } from '../persistence/index.js';

export function createPostgresPersistenceFromEnv(): PostgresPersistence | undefined {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  return new PostgresPersistence(new Pool({ connectionString }));
}
