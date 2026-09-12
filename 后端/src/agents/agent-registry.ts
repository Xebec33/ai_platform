import type { AgentExecutorLike } from './agent.js';

export class AgentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRegistryError';
  }
}

export class AgentRegistry {
  private readonly executors = new Map<string, AgentExecutorLike>();

  constructor(entries: ReadonlyArray<readonly [string, AgentExecutorLike]> = []) {
    for (const [id, executor] of entries) this.register(id, executor);
  }

  register(id: string, executor: AgentExecutorLike): this {
    if (!id.trim()) throw new AgentRegistryError('Agent ID 不能为空');
    if (this.executors.has(id)) throw new AgentRegistryError('Agent 已注册：' + id);
    this.executors.set(id, executor);
    return this;
  }

  get(id: string): AgentExecutorLike | undefined {
    return this.executors.get(id);
  }

  resolve(id: string): AgentExecutorLike | undefined {
    return this.get(id);
  }

  list(): string[] {
    return [...this.executors.keys()];
  }
}
