# AI Workflow Platform — 项目交接文档

> 本文档面向接手开发的 AI 编程助手（Claude Code），旨在一次性传递项目全貌、当前状态和后续工作。

---

## 1. 项目背景与目标

本项目用于完成腾讯 AI 全栈日常实习面试任务。

### 基础要求

实现一套支持 **多 Agent 编排** 和 **Loop Engineering** 的 AI 工作流平台。

### 进阶要求

基于该平台搭建一条能够 **自举开发平台自身** 的工作流——即平台通过自身的 Agent 工作流完成对自身的功能开发。

### 最终交付物

三个可演示的 Demo：

| Demo | 名称 | 核心展示点 |
|------|------|-----------|
| Demo 1 | 智能客服工单分流 | 多 Agent + 条件分支 + 工具调用 |
| Demo 2 | 订单异常诊断与处理 | 条件嵌套 + Agent 分析 + 自动/人工分流 |
| Demo 3 | 文档智能处理与质量检查 | 文件工具 + Agent 结构化输出 + 条件修复 + 摘要 |

> 另需一个 **自举开发 Demo**：平台通过自身工作流完成新功能开发（如 HTTP Request Node）。

---

## 2. 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + TypeScript + Vite + Vue Flow + Pinia |
| 后端 | Node.js + TypeScript + Fastify |
| 工作流运行时 | 自定义 DSL → Compiler → 自研 Runtime（支持 Loop/Condition/Tool） |
| 大模型接入 | OpenAI-compatible Provider（支持 DeepSeek API） |
| 数据库 | PostgreSQL（可选，未配置时降级为内存模式） |
| 任务队列 | 自研 PostgresJobQueue（基于 PostgreSQL 的 Job Queue） |
| 沙箱 | Docker（Coding Agent 执行环境） |
| 测试 | Vitest |

> **注意**：项目最初计划使用 LangGraph.js，但实际实现中采用了自研 Workflow Runtime，而非 LangGraph。Runtime 代码位于 `后端/src/workflow/runtime/runtime.ts`。

---

## 3. 项目目录结构

```
AI_Workflow_Platform/
├── 01_用户指南/              # 项目总览、开发路线、检查清单、测试与验收
├── 02_AI编程助手上下文/       # 架构、DSL、运行时、Agent、自举开发、开发规则
├── 共享类型/                  # 前后端共享的 DSL 类型定义与验证器
│   └── src/
│       ├── workflow.ts          # 核心 DSL 类型 + UI↔DSL 转换
│       ├── workflow-demos.ts    # 三个 Demo 工作流定义
│       ├── workflow-validator.ts # DSL 校验器
│       └── workflow-schema.ts   # JSON Schema
├── 前端/                     # Vue 3 前端
│   └── src/
│       ├── components/workflow/WorkflowEditor.vue  # 工作流编辑器
│       ├── components/nodes/WorkflowNode.vue       # 节点组件
│       ├── components/monitor/RunMonitor.vue       # 运行监控
│       ├── editor/workflow-graph.ts                # 图操作工具
│       ├── stores/workflow-editor.ts               # Pinia 状态管理
│       └── api/                                    # 后端 API 调用
├── 后端/                     # Node.js 后端
│   └── src/
│       ├── workflow/runtime/runtime.ts   # 核心 Runtime（含 Loop/Condition/Tool 执行）
│       ├── workflow/runtime/loop.ts      # Loop 条件求值
│       ├── agents/                       # Agent 执行器 + Model Provider
│       ├── tools/                        # 工具系统（file/shell/git/http/search/demo-fixture）
│       ├── self-development/             # 自举开发编排器
│       ├── persistence/                  # PostgreSQL 持久化
│       ├── queue/                        # 异步任务队列
│       ├── sandbox/                      # Docker 沙箱
│       ├── coding-agent/                 # Coding Agent 适配器
│       ├── api/routes/                   # API 路由
│       └── server.ts                     # 入口
├── Docker/                   # Docker 部署配置
├── 开源参考/                 # LangGraph/Dify/OpenHands/OpenCode 等参考代码
└── 文档/                     # 设计决策、问题记录
```

---

## 4. 核心架构

### 4.1 数据流

```
Vue Flow (UI) → Serializer → Workflow DSL → Validator → Runtime → 执行
     ↑                                                          ↓
     └──────────── SSE 事件流 ← EventSink ← Runtime ←──────────┘
```

### 4.2 Workflow DSL 核心类型

**文件**: `共享类型/src/workflow.ts`

