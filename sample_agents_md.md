# AGENTS.md

## Shadow Git Required When Edit files

All file (include code & other files) edits (include change, new, delete, and so on) must be tracked using Shadow Git.

Shadow Git is a local Git auto-commit service based on HTTP. All commits are stored in `.agent-repo/`.

### Workflow
1. **Before writing code**: Call `POST /start` with task description
2. **Write code**: Implement changes (edit files)
3. **After writing code**: Call `POST /end` to commit

### Important
- Call `POST /start` BEFORE making any edits
- Make your edits
- Call `POST /end` AFTER completing all edits

### HTTP API
Base URL: `http://localhost:{port}` (port from Config)

Config: `~/.shadowgit/config.yaml` (port: xxx)

- `POST /start` - Start tracking (`{"task": "description"}`)
- `POST /end` - End task and commit
