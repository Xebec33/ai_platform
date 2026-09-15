import type { AgentOutputField, JsonObject, WorkflowDefinition } from './workflow.js';

const llmAgent = (
  id: string,
  name: string,
  outputKey: string,
  fields: AgentOutputField[],
  input?: unknown,
  instruction = '',
): WorkflowDefinition['nodes'][number] => ({
  id,
  type: 'agent',
  name,
  config: {
    model: 'deepseek-chat',
    provider: 'deepseek',
    systemPrompt: `你是${name}。${instruction}只输出符合 JSON Schema 的 JSON 对象，不要输出 Markdown、解释或前后缀。`,
    outputFormat: 'json',
    outputFields: fields,
    outputSchema: {
      type: 'object',
      properties: Object.fromEntries(fields.map((field) => [field.name, { type: field.type }])),
    } as JsonObject,
    outputKey,
    ...(input === undefined ? {} : { input: input as never }),
  },
});

const field = (name: string, type: AgentOutputField['type']): AgentOutputField => ({ name, type });

const ticketAnalysisFields = [
  field('category', 'string'), field('subCategory', 'string'), field('priority', 'string'),
  field('assignedTeam', 'string'), field('needsHuman', 'boolean'), field('reason', 'string'),
];
const ticketReplyFields = [field('reply', 'string'), field('suggestedAction', 'string')];
const orderStatusFields = [field('message', 'string'), field('action', 'string')];
const orderAnalysisFields = [
  field('reason', 'string'), field('severity', 'string'), field('canAutoFix', 'boolean'), field('suggestedAction', 'string'),
];
const documentStructureFields = [field('title', 'string'), field('sections', 'array'), field('keyEntities', 'array')];
const qualityCheckFields = [field('passed', 'boolean'), field('severity', 'string'), field('issues', 'array')];
const qualityOutputInstruction = '如果文档问题严重，passed 必须为 false；只有明确没有严重问题时才为 true。';
const recommendationFields = [field('changes', 'array')];
const revisionFields = [field('revisedDocument', 'string'), field('changes', 'array')];
const summaryFields = [field('summary', 'string'), field('tags', 'array')];

const tool = (
  id: string,
  name: string,
  toolName: string,
  input: Record<string, unknown>,
  outputKey?: string,
): WorkflowDefinition['nodes'][number] => ({
  id,
  type: 'tool',
  name,
  config: {
    toolName,
    input: input as never,
    ...(outputKey ? { outputKey } : {}),
  },
});

