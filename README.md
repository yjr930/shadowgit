# Shadow Git

AI Agent Version Control & Time-Travel Extension for VS Code

## Features

- **Independent Git Repository**: Tracks all code changes in a hidden `.agent-repo` directory, separate from your main Git repository
- **Agent/Human Distinction**: Automatically identifies and labels commits as 🤖 (Agent) or 👤 (Human)
- **Timeline View**: Visual history of all changes in the Explorer sidebar
- **Diff Viewer**: View file changes with syntax highlighting, supporting light/dark themes
- **Time Travel**: Checkout to any historical version with one click
- **HTTP API**: Enable AI agents to control version tracking programmatically

## Installation

### From VSIX

```bash
code --install-extension shadowgit-0.0.1.vsix
```

### From Marketplace

Search for "Shadow Git" in VS Code Extensions

## Configuration

Create `~/.shadowgit/config.yaml`:

```yaml
port: 19789
```

- `port`: HTTP server port for AI agent communication (default: 19789)

## Usage

### Manual Usage

1. **Start Agent Task**: `Shadow Git: Start Agent Task`
   - Enter task description (e.g., "Implement login feature")
   
2. **Make Changes**: Edit your code normally

3. **End Agent Task**: `Shadow Git: End Agent Task`
   - All changes are committed automatically

4. **View Timeline**: Check "Agent Timeline" in Explorer sidebar
   - Click any commit to view file diffs
   - Right-click to checkout to that version

### HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Check if agent is executing |
| POST | `/start` | Start agent task (`{"task": "description"}`) |
| POST | /end | End agent task |
| POST | `/commit` | Save checkpoint (`{"message": "description"}`) |
| POST | `/revert` | Revert to last checkpoint |
| GET | `/commits` | List all commits |

Example:

```bash
# Start agent task
curl -X POST http://localhost:19789/start -H "Content-Type: application/json" -d '{"task": "Implement feature"}'

# Save checkpoint
curl -X POST http://localhost:19789/commit -H "Content-Type: application/json" -d '{"message": "Done"}'

# End agent task
curl -X POST http://localhost:19789/end
```

## Commands

| Command | Description |
|---------|-------------|
| `Shadow Git: Start Agent Task` | Start tracking agent changes |
| `Shadow Git: End Agent Task` | Commit all agent changes |
| `Shadow Git: Show Timeline` | Refresh timeline view |
| `Shadow Git: Restart Server` | Restart HTTP server |
| `Shadow Git: Checkout to This Version` | Checkout to selected commit (right-click menu) |

## Architecture

- **Hidden Git Repository**: `.agent-repo/` in workspace
- **Auto Gitignore**: Automatically excludes `.agent-repo` from main Git
- **Commit Identification**: Agent commits prefixed with `Agent:`
