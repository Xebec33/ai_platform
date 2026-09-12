# 工作流 DSL

## 1. 目标

Workflow DSL 是前端 Workflow Graph 与后端 Runtime 之间的稳定协议。

核心流程：

```text
Vue Flow
 ↓
Workflow DSL
 ↓
Validation
 ↓
Compilation
 ↓
LangGraph
```

DSL 不应直接绑定 Vue Flow 的内部实现。

---

## 2. Workflow 基础结构

概念结构：

```json
{
  "id": "workflow-001",
  "name": "Demo Workflow",
  "version": 1,
  "nodes": [],
  "edges": [],
  "variables": {}
}
```

---

## 3. Node

Node 至少包含：

```json
{
  "id": "agent-1",
  "type": "agent",
  "name": "Research Agent",
  "config": {}
}
```

Node 的 `type` 用于确定其 Runtime 行为。

---

## 4. Edge

```json
{
  "id": "edge-1",
  "source": "agent-1",
  "target": "agent-2"
}
```

Condition Node 可以增加：

```json
{
  "source": "condition-1",
  "target": "agent-a",
  "condition": "result == true"
}
```

---

## 5. Node 类型

P0：

```text
start
agent
condition
end
```

P1：

```text
parallel
loop
tool
```

后续：

```text
http
file-read
file-write
shell
git
code-execution
search
human-approval
delay
```

---

## 6. Agent Node

示例：

```json
{
  "id": "agent-1",
  "type": "agent",
  "name": "Research Agent",
  "config": {
    "model": "xxx",
    "systemPrompt": "You are a research agent.",
    "input": "{{variables.query}}",
    "outputKey": "researchResult"
  }
}
```

Agent Node 不应该直接保存 Provider 的复杂内部配置。

---

## 7. Condition Node

Condition 用于确定性路由。

例如：

```text
result.score >= 0.8
```

Condition 的执行不应该依赖 LLM。

如果需要 LLM 判断，应使用 Agent Node 输出结构化结果，再由 Condition Node 判断。

例如：

```text
Agent
 ↓
{
  "passed": false
}
 ↓
Condition
 ├── true
 └── false
```

---

## 8. Parallel Node

Parallel 表示多个可以同时执行的分支。

```text
        ┌→ Agent A ─┐
Start ──┼→ Agent B ─┼→ Merge
        └→ Agent C ─┘
```

Runtime 负责：

* 创建并发任务；
* 等待任务完成；
* 收集结果；
* 处理失败。

---

## 9. Loop Node

Loop 必须明确：

```json
{
  "type": "loop",
  "config": {
    "maxIterations": 5,
    "stopCondition": "state.passed == true"
  }
}
```

Loop 至少支持：

* maxIterations；
* stopCondition；
* retry；
* timeout。

---

## 10. Variable

Workflow Variables 用于共享状态。

例如：

```json
{
  "variables": {
    "query": "分析销售数据",
    "maxRetries": 3
  }
}
```

Node 可以读取：

```text
{{variables.query}}
```

Node Output 可以写入：

```text
researchResult
```

---

## 11. Input / Output Mapping

Node 应明确：

```text
input
output
outputKey
```

例如：

```json
{
  "input": {
    "query": "{{variables.query}}"
  },
  "outputKey": "result"
}
```

后续 Node：

```text
{{nodes.agent-1.output}}
```

具体表达式语法由实现确定，但必须保持全项目一致。

---

## 12. DSL Validation

Validator 至少检查：

### Graph

* 是否存在 Start；
* 是否存在 End；
* Node ID 是否重复；
* Edge source 是否存在；
* Edge target 是否存在；
* 是否存在非法连接。

### Node

* type 是否合法；
* config 是否完整；
* Agent 是否存在必要配置；
* Loop 是否存在 maxIterations；
* Condition 是否存在条件表达式。

### Workflow

* 是否存在不可达节点；
* 是否存在明显非法环；
* 是否存在多个 Start；
* 是否存在无法到达 End 的路径。

---

## 13. Compiler

Compiler：

```text
Workflow DSL
      ↓
Build Graph
      ↓
Create LangGraph Nodes
      ↓
Create Edges
      ↓
Create Conditional Edges
      ↓
Compile
```

Compiler 不应该承担：

* LLM 推理；
* 数据库存储；
* HTTP API；
* UI 逻辑。

---

## 14. DSL 版本

DSL 必须支持：

```text
version
```

例如：

```json
{
  "version": 1
}
```

未来 DSL 变化时应考虑：

```text
v1 → v2
```

而不是直接破坏旧 Workflow。

---

## 15. DSL 与 UI 解耦

不要把以下字段直接当成 Runtime DSL：

```text
position
selected
dragging
style
width
height
```

这些是 UI 状态。

Runtime DSL 应只保存业务语义：

```text
Node
Edge
Config
Variable
Input
Output
Condition
Loop
```

---

## 16. 示例 Workflow

```json
{
  "id": "loop-demo",
  "name": "Coding Review Loop",
  "version": 1,
  "nodes": [
    {
      "id": "start",
      "type": "start"
    },
    {
      "id": "coder",
      "type": "agent",
      "name": "Coder"
    },
    {
      "id": "test",
      "type": "agent",
      "name": "Tester"
    },
    {
      "id": "review",
      "type": "agent",
      "name": "Reviewer"
    },
    {
      "id": "condition",
      "type": "condition",
      "config": {
        "expression": "review.passed == true"
      }
    },
    {
      "id": "end",
      "type": "end"
    }
  ],
  "edges": [
    {
      "source": "start",
      "target": "coder"
    },
    {
      "source": "coder",
      "target": "test"
    },
    {
      "source": "test",
      "target": "review"
    },
    {
      "source": "review",
      "target": "condition"
    },
    {
      "source": "condition",
      "target": "end",
      "condition": "true"
    },
    {
      "source": "condition",
      "target": "coder",
      "condition": "false"
    }
  ]
}
```

---

## 17. 核心原则

Workflow DSL 必须：

* 可验证；
* 可序列化；
* 可持久化；
* 可版本化；
* 与 UI 解耦；
* 与 LangGraph 解耦；
* 能够表达 Multi-Agent；
* 能够表达 Loop。