```typescript
// 节点类型
type WorkflowNodeType = 'start' | 'agent' | 'condition' | 'tool' | 'loop' | 'end';

// Start 节点配置（支持动态输入参数）
interface StartConfig {
  inputParameters: WorkflowParameterDefinition[];
  description?: string;
}

// Agent 节点配置
interface AgentConfig {
  model: string;
  systemPrompt: string;
  outputFormat?: 'text' | 'json';
  outputFields?: AgentOutputField[];  // 结构化输出字段（含 description）
  mockOutput?: JsonObject;
  temperature?: number;
  maxTokens?: number;
  input?: JsonValue;
  outputKey?: string;
}

// Condition 节点配置
interface ConditionConfig {
  expression: string;
  parameter?: string;
  relation?: 'equals' | 'not_equals' | 'greater_than' | ...;
  comparisonValue?: JsonValue;
}

// Tool 节点配置（工具节点本身即工具，无工具选择框）
interface ToolConfig {
  toolName: string;
  input?: JsonObject;
  outputKey?: string;
}

// Loop 节点配置
interface LoopConfig {
  maxIterations: number;
  stopCondition: string;
  retry?: number;
  timeout?: number;
  bodyNodeId?: string;
  exitNodeId?: string;
}
```

### 4.3 DSL 校验规则

**文件**: `共享类型/src/workflow-validator.ts`

校验器检查：
- 必须有且仅有一个 Start 节点
- **必须有且仅有一个 End 节点**（`MULTIPLE_END` 检查，所有分支汇聚到唯一 End）
- 节点 ID 唯一、边 ID 唯一
- 边的 source/target 必须存在
- 不可自环
- 所有节点必须从 Start 可达
- 所有节点必须能到达 End
- Start 必须包含系统参数 `inputs`（必填 string，`system: true`）
- Agent 必须有 model 和 systemPrompt
- Condition 必须有 expression
- Tool 必须有 toolName
- Loop 必须有正整数 maxIterations 和 stopCondition

### 4.4 Runtime 执行流程

**文件**: `后端/src/workflow/runtime/runtime.ts`

Runtime 负责：
1. 从 Start 节点开始顺序执行
2. 按节点类型分发执行（start/agent/condition/tool/loop/end）
3. Agent 执行：构建 context → 调用 AgentExecutor → 获取输出 → 写入 variables
4. Tool 执行：通过 ToolRegistry 执行工具 → 输出写入 variables
5. Condition 执行：求值表达式 → 选择 true/false 分支
6. Loop 执行：迭代 body → 检查 stopCondition → 超过 maxIterations 则 FAILED
7. 状态持久化：每个节点执行后持久化 run state
8. 事件发射：NODE_STARTED/NODE_COMPLETED/LOOP_ITERATION 等
9. 错误处理：Agent 超时、重试、取消
10. Checkpoint：Loop 每次迭代保存 checkpoint

### 4.5 Agent 系统

**文件**: `后端/src/agents/`

- `agent-executor.ts`: 默认 Agent 执行器，构建 prompt → 调用 ModelProvider → 解析输出
- `model-provider.ts`: ModelProvider 接口 + MockModelProvider + Provider Registry
- `openai-compatible-provider.ts`: OpenAI 兼容 API 实现（支持 DeepSeek）

**环境变量配置**（`后端/.env`）:
```
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
```

> 测试环境（`NODE_ENV=test`）强制使用 Mock Provider，不访问外部 API。

### 4.6 工具系统

**文件**: `后端/src/tools/`

已实现的工具：
| 工具名 | 文件 | 功能 |
|--------|------|------|
| `file_read` | `tools/file/` | 读取 workspace 内文本文件 |
| `file_write` | `tools/file/` | 写入 workspace 内文本文件 |
| `shell` | `tools/shell/` | 执行受限 workspace 命令 |
| `git` | `tools/git/` | Git status/diff/commit |
| `http_request` | `tools/http/` | HTTP 请求 |
| `search` | `tools/search/` | 内容搜索 |
| `demo_fixture` | `tools/demo-fixture.ts` | Demo 专用 Mock 工具（模拟订单查询、工单创建等） |

### 4.7 API 路由

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/workflows/demos` | 列出所有 Demo |
| GET | `/workflows/demos/:demoId` | 获取指定 Demo |
| GET | `/workflows/mock-self-development` | 获取 Mock 自举开发工作流 |
| POST | `/workflows` | 保存工作流（需持久化） |
| GET | `/workflows/:workflowId` | 获取工作流 |
| POST | `/workflows/run` | 运行工作流（同步或异步） |
| GET | `/runs` | 列出运行记录 |
| GET | `/runs/:runId` | 获取运行详情 |
| GET | `/runs/:runId/job` | 获取运行对应的 Job |
| POST | `/runs/:runId/cancel` | 取消运行 |
| GET | `/runs/:runId/events` | SSE 事件流 |

---

## 5. 三个 Demo 工作流

**文件**: `共享类型/src/workflow-demos.ts`

所有 Demo 统一使用 `end-1` 作为唯一结束节点，所有分支汇聚到该节点。

### Demo 1: 智能客服工单分流 (`demo-ticket-routing`)

```
Start → 识别工单类型 → 是否需要人工?
  ├── true  → 发送紧急告警 → 分配人工客服 → End
  └── false → 生成标准回复 → 创建普通工单 → End
