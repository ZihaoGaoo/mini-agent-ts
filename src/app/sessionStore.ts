import { Message } from "../schema";

export interface SessionSnapshot {
  id: string;
  workspaceDir: string;
  messages: Message[];
  totalTokens: number;
}

export interface SessionStore {
  load(id: string): Promise<SessionSnapshot | null>;
  save(session: SessionSnapshot): Promise<void>;
  delete(id: string): Promise<void>;
}

function cloneSession(session: SessionSnapshot): SessionSnapshot {
  return {
    id: session.id,
    workspaceDir: session.workspaceDir,
    messages: JSON.parse(JSON.stringify(session.messages)),
    totalTokens: session.totalTokens
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionSnapshot>();

  async load(id: string): Promise<SessionSnapshot | null> {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : null;
  }

  async save(session: SessionSnapshot): Promise<void> {
    this.sessions.set(session.id, cloneSession(session));
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}
