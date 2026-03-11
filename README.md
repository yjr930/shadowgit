# Shadow Git

AI Agent版本控制与 VS Code 时间旅行扩展

## 功能特性

- **独立 Git 仓库**：将所有代码变更跟踪存储在隐藏的 `.agent-repo` 目录中，与主 Git 仓库分离
- **Agent/人工区分**：自动识别并标记提交为 🤖（Agent）或 👤（人工）
- **时间线视图**：在资源管理器侧边栏中可视化展示所有变更历史
- **差异查看器**：支持语法高亮查看文件变更，同时适配浅色/深色主题
- **时间旅行**：一键签出到任意历史版本
- **HTTP API**：支持通过编程方式控制版本跟踪

## 安装

### 从 VSIX 安装

```bash
code --install-extension shadowgit-0.0.1.vsix
```

### 从市场安装

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
- `port`：HTTP 服务器端口，用于与Agent通信（默认：19789）

## 使用方法

### 手动使用

1. **开始Agent任务**：`Shadow Git: Start Agent Task`
   - 输入任务描述（例如："实现登录功能"）

2. **进行修改**：正常编辑代码

3. **结束Agent任务**：`Shadow Git: End Agent Task`
   - 所有更改将自动提交

4. **查看时间线**：在资源管理器侧边栏中查看 "Agent Timeline"
   - 点击任意提交查看文件差异
   - 右键点击可签出到该版本

### HTTP API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/status` | 检查Agent状态（返回 `isExecuting` 和 `currentTask`） |
| POST | `/start` | 开始Agent任务（`{"task": "description"}`） |
| POST | `/end` | 结束Agent任务 |
| GET | `/commits` | 获取最近 50 条提交 |

示例：

```bash
# 检查Agent状态
curl http://localhost:19789/status

# 开始Agent任务
curl -X POST http://localhost:19789/start -H "Content-Type: application/json" -d '{"task": "实现功能"}'

# 结束Agent任务
curl -X POST http://localhost:19789/end

# 获取提交历史
curl http://localhost:19789/commits
```

## 命令

| 命令 | 描述 |
|------|------|
| `Shadow Git: Start Agent Task` | 开始跟踪Agent变更 |
| `Shadow Git: End Agent Task` | 提交所有Agent变更 |
| `Shadow Git: Show Timeline` | 刷新时间线视图 |
| `Shadow Git: Restart Server` | 重启 HTTP 服务器 |
| `Shadow Git: Checkout to This Version` | 签出到选定提交（右键菜单） |
| `Shadow Git: Delete History Before This` | 删除此版本之前的所有历史（右键菜单） |

## 架构

- **隐藏 Git 仓库**：工作区中的 `.agent-repo/`
- **自动 Gitignore**：自动将 `.agent-repo` 排除在主 Git 之外
- **提交识别**：Agent提交的提交信息前缀为 `Agent:`
