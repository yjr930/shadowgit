# Shadow Git

AI 智能体版本控制与 VS Code 时间回溯插件

## 功能特性

- **独立 Git 仓库**：所有代码变更存储在隐藏的 `.agent-repo/` 目录中，与主仓库完全分离
- **智能体/用户区分**：自动识别并标记提交来源（Agent / Human）
- **时间轴视图**：在资源管理器侧边栏查看所有变更历史
- **差异对比**：查看文件变更，支持语法高亮，适配浅色/深色主题
- **时间回溯**：一键检出任意历史版本
- **智能提交信息**：优先使用用户的原始输入作为提交标题，附带文件变更摘要
- **历史清理**：根据 exclude 规则从历史中移除不需要的大文件
- **自动排除**：初始化时自动配置 `.agent-repo/info/exclude`，排除 `node_modules`、虚拟环境等常见大目录

## 架构

```
工作区/
├── .agent-repo/              # 隐藏的 Git 仓库
│   ├── info/exclude          # 排除规则（类似 .gitignore）
│   └── ...
├── .gitignore                # 自动排除 .agent-repo/
└── [项目文件...]
```

**核心设计**：
- `.agent-repo/` 是独立的 Git 仓库，通过 `GIT_DIR` 和 `GIT_WORK_TREE` 环境变量操作
- Agent 提交格式：`Agent: <用户消息>\n\nFiles: +new.ts ~modified.ts -deleted.ts`
- Human 提交格式：`Human changes auto-tracked`

## 安装

Shadow Git 由两部分组成：

### 1. VS Code 扩展（必需）

```bash
cd shadowgit
npm install
npm run compile
npm run package
code --install-extension shadowgit-0.0.1.vsix
```

### 2. OpenCode 插件（可选，自动跟踪 agent 变更）

插件放在以下目录会自动加载，不需要额外配置：

```bash
# 全局安装（推荐，所有项目可用）
mkdir -p ~/.config/opencode/plugins
cp shadowgit/opencode-plugin/shadowgit.ts ~/.config/opencode/plugins/

# 或项目级安装（仅当前项目）
mkdir -p .opencode/plugins
cp shadowgit/opencode-plugin/shadowgit.ts .opencode/plugins/
```

安装后重启 OpenCode 生效。

## 使用方法

### 自动跟踪（OpenCode 插件）

插件全自动工作，无需手动操作：

1. **自动初始化**：首次工具调用时自动创建 `.agent-repo/`、配置 exclude 规则、更新 `.gitignore`
2. **Human 变更检测**：Agent 开始工作前，先提交用户手动做的改动
3. **文件变更收集**：监听 `write`/`edit`/`bash` 等工具调用
4. **智能提交**：会话结束时（`session.idle`）自动提交，通过 SDK 获取用户消息作为提交标题
5. **提交信息格式**：
   - 有用户消息：`Agent: 添加排序功能\n\nFiles: +sort.py ~utils.py`
   - 无用户消息：`Agent: +sort.py ~utils.py -old.py`
   - 状态符号：`+` 新增、`~` 修改、`-` 删除、`→` 重命名

### VS Code 扩展命令

| 命令 | 描述 |
|------|------|
| `Shadow Git: Initialize Repository` | 初始化 `.agent-repo/` 仓库 |
| `Shadow Git: Show Timeline` | 刷新时间轴视图 |
| `Shadow Git: Show Commit Diff` | 查看提交差异（点击时间轴条目） |
| `Shadow Git: Checkout to This Version` | 检出到选定版本（右键菜单） |
| `Shadow Git: Delete History Before This` | 删除此版本之前的历史（右键菜单） |
| `Shadow Git: Apply Exclude Rules to Clean History` | 根据 exclude 规则清理历史中的大文件 |

### 排除规则与历史清理

排除规则配置在 `.agent-repo/info/exclude`，语法与 `.gitignore` 相同。插件初始化时自动添加常见规则（`node_modules/`、`dist/`、`*.pyc` 等）。

**手动添加排除规则**：

```bash
echo "data/" >> .agent-repo/info/exclude
echo "_env_option/" >> .agent-repo/info/exclude
```

**清理历史**：添加规则后，在命令面板执行 `Shadow Git: Apply Exclude Rules to Clean History`，将从所有历史 commit 中移除这些路径并回收空间。

### Diff 查看

- 点击时间轴中的提交条目即可查看差异
- 支持语法高亮（基于 Shiki）
- 适配 VS Code 浅色/深色主题
- 大型提交（超过 50 个文件）会自动截断显示，防止卡顿
- 单个文件超过 100KB 的内容会被截断

## 日志与调试

OpenCode 插件日志：`~/.shadowgit/plugin.log`

日志包含：
- 插件加载状态和工作区路径
- 工具调用跟踪（`tool.execute.before/after`）
- 用户消息捕获结果
- Git 操作结果

## 常见问题

**Q: 提交信息为什么只有文件名没有用户消息？**

A: OpenCode 插件通过 SDK `client.session.messages()` 获取用户消息。如果 SDK 调用失败，会 fallback 到文件变更列表。检查 `~/.shadowgit/plugin.log` 中的 `fetchUserMessage` 日志。

**Q: 如何在新的工作区使用？**

A: 不需要手动初始化。全局安装了 OpenCode 插件后，在任意工作区使用 OpenCode 时会自动创建 `.agent-repo/` 并开始跟踪。也可以通过 VS Code 命令 `Shadow Git: Initialize Repository` 手动初始化。

**Q: 历史清理命令报错？**

A: 可能原因：
1. 上次清理中断导致 `.git-rewrite/` 残留（新版已自动处理）
2. `refs/original/` 残留（新版已自动处理）
3. 仓库文件数过多导致 `filter-branch` 超时

**Q: `.agent-repo/` 太大怎么办？**

A: 先在 `.agent-repo/info/exclude` 中添加大文件/目录的规则，然后执行 `Shadow Git: Apply Exclude Rules to Clean History` 清理历史并回收空间。

**Q: Git index.lock 错误？**

A: 插件会自动清理过期的锁文件。如果问题持续，手动删除 `.agent-repo/index.lock`。