export const ticketRoutingDemo: WorkflowDefinition = {
  id: 'demo-ticket-routing',
  name: 'Demo｜智能客服工单分流',
  version: 1,
  variables: {},
  inputs: [
    { name: 'userId', label: '用户 ID', type: 'string', required: true, defaultValue: 'u-1001' },
    { name: 'message', label: '客服问题', type: 'string', required: true, defaultValue: '我的订单什么时候发货？' },
    { name: 'orderId', label: '订单号', type: 'string', required: false, defaultValue: 'ORD-8829' },
  ],
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      name: '接收工单',
      config: {
        inputParameters: [
          { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
          { name: 'userId', type: 'string', required: true, description: '提交工单的用户标识。' },
          { name: 'message', type: 'string', required: true, description: '用户提交的客服问题。' },
          { name: 'orderId', type: 'string', required: false, description: '关联订单号，可选。' },
        ],
      },
    },
    llmAgent('classify-ticket', '识别工单类型和紧急程度', 'ticketAnalysis', ticketAnalysisFields, {
      userId: '{{variables.userId}}',
      message: '{{variables.message}}',
      orderId: '{{variables.orderId}}',
    }, 'priority 字段只能取 "high"、"medium" 或 "low"，不要输出中文。'),
    {
      id: 'ticket-urgent',
      type: 'condition',
      name: '是否需要人工优先处理',
      config: {
        parameter: 'variables.ticketAnalysis.priority',
        relation: 'equals',
        comparisonValue: 'high',
        expression: 'variables.ticketAnalysis.priority === "high"',
      },
    },
    tool(
      'send-alert',
      '发送紧急告警',
      'demo_fixture',
      { operation: 'send_alert', message: '{{variables.message}}', userId: '{{variables.userId}}' },
      'alertResult',
    ),
    tool(
      'create-human-ticket',
      '分配人工客服',
      'demo_fixture',
      {
        operation: 'create_ticket',
        kind: 'human',
        userId: '{{variables.userId}}',
        orderId: '{{variables.orderId}}',
        category: '{{variables.ticketAnalysis.category}}',
        priority: '{{variables.ticketAnalysis.priority}}',
        assignedTeam: '{{variables.ticketAnalysis.assignedTeam}}',
        reply: '您的问题已转交人工客服处理。',
      },
      'ticketResult',
    ),
    llmAgent('standard-reply', '生成标准回复', 'replyResult', ticketReplyFields, {
      message: '{{variables.message}}',
      analysis: '{{variables.ticketAnalysis}}',
    }),
    tool(
      'create-normal-ticket',
      '创建普通工单',
      'demo_fixture',
      {
        operation: 'create_ticket',
        kind: 'normal',
        userId: '{{variables.userId}}',
        orderId: '{{variables.orderId}}',
        category: '{{variables.ticketAnalysis.category}}',
        priority: '{{variables.ticketAnalysis.priority}}',
        assignedTeam: '{{variables.ticketAnalysis.assignedTeam}}',
        reply: '{{variables.replyResult.reply}}',
      },
      'ticketResult',
    ),
    { id: 'end-1', type: 'end', name: '工单分流完成', config: {} },
  ],
  edges: [
    { id: 'ticket-start-classify', source: 'start-1', target: 'classify-ticket' },
    { id: 'ticket-classify-condition', source: 'classify-ticket', target: 'ticket-urgent' },
    { id: 'ticket-urgent-alert', source: 'ticket-urgent', target: 'send-alert', condition: 'true' },
    { id: 'ticket-alert-human', source: 'send-alert', target: 'create-human-ticket' },
    { id: 'ticket-human-end', source: 'create-human-ticket', target: 'end-1' },
    { id: 'ticket-normal-reply', source: 'ticket-urgent', target: 'standard-reply', condition: 'false' },
    { id: 'ticket-reply-normal', source: 'standard-reply', target: 'create-normal-ticket' },
    { id: 'ticket-normal-end', source: 'create-normal-ticket', target: 'end-1' },
  ],
};

export const orderDiagnosisDemo: WorkflowDefinition = {
  id: 'demo-order-diagnosis',
  name: 'Demo｜订单异常诊断与处理',
  version: 1,
  variables: {},
  inputs: [{ name: 'orderId', label: '订单号', type: 'string', required: true, defaultValue: 'ORD-8829' }],
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      name: '接收订单号',
      config: {
        inputParameters: [
          { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
          { name: 'orderId', type: 'string', required: true, description: '待诊断的订单号。' },
        ],
      },
    },
    tool('lookup-order', '查询订单信息', 'demo_fixture', {
      operation: 'get_order',
      orderId: '{{variables.orderId}}',
    }, 'orderInfo'),
    {
      id: 'order-abnormal',
      type: 'condition',
      name: '订单是否异常',
      config: {
        parameter: 'variables.orderInfo.shippingStatus',
        relation: 'equals',
        comparisonValue: 'NOT_SHIPPED',
        expression: 'variables.orderInfo.shippingStatus === "NOT_SHIPPED"',
      },
    },
    llmAgent('normal-order-status', '生成订单状态说明', 'orderResult', orderStatusFields, {
      orderId: '{{variables.orderId}}',
      order: '{{variables.orderInfo}}',
    }),
    llmAgent('analyze-order', '分析订单异常原因', 'orderAnalysis', orderAnalysisFields, {
      orderId: '{{variables.orderId}}',
      order: '{{variables.orderInfo}}',
    }),
    {
      id: 'can-auto-fix',
      type: 'condition',
      name: '是否可以自动处理',
      config: {
        parameter: 'variables.orderAnalysis.canAutoFix',
        relation: 'equals',
        comparisonValue: true,
        expression: 'variables.orderAnalysis.canAutoFix === true',
      },
    },
    tool('retry-fulfillment', '重新触发履约任务', 'demo_fixture', {
      operation: 'retry_fulfillment',
      orderId: '{{variables.orderId}}',
    }, 'retryResult'),
    llmAgent('order-success-result', '生成自动处理结果', 'orderResult', orderStatusFields, {
      orderId: '{{variables.orderId}}',
      analysis: '{{variables.orderAnalysis}}',
      retry: '{{variables.retryResult}}',
    }),
    tool('create-order-ticket', '创建人工处理工单', 'demo_fixture', {
      operation: 'create_ticket',
      kind: 'order_manual',
      orderId: '{{variables.orderId}}',
      category: '订单异常',
      priority: '{{variables.orderAnalysis.severity}}',
      reply: '{{variables.orderAnalysis.suggestedAction}}',
    }, 'orderTicket'),
    { id: 'end-1', type: 'end', name: '订单诊断完成', config: {} },
  ],
  edges: [
    { id: 'order-start-lookup', source: 'start-1', target: 'lookup-order' },
    { id: 'order-lookup-condition', source: 'lookup-order', target: 'order-abnormal' },
    { id: 'order-normal-status', source: 'order-abnormal', target: 'normal-order-status', condition: 'false' },
    { id: 'order-status-end', source: 'normal-order-status', target: 'end-1' },
    { id: 'order-abnormal-analysis', source: 'order-abnormal', target: 'analyze-order', condition: 'true' },
    { id: 'order-analysis-condition', source: 'analyze-order', target: 'can-auto-fix' },
    { id: 'order-auto-retry', source: 'can-auto-fix', target: 'retry-fulfillment', condition: 'true' },
    { id: 'order-retry-result', source: 'retry-fulfillment', target: 'order-success-result' },
    { id: 'order-success-end', source: 'order-success-result', target: 'end-1' },
    { id: 'order-manual-ticket', source: 'can-auto-fix', target: 'create-order-ticket', condition: 'false' },
    { id: 'order-manual-end', source: 'create-order-ticket', target: 'end-1' },
  ],
};

