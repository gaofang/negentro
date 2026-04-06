# Entro

Entro 是一个面向前端重业务代码仓库的仓库知识蒸馏 CLI 工具。它可以将项目中的约定、实现模式以及经过人工确认的决策提炼为可复用的产物，例如 `AGENTS.md` 和 skills。

它适用于那些上下文复杂的业务仓库：真正困难的问题往往不在于语法，而在于上下文——隐藏的团队约定、历史遗留行为、反复出现的实现模式，以及容易被忽略的项目级决策。

## 为什么需要 Entro

现代编码代理已经可以很快地产生代码，但它们往往不了解大型仓库中的“本地规则”，也因此难以安全地修改代码。

Entro 的目标就是补上这部分能力。它帮助团队：

- 发现仓库中重复出现的实现模式
- 暴露那些仍然需要人工确认的模糊决策
- 将已确认的项目知识转化为可复用、面向 agent 的产物
- 通过 CLI 或 Codex 等 agent 环境驱动结构化工作流

## 设计理念

Entro 围绕几个核心理念构建。

### 1. Human-in-the-loop 优于盲目自动化
有些仓库知识可以从代码中挖掘出来，有些则不能。Entro 将“尚未解决的歧义”视为一等概念，并通过一次一个问题的方式请求人工确认。

### 2. 结构化输出就是协议
Entro 提供对 JSON 友好的命令输出，让 agent 环境可以通过结构化结果来编排工作流，而不必从终端日志中解析自然语言。

### 3. 仓库知识应该可复用
目标不是生成一次性的摘要，而是沉淀可长期复用的产物，供未来的人和 agent 持续使用，例如：

- `AGENTS.md`
- skills
- knowledge cards
- workflow review bridges

### 4. 在复杂代码仓库里，过程同样重要
对于拥有大量业务逻辑和历史约束的仓库，更安全的迭代速度来自更好的过程：分阶段工作流、明确的审查节点，以及轻量级的知识沉淀。

## 核心概念

### Extraction
Entro 会扫描应用或仓库范围，并生成结构化的候选知识。

### Questions
当仅靠代码无法得出结论时，Entro 会生成人工确认问题。

### Cards
知识会以轻量、结构化的单元形式被记录下来，后续可以继续审查、提升或发布。

### Publications
经过确认的知识可以被渲染为稳定产物，例如 `AGENTS.md` 和 skills。

### Workflow Mode
Workflow mode 为复杂前端任务增加了一层更严格、分阶段的交互流程，并支持知识沉淀和团队审查钩子。

## 关键使用场景

在以下场景中，Entro 尤其有价值：

- 仓库中存在大量本地约定，但没有被完整文档化
- 编码 agent 在修改代码前需要获得项目特定上下文
- 团队希望沉淀可复用的 agent 文档，而不是反复做口头 onboarding
- 前端工作涉及复杂表单、校验、工作流以及历史行为兼容
- 希望在保留人工审查的同时，仍然发挥 agent 自动化能力

## 安装

### 全局安装

```bash
npm install -g @ecom/entro
```

然后执行：

```bash
entro help
```

### 使用 npx 运行

```bash
npx @ecom/entro help
```

### 本地开发

在本仓库中：

```bash
node ./src/cli.js help
```

## 快速开始

针对单个应用，一个常见流程如下：

```bash
entro run --app /abs/path/to/app
entro question next --app /abs/path/to/app
entro answer --app /abs/path/to/app --question <id> --text "1"
entro reconcile --app /abs/path/to/app --question <id>
entro build --app /abs/path/to/app
```

这个流程会完成三件事：

1. 提取仓库知识
2. 通过人工输入解决模糊问题
3. 生成可复用、面向 agent 的产物

## 基础 CLI 用法

推荐命令：

```bash
entro run --app /abs/path/to/app
entro build --app /abs/path/to/app
entro question next --app /abs/path/to/app
entro answer --app /abs/path/to/app --question <id> --text "1"
entro reconcile --app /abs/path/to/app --question <id>
```

## JSON / Agent 集成

如果是给 agent 编排使用，建议优先加上 `--json`：

```bash
entro doctor --app /abs/path/to/app --json
entro paths --app /abs/path/to/app --json
entro run --app /abs/path/to/app --json
entro question next --app /abs/path/to/app --json
entro answer --app /abs/path/to/app --question <id> --text "skip" --json
entro reconcile --app /abs/path/to/app --question <id> --json
entro build --app /abs/path/to/app --json
```

当 agent 或外部工具需要结构化状态，而不是面向终端的人类可读输出时，应使用 JSON 模式。

## Codex 集成

