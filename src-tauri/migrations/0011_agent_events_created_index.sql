-- Newest-first reads of the event log, which is what the inspector and the startup load ask for.
--
-- The existing session index leads with agent type and session id, so an `ORDER BY created_at`
-- across every session could not use it: at thirty thousand rows that read was a full table scan
-- plus a temporary sort, over a second on a warm database, paid on every startup.
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at DESC);
