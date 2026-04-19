-- PostgreSQL schema for a handoff-based agent runtime.
-- Core entities:
--   sessions   -> a user-visible conversation
--   runs       -> one execution turn within a session
--   messages   -> conversation history used as model context
--   tool_calls -> structured tool execution records
--   handoffs   -> agent-to-agent control transfer events

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'busy', 'archived', 'error')),
  current_agent TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  trigger_message_id UUID,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  trace_id TEXT,
  input_summary TEXT,
  output_summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  agent_name TEXT,
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN ('message', 'tool_result', 'handoff_summary')),
  content TEXT NOT NULL DEFAULT '',
  sequence BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence)
);

ALTER TABLE runs
  ADD CONSTRAINT runs_trigger_message_id_fkey
  FOREIGN KEY (trigger_message_id)
  REFERENCES messages(id)
  ON DELETE SET NULL;

CREATE TABLE tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result_json JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, tool_call_id)
);

CREATE TABLE handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool_call_id UUID REFERENCES tool_calls(id) ON DELETE SET NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_current_agent ON sessions(current_agent);

CREATE INDEX idx_runs_session_created_at ON runs(session_id, created_at DESC);
CREATE INDEX idx_runs_parent_run_id ON runs(parent_run_id);
CREATE INDEX idx_runs_trace_id ON runs(trace_id);

CREATE UNIQUE INDEX idx_runs_single_running_per_session
  ON runs(session_id)
  WHERE status = 'running';

CREATE INDEX idx_messages_session_sequence ON messages(session_id, sequence);
CREATE INDEX idx_messages_run_sequence ON messages(run_id, sequence);
CREATE INDEX idx_messages_role ON messages(role);

CREATE INDEX idx_tool_calls_run_created_at ON tool_calls(run_id, created_at DESC);
CREATE INDEX idx_tool_calls_message_id ON tool_calls(message_id);
CREATE INDEX idx_tool_calls_name_status ON tool_calls(tool_name, status);

CREATE INDEX idx_handoffs_run_created_at ON handoffs(run_id, created_at DESC);
CREATE INDEX idx_handoffs_session_created_at ON handoffs(session_id, created_at DESC);
CREATE INDEX idx_handoffs_agents ON handoffs(from_agent, to_agent);

COMMENT ON TABLE sessions IS 'Top-level user-visible conversation/session.';
COMMENT ON COLUMN sessions.id IS 'Primary key for the conversation.';
COMMENT ON COLUMN sessions.user_id IS 'Optional business user identifier owning the session.';
COMMENT ON COLUMN sessions.status IS 'Conversation state, e.g. active, busy, archived, or error.';
COMMENT ON COLUMN sessions.current_agent IS 'Name of the agent currently owning the conversation after the latest handoff.';
COMMENT ON COLUMN sessions.metadata IS 'Arbitrary session-level metadata in JSON form.';
COMMENT ON COLUMN sessions.created_at IS 'Session creation timestamp.';
COMMENT ON COLUMN sessions.updated_at IS 'Last session update timestamp.';

COMMENT ON TABLE runs IS 'One execution turn within a session, usually triggered by a user message.';
COMMENT ON COLUMN runs.id IS 'Primary key for the execution run.';
COMMENT ON COLUMN runs.session_id IS 'Owning session for this run.';
COMMENT ON COLUMN runs.parent_run_id IS 'Optional parent run for nested execution trees or delegated runs.';
COMMENT ON COLUMN runs.trigger_message_id IS 'User message that triggered this run, when available.';
COMMENT ON COLUMN runs.agent_name IS 'Agent name actively executing this run.';
COMMENT ON COLUMN runs.status IS 'Run lifecycle state such as queued, running, completed, failed, or cancelled.';
COMMENT ON COLUMN runs.trace_id IS 'Distributed tracing identifier for observability across systems.';
COMMENT ON COLUMN runs.input_summary IS 'Optional short summary of the run input.';
COMMENT ON COLUMN runs.output_summary IS 'Optional short summary of the run output.';
COMMENT ON COLUMN runs.error_message IS 'Failure reason if the run did not complete successfully.';
COMMENT ON COLUMN runs.started_at IS 'Timestamp when execution started.';
COMMENT ON COLUMN runs.finished_at IS 'Timestamp when execution finished.';
COMMENT ON COLUMN runs.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN runs.updated_at IS 'Row last update timestamp.';

COMMENT ON TABLE messages IS 'Conversation messages used as model context and user-visible history.';
COMMENT ON COLUMN messages.id IS 'Primary key for the message.';
COMMENT ON COLUMN messages.session_id IS 'Owning session for this message.';
COMMENT ON COLUMN messages.run_id IS 'Run that produced or consumed this message.';
COMMENT ON COLUMN messages.role IS 'Message role: system, user, assistant, or tool.';
COMMENT ON COLUMN messages.agent_name IS 'Agent responsible for this message, if applicable.';
COMMENT ON COLUMN messages.message_type IS 'Message subtype, e.g. normal message, tool result, or handoff summary.';
COMMENT ON COLUMN messages.content IS 'Text content stored in the conversation history.';
COMMENT ON COLUMN messages.sequence IS 'Monotonic sequence number within the session for deterministic replay.';
COMMENT ON COLUMN messages.created_at IS 'Message creation timestamp.';

COMMENT ON TABLE tool_calls IS 'Structured records of tool invocations made during a run.';
COMMENT ON COLUMN tool_calls.id IS 'Primary key for the tool call record.';
COMMENT ON COLUMN tool_calls.session_id IS 'Owning session for this tool call.';
COMMENT ON COLUMN tool_calls.run_id IS 'Run that issued this tool call.';
COMMENT ON COLUMN tool_calls.message_id IS 'Assistant message that declared the tool call.';
COMMENT ON COLUMN tool_calls.tool_call_id IS 'Model-provided tool call identifier used to match tool results.';
COMMENT ON COLUMN tool_calls.tool_name IS 'Invoked tool name.';
COMMENT ON COLUMN tool_calls.arguments_json IS 'Structured tool input arguments.';
COMMENT ON COLUMN tool_calls.status IS 'Tool call lifecycle state such as pending, running, completed, failed, or cancelled.';
COMMENT ON COLUMN tool_calls.result_json IS 'Structured tool result payload when execution succeeds.';
COMMENT ON COLUMN tool_calls.error_message IS 'Failure reason if tool execution fails.';
COMMENT ON COLUMN tool_calls.started_at IS 'Timestamp when tool execution started.';
COMMENT ON COLUMN tool_calls.finished_at IS 'Timestamp when tool execution finished.';
COMMENT ON COLUMN tool_calls.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN tool_calls.updated_at IS 'Row last update timestamp.';

COMMENT ON TABLE handoffs IS 'Agent-to-agent control transfer events within a run.';
COMMENT ON COLUMN handoffs.id IS 'Primary key for the handoff event.';
COMMENT ON COLUMN handoffs.session_id IS 'Owning session for the handoff.';
COMMENT ON COLUMN handoffs.run_id IS 'Run in which the handoff occurred.';
COMMENT ON COLUMN handoffs.tool_call_id IS 'Optional tool call record that implemented the handoff.';
COMMENT ON COLUMN handoffs.from_agent IS 'Agent transferring control away.';
COMMENT ON COLUMN handoffs.to_agent IS 'Agent receiving control.';
COMMENT ON COLUMN handoffs.reason IS 'Optional human-readable reason for the handoff.';
COMMENT ON COLUMN handoffs.payload IS 'Structured handoff metadata or routing payload.';
COMMENT ON COLUMN handoffs.created_at IS 'Handoff creation timestamp.';