如果你希望开发者直接在 Codex 中驱动 Entro，而不是切换到独立 TUI，可以安装 Codex 集成：

```bash
entro install-codex --mode both
```

只安装 skill：

```bash
entro install-codex --mode skill
```

只安装 plugin：

```bash
entro install-codex --mode plugin
```

默认安装位置：

- `~/.codex/skills/entro-distill`
- `~/.codex/plugins/entro`

以 JSON 形式查看安装输出：

```bash
entro install-codex --mode both --json
```

## Workflow Mode

Workflow mode 是一层更严格的交互流程，适用于复杂前端工作。

它主要面向那些不适合直接生成代码的任务，因为对应仓库通常具备以下特征：

- 大量业务逻辑
- 历史行为或兼容性约束
- 多阶段流程，例如表单、校验、审查或提交流程

### 将 workflow mode 安装到 Codex

```bash
entro workflow install-codex --mode both
```

### 以 Codex 为主的使用方式

安装 `strict-frontend-workflow` 之后，开发者通常不需要再手动执行每一个 workflow 子命令。

更推荐的方式，是直接在 Codex 中用自然语言描述任务，例如：

- “在写代码之前，先用严格工作流处理这个前端任务。”
- “这个改动涉及历史表单逻辑，请使用严格工作流。”
- “自动继续工作流，除非遇到真正需要决策的节点。”

在这种模式下，Codex 会把 `entro workflow --json` 作为协议层，并自动完成：

- 启动或恢复 workflow 状态
- 读取当前阶段和下一步动作
- 默认推进各个阶段
- 仅在真正有意义的决策点暂停
- 在流程末尾收集经验卡或纠正卡

CLI 依然可用，但对于 Codex 场景下的最终用户来说，它不应该是主要交互方式。

### 底层 workflow 协议

以下命令仍然是编排层使用的底层接口：

```bash
entro workflow run --json
entro workflow next --json
entro workflow status --json
entro workflow capture --type experience --summary "Review one workflow step at a time" --details "Narrow the scope before expanding" --target skills --json
entro workflow capture --type correction --summary "Do not merge review and publish decisions" --target reference --json
entro workflow list --state pending --json
entro workflow review --card <cardId> --decision keep --note "Keep for team review" --json
entro workflow review --card <cardId> --decision discard --note "Outdated" --json
entro workflow review --card <cardId> --decision promote --target skills --json
entro workflow promote --card <cardId> --target agents --sectionHeading "Workflow review defaults" --json
```

当前版本中，被提升的卡片会进入一层桥接产物，以兼容未来的 `reference`、`skills` 和 `AGENTS` 生成流程。当前发布版本中的这层桥接仍然相对轻量，尚未完全自动化所有下游发布行为。

## 端到端示例流程

### 仓库蒸馏流程

```bash
entro run --app /abs/path/to/app
entro question next --app /abs/path/to/app --json
entro answer --app /abs/path/to/app --question <id> --text "skip" --json
entro reconcile --app /abs/path/to/app --question <id> --json
entro build --app /abs/path/to/app --json
```

### 严格工作流流程

在 Codex 中，用户可以从自然语言开始。随后，编排层应当：

1. 进入 workflow
2. 仅在必要时澄清范围
3. 按阶段推进工作
4. 只在决策点暂停
5. 在结束时沉淀可复用知识

## 输出产物

根据不同流程，Entro 可以生成或维护：

- `.entro/output/AGENTS.md`
- `.entro/output/skills/`
- workflow knowledge cards
- publication bridge artifacts
- 运行时报告与结构化状态

## 当前状态

已经支持：

- 应用初始化、扫描、分类、初始提取以及知识蒸馏
- 一次一个问题的人机协同确认流程（HITL）
- `.entro/output/AGENTS.md` 和 `.entro/output/skills`
- Codex skill / plugin 安装
- 面向 JSON 的编排接口
- 严格 workflow 运行时与轻量级 workflow 知识桥接

仍在持续演进：

- 在真实会话中更完整的端到端 Codex 编排能力
- 更广覆盖的 JSON 命令支持
- 更紧密的、由 workflow 驱动的最终产物发布流程
- 更完善的外部打包与开源化打磨

## 开发

运行测试：

```bash
npm test
```

运行单个测试文件：

```bash
node --test ./test/hitl-flow.test.js
```

## 贡献

这个项目仍在持续演进。以下类型的贡献会更容易落地：

- 保持面向用户的行为简单
- 保留结构化、机器可读的输出
- 避免在公开接口中对某一个业务领域过度拟合
- 强化真实仓库知识与可复用 agent 产物之间的桥接能力

## License

许可证细节尚未最终确定。