export const documentQualityDemo: WorkflowDefinition = {
  id: 'demo-document-quality',
  name: 'Demo｜文档智能处理与质量检查',
  version: 1,
  variables: { outputFile: 'output/revised-requirement.txt' },
  inputs: [
    { name: 'filePath', label: '输入文档路径', type: 'string', required: true, description: '工作空间内的相对路径，例如 input/requirement.txt。', defaultValue: 'input/requirement.txt' },
    { name: 'documentType', label: '文档类型', type: 'string', required: false, description: '文档所属类型。', defaultValue: '产品需求文档' },
    { name: 'outputFile', label: '修改稿路径', type: 'string', required: false, description: '工作空间内的相对输出路径。', defaultValue: 'output/revised-requirement.txt' },
  ],
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      name: '接收文档',
      config: {
        inputParameters: [
          { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
          { name: 'filePath', type: 'string', required: true, description: '工作空间内的相对文档路径。' },
          { name: 'documentType', type: 'string', required: false, description: '文档类型。' },
          { name: 'outputFile', type: 'string', required: false, description: '工作空间内的相对输出路径。' },
        ],
      },
    },
    tool('read-document', '读取文档', 'file_read', { path: '{{variables.filePath}}' }, 'documentContent'),
    llmAgent('extract-document', '提取文档结构', 'documentStructure', documentStructureFields, {
      documentType: '{{variables.documentType}}',
      content: '{{variables.documentContent.content}}',
    }),
    llmAgent('check-quality', '检查内容质量', 'qualityCheck', qualityCheckFields, {
      structure: '{{variables.documentStructure}}',
      content: '{{variables.documentContent.content}}',
    }, qualityOutputInstruction),
    {
      id: 'quality-serious',
      type: 'condition',
      name: '是否存在严重问题',
      config: {
        parameter: 'variables.qualityCheck.passed',
        relation: 'equals',
        comparisonValue: false,
        expression: 'variables.qualityCheck.passed === false',
      },
    },
    llmAgent('recommend-document-fix', '生成修改建议', 'recommendations', recommendationFields, {
      qualityCheck: '{{variables.qualityCheck}}',
      content: '{{variables.documentContent.content}}',
    }),
    llmAgent('revise-document', '生成修改稿', 'revision', revisionFields, {
      original: '{{variables.documentContent.content}}',
      recommendations: '{{variables.recommendations}}',
    }),
    tool('write-revised-document', '保存修改稿', 'file_write', {
      path: '{{variables.outputFile}}',
      content: '{{variables.revision.revisedDocument}}',
    }, 'savedDocument'),
    llmAgent('summarize-document', '生成摘要和标签', 'summary', summaryFields, {
      structure: '{{variables.documentStructure}}',
      content: '{{variables.documentContent.content}}',
    }),
    { id: 'end-1', type: 'end', name: '文档处理完成', config: {} },
  ],
  edges: [
    { id: 'document-start-read', source: 'start-1', target: 'read-document' },
    { id: 'document-read-structure', source: 'read-document', target: 'extract-document' },
    { id: 'document-structure-quality', source: 'extract-document', target: 'check-quality' },
    { id: 'document-quality-condition', source: 'check-quality', target: 'quality-serious' },
    { id: 'document-serious-recommend', source: 'quality-serious', target: 'recommend-document-fix', condition: 'true' },
    { id: 'document-recommend-revise', source: 'recommend-document-fix', target: 'revise-document' },
    { id: 'document-revise-write', source: 'revise-document', target: 'write-revised-document' },
    { id: 'document-write-end', source: 'write-revised-document', target: 'end-1' },
    { id: 'document-pass-summary', source: 'quality-serious', target: 'summarize-document', condition: 'false' },
    { id: 'document-summary-end', source: 'summarize-document', target: 'end-1' },
  ],
};