```

输入: `userId`(必填), `message`(必填), `orderId`(可选)
Agent: 使用 `deepseek-chat`，JSON 输出
工具: `demo_fixture`（模拟告警和工单创建）

### Demo 2: 订单异常诊断与处理 (`demo-order-diagnosis`)

```
Start → 查询订单 → 订单是否异常?
  ├── false → 生成订单状态说明 → End
  └── true  → 分析异常原因 → 是否可自动处理?
              ├── true  → 重新触发履约 → 生成处理结果 → End
              └── false → 创建人工工单 → End
```

输入: `orderId`(必填)
Agent: 使用 `deepseek-chat`，JSON 输出
工具: `demo_fixture`（模拟订单查询、履约重试、工单创建）

### Demo 3: 文档智能处理与质量检查 (`demo-document-quality`)

```
Start → 读取文档 → 提取文档结构 → 检查内容质量 → 是否存在严重问题?
  ├── true  → 生成修改建议 → 生成修改稿 → 保存修改稿 → End
  └── false → 生成摘要和标签 → End
```

输入: `filePath`(必填), `documentType`(可选), `outputFile`(可选)
**路径为 workspace 内相对路径**（如 `input/requirement.txt`），Agent 只能操控工作空间内文件。
工具: `file_read`, `file_write`

---

## 6. 自举开发

**文件**: `后端/src/self-development/`

- `orchestrator.ts`: 编排器，创建会话 → 运行自举工作流 → 合并代码
- `workflow.ts`: 自举开发工作流定义（需求分析 → 任务拆解 → Coding → 测试 → Review → Fix Loop）
- `session.ts`: 开发会话管理（创建 workspace、branch）
- `mock-workflow.ts`: Mock 版本自举工作流（验证流程闭环）

自举开发流程：
```
用户提出需求 → 需求分析 Agent → 任务拆解 Agent
  → Frontend Agent + Backend Agent（可并行）
  → Test Agent → Reviewer Agent
  → Pass?
     ├── Yes → Git Commit → 合并 → 完成
     └── No  → Fix Agent → Test → Reviewer → Loop
