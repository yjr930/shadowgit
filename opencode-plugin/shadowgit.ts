import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

const SHADOW_REPO_DIR = ".agent-repo"
const LOG_FILE = join(process.env.HOME || "/root", ".shadowgit", "plugin.log")
const HUMAN_AUTHOR = "Yukio"
const HUMAN_EMAIL = "yukio@localhost"
const AGENT_AUTHOR = "AI Agent"
const AGENT_EMAIL = "agent@localhost"

function fileLog(msg: string) {
  try {
    mkdirSync(join(process.env.HOME || "/root", ".shadowgit"), { recursive: true })
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

function resolveWorkspaceRoot(ctx: any): string | undefined {
  const candidates = [
    ctx?.workspaceRoot,
    ctx?.workspace?.root,
    ctx?.projectRoot,
    ctx?.worktree,
    ctx?.directory,
    ctx?.cwd,
    ctx?.workspace?.cwd,
    process.cwd(),
  ]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue
    try {
      const stat = statSync(candidate)
      if (stat.isDirectory()) return candidate
    } catch {}
  }
  return undefined
}

async function execGit(workspaceRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const repoPath = join(workspaceRoot, SHADOW_REPO_DIR)
  const env = {
    ...process.env,
    GIT_DIR: repoPath,
    GIT_WORK_TREE: workspaceRoot,
    HOME: process.env.HOME || "/root",
  }

  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: workspaceRoot, env })
    return { stdout: stdout || "", stderr: stderr || "", code: 0 }
  } catch (e: any) {
    const stdout = e?.stdout || ""
    const stderr = e?.stderr || e?.message || ""
    return { stdout, stderr, code: e?.code ?? 1 }
  }
}

async function ensureRepo(workspaceRoot: string) {
  const repoPath = join(workspaceRoot, SHADOW_REPO_DIR)
  const headPath = join(repoPath, "HEAD")
  if (!existsSync(repoPath)) {
    mkdirSync(repoPath, { recursive: true })
  }
  if (!existsSync(headPath)) {
    const initRes = await execGit(workspaceRoot, ["init"])
    if (initRes.code !== 0) {
      fileLog(`git init failed: ${initRes.stderr || initRes.stdout}`)
    }
  }
}

function ensureGitignore(workspaceRoot: string) {
  const gitignorePath = join(workspaceRoot, ".gitignore")
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf8")
      if (!content.includes(`${SHADOW_REPO_DIR}/`)) {
        appendFileSync(gitignorePath, `\n${SHADOW_REPO_DIR}/\n`)
      }
    } else {
      writeFileSync(gitignorePath, `${SHADOW_REPO_DIR}/\n`)
    }
  } catch {}
}

async function hasChanges(workspaceRoot: string): Promise<boolean> {
  const res = await execGit(workspaceRoot, ["status", "--porcelain"])
  return res.code === 0 && res.stdout.trim().length > 0
}

async function commit(workspaceRoot: string, author: string, email: string, message: string): Promise<boolean> {
  await execGit(workspaceRoot, ["config", "user.name", author])
  await execGit(workspaceRoot, ["config", "user.email", email])
  await execGit(workspaceRoot, ["add", "-A"])
  const res = await execGit(workspaceRoot, ["commit", "-m", message])
  if (res.code !== 0) {
    fileLog(`git commit failed: ${res.stderr || res.stdout}`)
    return false
  }
  return true
}

