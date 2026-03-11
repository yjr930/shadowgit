# Shadow Git

AI 智能体版本控制与 VS Code 时间回溯插件

## 功能特性

- **独立 Git 仓库**：所有代码变更存储在隐藏的 `.agent-repo` 目录中，与主仓库完全分离
- **智能体/用户区分**：自动识别并标记提交为 🤖（智能体）或 👤（用户）
- **时间轴视图**：在资源管理器侧边栏查看所有变更历史
- **差异对比器**：查看文件变更，支持语法高亮，适配浅色/深色主题
- **时间回溯**：一键检出任意历史版本
- **自动提交信息**：根据实际文件改动生成具体描述，如 `Agent: quick_sort.py(删除), utils.py(修改)`

## 架构

```
工作区/
├── .agent-repo/          # 隐藏的 Git 仓库（不提交到主 Git）
├── .gitignore            # 自动排除 .agent-repo
├── .opencode.yaml        # Opencode 插件配置
└── [项目文件...]
```

**核心设计**：
- `.agent-repo` 是独立的 bare Git 仓库，通过 `GIT_DIR` 和 `GIT_WORK_TREE` 环境变量操作
- 智能体提交以 `Agent:` 开头，用户提交以 `Human:` 开头
- 提交信息优先使用 `git diff --stat` 获取实际改动的文件列表

## 安装

Shadow Git 由两部分组成：

### 1. VS Code 扩展（必需）

```bash
# 安装 VSIX
code --install-extension shadowgit-0.0.1.vsix

# 或从源码打包
cd shadowgit
npm install
npm run package
code --install-extension shadowgit-0.0.1.vsix
```

### 2. Opencode 插件（可选）

```bash
# 复制插件文件
mkdir -p ~/.opencode/plugins/shadowgit
cp shadowgit/opencode-plugin/shadowgit.ts ~/.opencode/plugins/shadowgit/
```

在项目根目录创建 `.opencode.yaml` 启用插件：

```yaml
plugins:
  - name: shadowgit
    enabled: true
```

## 使用方法

### 自动跟踪（Opencode 插件）

插件会自动：
1. **初始化仓库**：首次工具执行时创建 `.agent-repo`
2. **检测变更**：使用 `write/edit/multiedit/bash` 等工具时会收集文件改动
3. **自动提交**：会话结束时（`session.idle` 或 `session.deleted`）自动提交
4. **生成提交信息**：根据实际改动生成描述，如：
   - `Agent: quick_sort.py(新增), utils.py(修改)`
   - `Agent: 删除 old_file.py`
   - `Agent: foo.py, bar.ts 等3个文件`

### 手动使用（VS Code 扩展）

1. **查看时间轴**：在资源管理器侧边栏查看 "Agent Timeline"
   - 点击任意提交查看文件差异
   - 右键菜单可检出该版本

2. **命令面板**：

   | 命令 | 描述 |
   |------|------|
   | `Shadow Git: Show Timeline` | 刷新时间轴视图 |
   | `Shadow Git: Checkout to This Version` | 检出到选定提交（右键菜单） |
   | `Shadow Git: Delete History Before This` | 删除此版本之前的所有历史（右键菜单） |

## 注意事项

### 不要将主项目目录添加到 .agent-repo

确保工作区根目录的 `.gitignore` 正确排除了 `shadowgit/`（如果存在）：

```gitignore
.agent-repo/
shadowgit/
```

否则 Git 会将主项目识别为 submodule，导致无法检测文件变化。

### 日志位置

Opencode 插件日志位于：`~/.shadowgit/plugin.log`

## 常见问题

**Q: 为什么提交信息显示 "Agent changes" 而不是具体文件？**

A: 可能原因：
1. 插件未正确获取工作区路径（检查日志中的 `Workspace root`）
2. `.agent-repo` 中存在错误的 submodule 引用
3. 插件未重启，需要重新加载 opencode

**Q: 如何在新的工作区使用？**

A:
1. 安装 VS Code 扩展
2. 配置 `.opencode.yaml` 启用插件
3. 在该目录下使用 opencode 即可自动跟踪
