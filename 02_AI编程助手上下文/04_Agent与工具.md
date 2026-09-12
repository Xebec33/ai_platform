# Agent 与工具

## 1. Agent 定义

Agent 是 Workflow 中负责非确定性智能任务的执行单元。

Agent 可以：

* 理解自然语言；
* 推理；
* 规划；
* 分解任务；
* 生成内容；
* 生成代码；
* 分析测试结果；
* Review；
* 做出结构化判断。

Agent 不负责整个 Workflow 的控制。

---

## 2. Agent 抽象

建议：

```text
AgentConfig
    ↓
AgentExecutor
    ↓
ModelProvider
    ↓
LLM
```

AgentConfig 至少包括：

```text
id
name
description
model
systemPrompt
inputMapping
outputSchema
timeout
```

---

## 3. Agent Executor

Executor 统一负责：

```text
Input
 ↓
Prompt Construction
 ↓
LLM Call
 ↓
Output Parsing
 ↓
State Update
```

同时记录：

```text
token usage
latency
error
```

---

## 4. Agent Registry

使用：

```text
Agent Registry
```

统一管理 Agent。

例如：

```text
Planner
Coder
Tester
Reviewer
Fixer
Researcher
```

Workflow 不应该直接 import 某个具体 Agent 实现。

---

# Tool System

## 5. Tool 抽象

Tool 是 Agent 可以调用的外部能力。

统一抽象：

```text
Tool
├── name
├── description
├── inputSchema
├── execute()
└── metadata
```

---

## 6. Tool Registry

```text
Tool Registry
      │
      ├── File Read
      ├── File Write
      ├── Shell
      ├── Git
      ├── HTTP
      └── Search
```

Agent 通过 Registry 获取 Tool。

---

## 7. 第一阶段 Tool

优先：

```text
File Read
File Write
Shell
```

随后：

```text
Git
HTTP Request
Search
```

最后：

```text
Code Execution
```

---

## 8. File Tool

File Read：

```text
path
encoding
```

File Write：

```text
path
content
```

必须限制 Workspace。

Agent 不应该任意读取系统敏感文件。

---

## 9. Shell Tool

Shell Tool 必须考虑：

* timeout；
* working directory；
* stdout；
* stderr；
* exit code；
* resource limits。

禁止默认允许任意宿主机命令执行。

Coding Agent 应优先使用 Sandbox。

---

## 10. Git Tool

Git Tool 支持：

```text
clone
checkout
branch
status
diff
commit
```

最终可以支持：

```text
merge
```

推荐 Coding Agent 每个任务使用独立 workspace / branch。

---

## 11. HTTP Tool

HTTP Request Node 可以支持：

```text
URL
Method
Headers
Body
Timeout
```

例如：

```json
{
  "url": "https://example.com/api",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "query": "hello"
  }
}
```

需要考虑：

* timeout；
* response size；
* allowed domains；
* error handling。

---

## 12. Tool 与 Agent 的边界

Agent：

```text
决定做什么
```

Tool：

```text
真正执行操作
```

例如：

```text
Agent：
“我要读取 package.json”

↓

Tool：
File Read("package.json")
```

不要把所有操作都塞进 Agent Prompt。

---

## 13. Coding Agent

Coding Agent 是特殊 Agent。

它需要：

```text
Repository
Workspace
File System
Shell
Git
Test
```

推荐架构：

```text
CodingAgent Interface
       │
       ├── OpenHands
       └── OpenCode
```

---

## 14. Coding Agent Adapter

业务层只依赖：

```typescript
interface CodingAgent {
  run(task: CodingTask): Promise<CodingResult>
}
```

具体实现：

```text
OpenHandsAdapter
OpenCodeAdapter
```

这样未来替换 Coding Agent 时，不需要修改 Workflow Runtime。

---

## 15. Coding Agent 工作流程

```text
Requirement
 ↓
Coding Agent
 ↓
Read Repository
 ↓
Plan
 ↓
Modify Files
 ↓
Run Tests
 ↓
Inspect Git Diff
 ↓
Return Result
```

然后交给：

```text
Test Agent
 ↓
Reviewer Agent
```

---

## 16. Agent Output

Agent 尽量输出结构化结果。

例如 Reviewer：

```json
{
  "passed": false,
  "issues": [
    {
      "file": "src/http.ts",
      "line": 42,
      "description": "Missing timeout handling"
    }
  ]
}
```

然后 Condition Node 判断：

```text
passed == true
```

而不是让 Runtime 解析：

```text
“我认为代码大概没问题”
```

---

## 17. Agent Error

需要区分：

```text
LLM Error
Parsing Error
Tool Error
Timeout
Business Error
```

并交给 Runtime 统一处理。

---

## 18. 安全原则

Agent 和 Tool 必须遵循最小权限原则。

特别是：

* Shell；
* File System；
* Git；
* HTTP；
* Code Execution；

不能默认拥有无限权限。

Coding Agent 的执行环境应优先位于 Docker Sandbox。
