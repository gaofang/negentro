# @ecom/entro

`entro` 是一个纯 CLI 的仓库知识蒸馏工具，目标是通过沉淀规则、流程和场景技能来降低代码熵，让项目更有序、更可复用。

当前 MVP 已支持：

- 初始化仓库内 `.entro/` 目录与默认配置
- 扫描 monorepo、现有 `AGENTS.md`、`.trae/skills` 与近期 Git 提交
- 基于默认 scope 生成候选 knowledge cards 与 open questions
- 手动审核卡片并编译到 `.entro/publications/`

示例：

```bash
pnpm -C packages/entro entro init --root /abs/path/to/repo
pnpm -C packages/entro entro scan --root /abs/path/to/repo
pnpm -C packages/entro entro mine --root /abs/path/to/repo
pnpm -C packages/entro entro review --root /abs/path/to/repo --card kc_goods_publish_rule --decision approve
pnpm -C packages/entro entro publish --root /abs/path/to/repo
```

当前未接入：

- 飞书问题发送与答案回收
- changed-only 增量挖掘
- workspace `AGENTS.md` / skills 的正式同步
