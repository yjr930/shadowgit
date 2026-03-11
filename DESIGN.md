# Shadow Git 设计文档

## 1. 项目概述

Shadow Git 是一个 VS Code 扩展，为 AI Agent 提供版本控制和时间回溯能力。它在独立于主 Git 仓库的隐藏目录 `.agent-repo` 中维护完整的文件历史，使 AI Agent 能够：

- 追踪所有代码修改
- 随时回滚到任意历史版本
- 以 Timeline 形式可视化查看修改历史

## 2. 系统架构

### 2.1 核心模块

- **extension.ts** - 入口模块，负责扩展激活、初始化注册命令、Timeline 视图、Diff 面板
- **shadowGit.ts** - 核心功能模块，负责 Git 仓库初始化、提交、checkout、历史查询
- **commands.ts** - 命令注册模块，负责注册 VS Code 命令、处理 Agent 工具调用
- **timeline.ts** - 时间线视图模块，负责提供 Timeline 树形视图展示提交历史
- **diffPanel.ts** - 差异视图模块，负责 Webview 面板展示提交的文件差异
- **state.ts** - 状态管理模块，负责管理 Agent 任务执行状态
- **hooks.ts** - 钩子模块，负责监听文件变化、触发自动保存逻辑

### 2.2 模块调用关系

- extension.ts 调用 shadowGit、commands、timeline、diffPanel 的初始化方法
- commands.ts 调用 shadowGit、state、hooks、timeline 的方法处理用户命令
- hooks.ts 调用 shadowGit 的 commit 方法执行提交
- timeline.ts 调用 shadowGit 的 getLog 获取历史，调用 diffPanel 显示差异
- diffPanel.ts 调用 shadowGit 的 getCommitDiff 获取差异数据

| 模块 | 职责 |
|------|------|
| `shadowGit.ts` | Git 仓库初始化、提交、checkout、历史查询 |
| `commands.ts` | 注册 VS Code 命令、处理 Agent 工具调用 |
| `timeline.ts` | 提供 Timeline 树形视图展示提交历史 |
| `diffPanel.ts` | Webview 面板展示提交的文件差异 |
| `state.ts` | 管理 Agent 任务执行状态 |
| `hooks.ts` | 监听文件变化、触发自动保存逻辑 |

## 3. 核心功能

### 3.1 隐藏式 Git 仓库

- 仓库路径：`<workspace>/.agent-repo`
- 通过设置 `GIT_DIR` 和 `GIT_WORK_TREE` 环境变量操作独立仓库
- 自动更新 `.gitignore` 排除 `.agent-repo` 目录

### 3.2 Agent 任务管理

```
startAgent → (文件变更追踪) → commit/checkpoint → endAgent
```

- **startAgent**: 启动 Agent 任务，输入任务描述，开始追踪文件变更
- **commit**: 手动保存检查点，提交当前所有变更
- **endAgent**: 结束 Agent 任务，自动提交变更

### 3.3 自动保存机制

- 启动 Agent 任务前，自动将人类的未提交变更保存为 "Human changes auto-save"
- Agent 执行期间的文件变更自动追踪
- 提交时使用固定作者身份：
  - 人类：`Yukio <yukio@localhost>`
  - Agent：`AI Agent <agent@localhost>`

### 3.4 时间回溯

- **checkoutToCommit**: 检出到指定历史版本，工作区文件完全匹配该提交
- **revertToCommit**: 回滚到上一个检查点（撤销当前未提交的变更）

### 3.5 Timeline 视图

- 侧边栏展示提交历史
- 🤖 图标 = Agent 提交
- 👤 图标 = 人类提交
- 支持点击查看提交详情和文件差异

### 3.6 Diff 面板

- Webview 展示提交级别差异
- 支持折叠/展开文件
- 高亮显示：新增（绿色）、删除（红色）、修改（黄色）
- 自动适配明暗主题

## 4. 数据流

### 4.1 提交流程

```
用户触发 commit 命令
       ↓
hooks.postAgentCommit()
       ↓
shadowGit.commit(author, email, message)
       ↓
execGit(['add', '-A', 'commit', '-m'])
       ↓
timeline.refresh()
```

### 4.2 Checkout 流程

```
用户点击 Timeline 中的提交
       ↓
commands.checkoutToCommit(commitHash)
       ↓
shadowGit.checkoutToCommit()
       ↓
1. 获取目标提交的文件列表
2. 删除不在列表中的文件
3. git checkout 检出文件
4. git reset 清除暂存区
       ↓
timeline.refresh() + 文件浏览器刷新
```

## 5. 命令列表

| 命令 | 功能 |
|------|------|
| `shadowgit.startAgent` | 开始 Agent 任务 |
| `shadowgit.endAgent` | 结束 Agent 任务 |
| `shadowgit.commit` | 保存检查点 |
| `shadowgit.showTimeline` | 刷新 Timeline 视图 |
| `shadowgit.checkoutToCommit` | 检出到指定版本 |

## 6. 扩展点配置

### 6.1 命令

- 注册在 Command Palette
- 支持右键菜单调用

### 6.2 视图

- `shadowgit-timeline` 注册在 Explorer 侧边栏
- 名称：`Agent Timeline`

## 7. 关键技术点

### 7.1 Git 环境隔离

```typescript
const env = {
    GIT_DIR: repoPath,        // 仓库路径
    GIT_WORK_TREE: workspaceRoot  // 工作区
};
```

### 7.2 提交识别

- Agent 提交：消息以 `Agent:` 开头
- 人类提交：其他消息

### 7.3 文件差异计算

- 使用 `--numstat` 获取增减行数
- 使用 `--name-status` 获取文件状态
- 对比父提交获取文件内容差异
