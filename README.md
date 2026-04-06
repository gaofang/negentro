# @ecom/entro

`entro` 是一个仓库知识蒸馏 CLI，目标是把前端业务仓库里的规则、默认开发模式和场景经验提取成可复用的 `AGENTS.md` 与 skills。

当前它支持两种主要使用方式：

- 作为独立 CLI，本机直接运行
- 作为 Codex 集成能力，让研发在 Codex CLI / Codex App 的对话里驱动提取与人工确认

## 安装

### 1. 本机全局安装

```bash
npm install -g @ecom/entro
```

安装后直接执行：

```bash
entro help
```

### 2. 使用 `npx`

如果已经发布到可访问的 npm 源，也可以直接运行：

```bash
npx @ecom/entro help
```

### 3. 仓库开发态直接运行

在本仓库开发时，可以直接：

```bash
node ./src/cli.js help
```

## CLI 用法

### 推荐主命令

```bash
entro run --app /abs/path/to/app
entro build --app /abs/path/to/app
entro question next --app /abs/path/to/app
entro answer --app /abs/path/to/app --question <id> --text "1"
entro reconcile --app /abs/path/to/app --question <id>
```

### 给 Codex 编排时使用 JSON 输出

```bash
entro doctor --app /abs/path/to/app --json
entro paths --app /abs/path/to/app --json
entro run --app /abs/path/to/app --json
entro question next --app /abs/path/to/app --json
entro answer --app /abs/path/to/app --question <id> --text "跳过" --json
entro reconcile --app /abs/path/to/app --question <id> --json
entro build --app /abs/path/to/app --json
```

`--json` 模式适合被 Codex 或其他 agent 编排调用。当前优先保证这些命令的结构化输出稳定。

## 安装到 Codex

如果你希望研发直接在 Codex 的对话里跑 Entro，而不是进入 Entro 自己的 TUI，可以把 Entro 安装成 Codex skill / plugin：

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

默认会安装到：

- `~/.codex/skills/entro-distill`
- `~/.codex/plugins/entro`

安装结果也可以用 JSON 查看：

```bash
entro install-codex --mode both --json
```

## Workflow 模式

如果你希望把复杂前端需求放进一个更严格、可追踪的六阶段流程里，可以使用 `workflow` 集成。

安装到 Codex 的 workflow 集成：

```bash
entro workflow install-codex --mode both
```

### Codex-first 使用方式

安装 `strict-frontend-workflow` 后，研发不需要手动推进每一个 workflow 子命令，而是直接在 Codex 里用 natural language 描述需求，例如：

- “帮我按严格流程看这个复杂前端需求”
- “这个需求先别急着写代码，按 strict workflow 来”
- “继续按 workflow 往下推进，除非遇到关键决策点再问我”

Codex 会把 `entro workflow --json` 视为底层协议，并 automatic 地完成：

- 进入 workflow 运行态
- 查询当前 stage 和下一步动作
- 在默认情况下自动推进 stage 切换
- 到达关键分叉时才停下来向用户确认
- 在结束时整理经验卡 / 修正卡候选并请求 review 或 promote 决策

对 Codex 用户来说，CLI commands 是 orchestration protocol，而不是主要的人机交互界面。只有在调试集成或排查问题时，才需要直接查看这些命令。

### 底层 JSON 协议命令

下面这些命令仍然是 Codex orchestration 使用的底层接口：

```bash
entro workflow run --json
entro workflow next --json
entro workflow status --json
entro workflow capture --type experience --summary "Review one workflow step at a time" --details "先收敛再扩展" --target skills --json
entro workflow capture --type correction --summary "Do not merge review and publish decisions" --target reference --json
entro workflow list --state pending --json
entro workflow review --card <cardId> --decision keep --note "保留给组内复核" --json
entro workflow review --card <cardId> --decision discard --note "已过时" --json
entro workflow review --card <cardId> --decision promote --target skills --json
entro workflow promote --card <cardId> --target agents --sectionHeading "Workflow review defaults" --json
```

这些卡片与 promotion bridge 会保存在运行时的 publication 相关状态目录下，用于后续生成 reference / skills / AGENTS 兼容产物；当前版本只提供 bridge 和结构化输出，不会一次性补全所有下游生成逻辑。

## Codex 中的推荐使用方式

安装完成后，让研发直接在 Codex 对话里说：

- “帮我对当前 app 跑 entro 提取”
- “继续回答 entro 的待确认问题”
- “对这个 app 执行 entro build”

Codex 应该优先使用 `entro-distill` skill，并通过 `entro ... --json` 这组命令驱动完整链路，而不是要求用户切到 Entro 独立 TUI。

## 当前状态

已经支持：

- 应用初始化、扫描、分类、种子提取、经验蒸馏
- 一问一答式 HITL
- 产出 `.entro/output/AGENTS.md` 与 `.entro/output/skills`
- Codex skill / plugin 本地安装
- 面向 Codex 的基础 JSON 编排接口

仍在持续完善：

- Codex 驱动的完整真实链路回归
- 更完整的 JSON 命令覆盖面
- 发布到团队可用 npm 源后的 `npx @ecom/entro` 体验