export const ShadowGitPlugin = async (ctx: any) => {
  let workspaceRoot = resolveWorkspaceRoot(ctx)
  let started = false
  let userMessage = ""
  let toolChanges: { file: string; action: string }[] = []

  if (workspaceRoot) {
    fileLog(`Workspace root: ${workspaceRoot}`)
  } else {
    fileLog("Workspace root not found; git operations may fail")
  }

  const getWorkspaceRoot = () => {
    if (!workspaceRoot) workspaceRoot = resolveWorkspaceRoot(ctx)
    return workspaceRoot
  }

  const ensureStart = async () => {
    if (started) return
    const root = getWorkspaceRoot()
    if (!root) return
    await ensureRepo(root)
    ensureGitignore(root)
    if (await hasChanges(root)) {
      await commit(root, HUMAN_AUTHOR, HUMAN_EMAIL, "Human changes auto-tracked")
    }
    started = true
  }

  const collectToolChanges = (input: any) => {
    const tool = input?.tool
    if (!tool) return

    const trackFile = (filePath: string, action: string) => {
      if (!filePath) return
      const fileName = filePath.split("/").pop() || filePath
      if (!toolChanges.find(c => c.file === fileName)) {
        toolChanges.push({ file: fileName, action })
      }
    }

    if (tool === "write" || tool === "multiedit") {
      trackFile(input?.filePath, "修改")
    } else if (tool === "edit") {
      trackFile(input?.filePath, "修改")
    } else if (tool === "bash") {
      const cmd = input?.command?.toString() || ""
      if (cmd.includes("touch ") || cmd.includes("mkdir ")) {
        const match = cmd.match(/(?:touch|mkdir)\s+(.+)/)
        if (match) {
          const paths = match[1].split(" ").filter((p: string) => p.trim())
          paths.forEach((p: string) => trackFile(p.trim(), "创建"))
        }
      }
    }
  }

  const generateCommitMessage = async (root: string): Promise<string> => {
    try {
      const diffRes = await execGit(root, ["diff", "--stat", "--name-status"])
      if (diffRes.code === 0 && diffRes.stdout.trim()) {
        const lines = diffRes.stdout.trim().split("\n")
        const changes: string[] = []
        const fileCount = new Set<string>()

        for (const line of lines) {
          const [status, ...pathParts] = line.split("\t")
          const filePath = pathParts.join("\t")
          const fileName = filePath.split("/").pop() || filePath
          fileCount.add(fileName)

          const statusMap: Record<string, string> = {
            A: "新增",
            M: "修改",
            D: "删除",
            R: "重命名",
          }
          changes.push(`${fileName}(${statusMap[status] || status})`)
        }

        const summary = Array.from(fileCount).slice(0, 5).join(", ")
        const suffix = fileCount.size > 5 ? ` 等${fileCount.size}个文件` : ""
        return `Agent: ${summary}${suffix}`
      }
    } catch {}

    if (toolChanges.length > 0) {
      const files = toolChanges.slice(0, 5).map(c => c.file).join(", ")
      return toolChanges.length > 5 ? `Agent: ${files} 等` : `Agent: ${files}`
    }

    return userMessage ? `Agent: ${userMessage}` : "Agent changes"
  }

  const ensureEnd = async () => {
    if (!started) return
    const root = getWorkspaceRoot()
    if (!root) return
    await ensureRepo(root)
    if (!(await hasChanges(root))) {
      started = false
      toolChanges = []
      return
    }
    const finalMessage = await generateCommitMessage(root)
    await commit(root, AGENT_AUTHOR, AGENT_EMAIL, finalMessage)
    started = false
    toolChanges = []
    userMessage = ""
  }

  fileLog(`Plugin loaded, ctx keys: ${Object.keys(ctx)}`)

  return {
    "tool.execute.before": async (input: any, _output: any) => {
      fileLog(`tool.execute.before: tool=${input?.tool}`)
      await ensureStart()
      collectToolChanges(input)
    },

    "tool.execute.after": async (input: any, _output: any) => {
      fileLog(`tool.execute.after: tool=${input?.tool}`)
    },

    event: async (payload: any) => {
      const eventType = payload?.event?.type ?? payload?.type ?? "unknown"
      fileLog(`event: ${eventType} keys=${JSON.stringify(Object.keys(payload ?? {}))}`)

      if (eventType === "message.updated") {
        try {
          const msg = payload.event?.properties?.message ?? payload.properties?.message ?? payload
          const role = msg.role ?? msg.metadata?.role
          if (role === "user") {
            const text =
              typeof msg.content === "string"
                ? msg.content
                : msg.text ?? msg.parts?.[0]?.text ?? ""
            userMessage = text.replace(/\n/g, " ").trim().slice(0, 120)
            fileLog(`Captured user message: ${userMessage}`)
          }
        } catch {}
      }

      if (eventType === "session.idle" || eventType === "session.deleted") {
        await ensureEnd()
      }
    },
  }
}