const draftFields = [field('summary', 'string')];
const loopTestFields = [field('passed', 'boolean'), field('attempt', 'number'), field('failures', 'array')];
const loopReviewFields = [field('passed', 'boolean'), field('issues', 'array')];
const loopFixFields = [field('fixed', 'boolean'), field('summary', 'string')];

export const loopEngineeringDemo: WorkflowDefinition = {
  id: 'demo-loop-engineering',
  name: 'Demo｜Loop Engineering 失败自动修复',
  version: 1,
  variables: { fixed: false },
  inputs: [
    { name: 'task', label: '开发任务', type: 'string', required: true, description: 'Coding Agent 要完成的任务描述。', defaultValue: '在 README.md 末尾追加一行当前时间戳（可用 date 命令）' },
  ],
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      name: '接收任务',
      config: {
        inputParameters: [
          { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
          { name: 'task', type: 'string', required: true, description: '开发任务描述。' },
        ],
      },
    },
    llmAgent('coder-agent', 'Coding Agent 生成实现', 'draft', draftFields, {
      task: '{{variables.task}}',
    }, '完成实现并输出实现摘要。'),
    {
      id: 'loop-1',
      type: 'loop',
      name: 'Test / Review / Fix 循环',
      config: {
        maxIterations: 3,
        stopCondition: 'variables.review.passed == true',
        bodyNodeId: 'test-agent',
        exitNodeId: 'end-1',
      },
    },
    llmAgent('test-agent', 'Test Agent', 'test', loopTestFields, {
      fixed: '{{variables.fixed}}',
    }, '检查输入中的 fixed 字段：如果它不是 true（或其中 fixed 属性不为 true），说明代码尚未修复，passed 必须为 false 并给出失败原因；如果 fixed 是 true，则 passed 必须为 true。'),
    llmAgent('reviewer', 'Reviewer', 'review', loopReviewFields, {
      test: '{{variables.test}}',
    }, '如果输入的 test.passed 为 true，则 passed 必须为 true；否则 passed 必须为 false 并列出问题。'),
    {
      id: 'condition-1',
      type: 'condition',
      name: 'Review 是否通过',
      config: {
        parameter: 'variables.review.passed',
        relation: 'equals',
        comparisonValue: true,
        expression: 'variables.review.passed === true',
      },
    },
    llmAgent('fix-agent', 'Fix Agent', 'fixed', loopFixFields, {
      test: '{{variables.test}}',
    }, '根据测试失败原因修复代码，输出 fixed=true 和修复说明。'),
    { id: 'end-1', type: 'end', name: '循环结束', config: {} },
  ],
  edges: [
    { id: 'loop-start-coder', source: 'start-1', target: 'coder-agent' },
    { id: 'loop-coder-loop', source: 'coder-agent', target: 'loop-1' },
    { id: 'loop-body-test', source: 'loop-1', target: 'test-agent', condition: 'body' },
    { id: 'loop-exit-end', source: 'loop-1', target: 'end-1', condition: 'exit' },
    { id: 'loop-test-review', source: 'test-agent', target: 'reviewer' },
    { id: 'loop-review-condition', source: 'reviewer', target: 'condition-1' },
    { id: 'loop-condition-pass', source: 'condition-1', target: 'loop-1', condition: 'true' },
    { id: 'loop-condition-fix', source: 'condition-1', target: 'fix-agent', condition: 'false' },
    { id: 'loop-fix-loop', source: 'fix-agent', target: 'loop-1' },
  ],
};

export const workflowDemos = [ticketRoutingDemo, orderDiagnosisDemo, documentQualityDemo, loopEngineeringDemo] as const;
export const workflowDemoMap = Object.fromEntries(workflowDemos.map((demo) => [demo.id, demo]));