```

> 当前自举开发已有 Mock 流程验证，真实 Coding Agent 接入需配合 Docker Sandbox。

---

## 7. 当前代码状态

### 7.1 已完成

- [x] Workflow DSL 类型定义（`workflow.ts`）
- [x] DSL 校验器（含 `MULTIPLE_END` 检查）
- [x] UI ↔ DSL 双向转换
- [x] Workflow Runtime（支持 start/agent/condition/tool/loop/end）
- [x] Loop Engineering（迭代、maxIterations、stopCondition、retry、timeout、checkpoint）
- [x] Agent 执行器 + Model Provider（Mock + OpenAI-compatible/DeepSeek）
- [x] 工具系统（file_read/file_write/shell/git/http/search/demo_fixture）
- [x] PostgreSQL 持久化（可选，降级为内存模式）
- [x] Postgres Job Queue + Worker
- [x] SSE 事件流
- [x] 前端工作流编辑器（Vue Flow + 节点配置面板）
- [x] 运行监控面板
- [x] 三个 Demo 工作流定义
- [x] Start 节点动态输入参数配置（含 `inputs` 系统参数）
- [x] 工具节点移除工具选择框（工具节点本身即工具）
- [x] 所有参数增加 description 字段
- [x] Demo 路径改为 workspace 相对路径
- [x] 自举开发 Mock 流程

### 7.2 已知问题

1. **前端测试 happy-dom 缺失**: 运行 `vitest` 时报 `ERR_MODULE_NOT_FOUND`（happy-dom）。需在前端安装 `happy-dom` 开发依赖：
   ```bash
   cd 前端 && npm install -D happy-dom
   ```

2. **app.ts 路由未注册**: 当前 `后端/src/app.ts` 只注册了 `/health` 路由。`registerWorkflowRoutes` 和 `registerRunRoutes` 已实现但未在 app.ts 中调用。需要补充：
   ```typescript
   // app.ts 中需添加
   await registerWorkflowRoutes(app, { ... });
   await registerRunRoutes(app, { ... });
   ```

3. **自举开发真实接入未完成**: Mock 流程已验证，但真实 Coding Agent + Docker Sandbox 的端到端流程未完成。

4. **三个 Demo 的真实模型端到端验证未完成**: Demo 定义已修正（统一 end-1、相对路径等），但尚未使用真实 DeepSeek API 完整跑通。

### 7.3 待完成工作

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | 修复 `app.ts` 路由注册 | 确保 `/workflows/*` 和 `/runs/*` 路由可用 |
| P0 | 修复前端 happy-dom 依赖 | `cd 前端 && npm install -D happy-dom` |
| P0 | 三个 Demo 端到端验证 | 启动后端（配置 DeepSeek API），依次运行三个 Demo |
| P1 | 自举开发真实接入 | 接入真实 Coding Agent + Docker Sandbox |
| P1 | 前端 UI 优化 | 节点上下游接点改为左右分布（用户要求：上游左侧、下游右侧） |
| P2 | Loop Engineering Demo | 构建含 Loop 的演示工作流 |
| P2 | 云端部署 | Docker Compose 部署 |

---

## 8. 开发命令

```bash
# 安装依赖（根目录）
npm install

# 构建共享类型（前后端依赖）
npm run build --workspace=@ai-workflow/shared-types

# 开发模式（同时启动前后端）
npm run dev

# 仅后端
npm run dev --workspace=@ai-workflow/backend

# 仅前端
npm run dev --workspace=@ai-workflow/frontend

# TypeScript 类型检查
npm run typecheck

# Lint
npm run lint

# 全部测试
npm run test

# 后端测试（NODE_ENV=test，使用 Mock Provider）
npm run test --workspace=@ai-workflow/backend

# 前端测试
npm run test --workspace=@ai-workflow/frontend

# 共享类型测试
npm run test --workspace=@ai-workflow/shared-types
```

### 环境变量

后端 `后端/.env`:
```
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
# DATABASE_URL=postgresql://user:pass@localhost:5432/workflow  # 可选
# PORT=3000
# HOST=0.0.0.0
```

---

## 9. 开发规则摘要

> 完整规则见 `02_AI编程助手上下文/06_开发规则.md`

1. **修改前先阅读**：任何非 trivial 修改前，先阅读相关文件、搜索相关代码、理解调用关系
2. **修改后验证**：TypeScript 检查 → Lint → 单元测试 → 集成测试
3. **不删测试**：测试失败时定位根因并修复代码，不删除或降低测试标准
4. **架构边界**：不擅自更换技术栈、删除核心模块、将 Agent 与 Runtime 强耦合
5. **不过度设计**：优先简单、稳定、可测试、可扩展
6. **优先修改现有文件**：只在必要时创建新文件
7. **不擅自重构**：发现架构问题先提出方案，等待确认
8. **Git 原则**：每完成一个稳定阶段提交，不堆砌不相关修改
9. **优先级**：正确性 > 架构一致性 > 可测试性 > 可维护性 > 功能数量 > 简洁 > 性能

### 不允许的架构变化

- 将 Backend 改成 Python
- 用 Dify Backend 替换 Node Backend
- 用 LangGraph 取代自己的 DSL
- 删除 Workflow Runtime
- 让 Agent Prompt 直接控制整个流程
- 删除 PostgreSQL 状态持久化
- 删除 Loop Engine
- 将 Coding Agent 与核心 Runtime 强耦合

---

## 10. 关键设计决策

1. **自研 Runtime 而非直接使用 LangGraph**：项目原始计划使用 LangGraph.js，但实际实现中采用了自研 Workflow Runtime，以更好地控制 Loop/Condition/State 逻辑。LangGraph 仍作为参考。

2. **DSL 与 UI 解耦**：Vue Flow 的 position/selected/dragging 等 UI 状态不进入 Runtime DSL，通过 `uiGraphToWorkflow` / `workflowToUiGraph` 转换。

3. **Provider 从环境变量推断**：通过 `MODEL_PROVIDER` 环境变量控制是否启用真实 API。测试环境强制 Mock。

4. **PostgreSQL 可选**：未配置 `DATABASE_URL` 时，系统以内存模式运行（不持久化），适合开发和测试。

5. **PostgresJobQueue 替代 Redis/BullMQ**：为简化部署，使用 PostgreSQL 实现的 Job Queue 替代 Redis + BullMQ。

6. **Demo 使用 `demo_fixture` 工具**：Demo 1 和 Demo 2 中的订单查询、工单创建等操作使用 `demo_fixture` Mock 工具，避免依赖真实业务系统。

---

## 11. 接手后的建议工作顺序

1. **修复 `app.ts`**：注册 workflow 和 runs 路由，确保 API 可用
2. **安装 happy-dom**：修复前端测试
3. **验证 Demo**：配置 DeepSeek API key，运行三个 Demo 确保端到端跑通
4. **前端 UI 优化**：将节点上下游接点改为左右分布
5. **构建 Loop Demo**：创建一个展示 Loop Engineering 的 Demo（首次失败 → Fix → 通过）
6. **自举开发真实接入**：配合 Docker Sandbox 接入真实 Coding Agent
7. **最终演示准备**：确保所有 Demo 可在演示环境中运行
