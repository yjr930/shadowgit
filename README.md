# Shadow Git

AI Agent 版本控制与 VS Code Time-Travel 扩展

## 功能特性

- **独立 Git Repository**：将所有代码变更存储在隐藏的 `.agent-repo` 目录中，与主仓库分离
- **Agent/User 区分**：自动识别并标记提交为 🤖（Agent）或 👤（User）
- **Timeline 视图**：在 Explorer 侧边栏所有变更历史
- **Diff Viewer中可视化展示**：语法高亮查看文件变更，支持 light/dark theme
- **Time Travel**：一键 checkout 到任意历史版本
- **HTTP API**：通过编程方式控制版本跟踪

## 安装

### 从 VSIX 安装

```bash
code --install-extension shadowgit-0.0.1.vsix
```

### 从 Marketplace 安装

在 VS Code 扩展中搜索 "Shadow Git"

## 配置

在 VS Code 设置中添加：

```json
{
  "shadowgit.configPath": "~/.shadowgit/config.yaml"
}
```

创建 `~/.shadowgit/config.yaml`：

```yaml
port: 19789
```

- `shadowgit.configPath`：配置文件路径（默认：`~/.shadowgit/config.yaml`）
- `port`：HTTP Server 端口，用于与 Agent 通信（默认：19789）

## 使用方法

### 手动使用

1. **开始 Agent Task**：`Shadow Git: Start Agent Task`
   - 输入任务描述（例如："实现登录功能"）

2. **进行修改**：正常编辑代码

3. **结束 Agent Task**：`Shadow Git: End Agent Task`
   - 所有变更将自动 commit

4. **查看 Timeline**：在 Explorer 侧边栏中查看 "Agent Timeline"
   - 点击任意 commit 查看文件 diff
   - 右键可 checkout 到该版本

### HTTP API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/status` | 检查 Agent 状态（返回 `isExecuting` 和 `currentTask`） |
| POST | `/start` | 开始 Agent 任务（`{"task": "description"}`） |
| POST | `/end` | 结束 Agent 任务 |
| GET | `/commits` | 获取最近 50 条 commit |

示例：

```bash
# 检查 Agent 状态
curl http://localhost:19789/status

# 开始 Agent 任务
curl -X POST http://localhost:19789/start -H "Content-Type: application/json" -d '{"task": "实现功能"}'

# 结束 Agent 任务
curl -X POST http://localhost:19789/end

# 获取 commit 历史
curl http://localhost:19789/commits
```

## 命令

| 命令 | 描述 |
|------|------|
| `Shadow Git: Start Agent Task` | 开始跟踪 Agent 变更 |
| `Shadow Git: End Agent Task` | 提交所有 Agent 变更 |
| `Shadow Git: Show Timeline` | 刷新 Timeline 视图 |
| `Shadow Git: Restart Server` | 重启 HTTP Server |
| `Shadow Git: Checkout to This Version` | Checkout 到选定 commit（右键菜单） |
| `Shadow Git: Delete History Before This` | 删除此版本之前的所有历史（右键菜单） |

## 架构

- **隐藏 Git Repository**：工作区中的 `.agent-repo/`
- **自动 Gitignore**：自动将 `.agent-repo` 排除在主 Git 之外
- **Commit 识别**：Agent 提交的 commit message 前缀为 `Agent:`
