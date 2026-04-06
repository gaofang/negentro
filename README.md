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

如果你希望用更轻量的工作流界面来沉淀经验卡和修正卡，可以直接使用 `workflow` 子命令。

安装到 Codex 的 workflow 集成：

```bash
entro workflow install-codex --mode both
```

启动或查看 workflow 运行态：

```bash
entro workflow run --json
entro workflow next --json
entro workflow status --json
```

捕获经验 / 修正候选卡：

```bash
entro workflow capture --type experience --summary "Review one workflow step at a time" --details "先收敛再扩展" --target skills --json
entro workflow capture --type correction --summary "Do not merge review and publish decisions" --target reference --json
```

团队评审与决策入口：

```bash
entro workflow list --state pending --json
entro workflow review --card <cardId> --decision keep --note "保留给组内复核" --json
entro workflow review --card <cardId> --decision discard --note "已过时" --json
entro workflow review --card <cardId> --decision promote --target skills --json
```

如果团队已达成一致，也可以直接做轻量 promotion bridge：

```bash
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
