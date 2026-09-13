export const persistenceSchema = `
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  status TEXT NOT NULL,
  current_node TEXT,
  iteration INTEGER,
  iterations JSONB NOT NULL DEFAULT '{}'::jsonb,
  variables JSONB NOT NULL,
  node_outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB,
  output JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  iteration INTEGER,
  error TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workflow_states (
  run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
  current_node TEXT,
  iteration INTEGER,
  variables JSONB NOT NULL,
  node_outputs JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,
  current_node TEXT NOT NULL,
  variables JSONB NOT NULL,
  node_outputs JSONB NOT NULL,
  iterations JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS output JSONB;

CREATE INDEX IF NOT EXISTS workflow_runs_workflow_id_idx ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS node_runs_run_id_idx ON node_runs(run_id);
CREATE INDEX IF NOT EXISTS checkpoints_run_id_idx ON checkpoints(run_id);
`;
