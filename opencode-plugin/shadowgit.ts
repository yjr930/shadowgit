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

function isValidProjectRoot(p: string): boolean {
  if (!p || p === "/" || p === "/root" || p === "/tmp") return false
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function resolveWorkspaceRoot(ctx: any): string | undefined {
  const candidates = [
    ctx?.worktree,
    ctx?.directory,
    ctx?.workspaceRoot,
    ctx?.workspace?.root,
    ctx?.projectRoot,
    ctx?.cwd,
    ctx?.workspace?.cwd,
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue
    if (!isValidProjectRoot(candidate)) continue
    if (existsSync(join(candidate, SHADOW_REPO_DIR))) return candidate
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue
    if (isValidProjectRoot(candidate)) return candidate
  }

  const cwd = process.cwd()
  if (isValidProjectRoot(cwd)) return cwd

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

const DEFAULT_EXCLUDES = [
  "node_modules/",
  ".git/",
  ".agent-repo/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  ".env",
  ".env.*",
  "*.log",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  ".DS_Store",
  "Thumbs.db",
  "*.swp",
  "*.swo",
  "coverage/",
  ".cache/",
  ".turbo/",
  "target/",
]

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
  for (const lock of ["index.lock", "gc.log.lock", "gc.pid"]) {
    const lockPath = join(repoPath, lock)
    try {
      if (existsSync(lockPath)) {
        const { unlinkSync } = require("fs")
        unlinkSync(lockPath)
        fileLog(`Removed stale lock: ${lock}`)
      }
    } catch {}
  }
  ensureExclude(workspaceRoot)
}

function ensureExclude(workspaceRoot: string) {
  const infoDir = join(workspaceRoot, SHADOW_REPO_DIR, "info")
  const excludePath = join(infoDir, "exclude")
  try {
    mkdirSync(infoDir, { recursive: true })
    const projectGitignore = join(workspaceRoot, ".gitignore")
    let projectRules = ""
    if (existsSync(projectGitignore)) {
      projectRules = readFileSync(projectGitignore, "utf8")
    }

    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : ""
    const missing = DEFAULT_EXCLUDES.filter(
      (rule) => !existing.includes(rule) && !projectRules.includes(rule),
    )

    if (missing.length > 0) {
      const header = existing.includes("# shadowgit excludes") ? "" : "\n# shadowgit excludes\n"
      appendFileSync(excludePath, header + missing.join("\n") + "\n")
      fileLog(`Added ${missing.length} exclude rules to ${excludePath}`)
    }
  } catch (e: any) {
    fileLog(`ensureExclude failed: ${e.message}`)
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
  const client = ctx?.client
  let workspaceRoot = resolveWorkspaceRoot(ctx)
  let enabled = false
  let started = false
  let userMessage = ""
  let currentSessionID = ""
  let toolChanges: { file: string; action: string }[] = []

  if (workspaceRoot) {
    enabled = true
    fileLog(`Workspace root: ${workspaceRoot}, .agent-repo exists: ${existsSync(join(workspaceRoot, SHADOW_REPO_DIR))}`)
  } else {
    fileLog(`Workspace root not found (ctx keys: ${Object.keys(ctx)}), trying process.cwd()=${process.cwd()}`)
    const cwd = process.cwd()
    if (isValidProjectRoot(cwd)) {
      workspaceRoot = cwd
      enabled = true
      fileLog(`Fallback to cwd: ${cwd}`)
    }
  }

  const getWorkspaceRoot = () => {
    if (!workspaceRoot) workspaceRoot = resolveWorkspaceRoot(ctx)
    return workspaceRoot
  }

  const ensureStart = async () => {
    if (!enabled || started) return
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
    const statusMap: Record<string, string> = { A: "+", M: "~", D: "-", R: "→" }
    let entries: { symbol: string; name: string }[] = []

    try {
      const diffRes = await execGit(root, ["diff", "--name-status", "HEAD"])
      if (diffRes.code === 0 && diffRes.stdout.trim()) {
        for (const line of diffRes.stdout.trim().split("\n")) {
          const [status, ...pathParts] = line.split("\t")
          const filePath = pathParts.join("\t")
          const fileName = filePath.split("/").pop() || filePath
          entries.push({ symbol: statusMap[status] || status, name: fileName })
        }
      }
    } catch {}

    if (!entries.length) {
      try {
        const statusRes = await execGit(root, ["status", "--porcelain"])
        if (statusRes.code === 0 && statusRes.stdout.trim()) {
          for (const line of statusRes.stdout.trim().split("\n")) {
            const code = line.slice(0, 2).trim()
            const filePath = line.slice(3).trim()
            const fileName = filePath.split("/").pop() || filePath
            const sym = code.includes("?") ? "+" : code.includes("D") ? "-" : "~"
            entries.push({ symbol: sym, name: fileName })
          }
        }
      } catch {}
    }

    if (userMessage) {
      const filesList = entries.length > 0
        ? `\n\nFiles: ${entries.slice(0, 8).map(e => `${e.symbol}${e.name}`).join(" ")}${entries.length > 8 ? ` (+${entries.length - 8})` : ""}`
        : ""
      return `Agent: ${userMessage}${filesList}`
    }

    if (entries.length > 0) {
      const shown = entries.slice(0, 6).map(e => `${e.symbol}${e.name}`).join(" ")
      const more = entries.length > 6 ? ` (+${entries.length - 6})` : ""
      return `Agent: ${shown}${more}`
    }

    return "Agent: auto-commit"
  }

  const extractTextFromMessage = (msg: any): string => {
    if (!msg) return ""
    if (typeof msg.content === "string") return msg.content
    if (Array.isArray(msg.content)) {
      const tp = msg.content.find((p: any) => p.type === "text" || typeof p === "string")
      return typeof tp === "string" ? tp : tp?.text ?? ""
    }
    if (Array.isArray(msg.parts)) {
      const tp = msg.parts.find((p: any) => p.type === "text" || typeof p === "string")
      return typeof tp === "string" ? tp : tp?.text ?? ""
    }
    return msg?.text ?? ""
  }

  const fetchUserMessage = async (sessionID: string): Promise<string> => {
    if (!client || !sessionID) return ""
    try {
      fileLog(`fetchUserMessage: session keys=${Object.keys(client.session || {}).join(",")}`)

      const tryCall = async (label: string, fn: () => Promise<any>) => {
        try {
          const res = await fn()
          const resType = typeof res
          const resKeys = res && typeof res === "object" ? Object.keys(res).join(",") : "N/A"
          fileLog(`${label}: type=${resType} keys=${resKeys}`)
          if (res && typeof res === "object") {
            fileLog(`${label} preview: ${JSON.stringify(res).slice(0, 300)}`)
          }
          return res
        } catch (e: any) {
          fileLog(`${label} error: ${e.message?.slice(0, 100)}`)
          return null
        }
      }

      const sessionData = await tryCall("session.get", () =>
        client.session.get({ path: { id: sessionID } })
      )

      let messages: any[] = []
      const msgSources = [
        sessionData?.messages,
        sessionData?.data?.messages,
      ]
      for (const src of msgSources) {
        if (Array.isArray(src) && src.length > 0) { messages = src; break }
      }

      if (!messages.length) {
        const listRes = await tryCall("session.list_messages", async () => {
          if (client.session.messages) return client.session.messages({ path: { id: sessionID } })
          if (client.session.listMessages) return client.session.listMessages({ sessionID })
          return null
        })
        if (listRes) {
          const arr = listRes?.data ?? listRes?.messages ?? listRes
          if (Array.isArray(arr)) messages = arr
        }
      }

      if (!messages.length) {
        const chatRes = await tryCall("session.chat.list", async () => {
          if (client.session?.chat?.list) return client.session.chat.list({ path: { id: sessionID } })
          return null
        })
        if (chatRes) {
          const arr = chatRes?.data ?? chatRes?.messages ?? chatRes
          if (Array.isArray(arr)) messages = arr
        }
      }

      fileLog(`Messages found: ${messages.length}`)
      for (const msg of messages) {
        const role = msg?.role ?? msg?.info?.role
        if (role !== "user") continue
        const text = extractTextFromMessage(msg)
        if (text.trim()) {
          fileLog(`Fetched user message: ${text.slice(0, 80)}`)
          return text.replace(/\n/g, " ").trim().slice(0, 120)
        }
      }

      fileLog(`No user message text found in ${messages.length} messages`)
    } catch (e: any) {
      fileLog(`fetchUserMessage error: ${e.message}`)
    }
    return ""
  }

  const ensureEnd = async () => {
    if (!enabled || !started) return
    const root = getWorkspaceRoot()
    if (!root) return
    await ensureRepo(root)
    if (!(await hasChanges(root))) {
      started = false
      toolChanges = []
      return
    }
    if (!userMessage && currentSessionID) {
      userMessage = await fetchUserMessage(currentSessionID)
    }
    const finalMessage = await generateCommitMessage(root)
    fileLog(`Committing: ${finalMessage.split("\n")[0]}`)
    await commit(root, AGENT_AUTHOR, AGENT_EMAIL, finalMessage)
    started = false
    toolChanges = []
    userMessage = ""
    currentSessionID = ""
  }

  fileLog(`Plugin loaded, ctx keys: ${Object.keys(ctx)}`)

  fileLog(`client available: ${!!client}, client keys: ${client ? Object.keys(client).join(",") : "N/A"}`)

  return {
    "tool.execute.before": async (input: any, _output: any) => {
      if (input?.sessionID) currentSessionID = input.sessionID
      fileLog(`tool.execute.before: tool=${input?.tool} session=${input?.sessionID || "?"}`)
      await ensureStart()
      collectToolChanges(input)
    },

    "tool.execute.after": async (input: any, _output: any) => {
      fileLog(`tool.execute.after: tool=${input?.tool}`)
    },

    event: async (payload: any) => {
      const eventType = payload?.event?.type ?? payload?.type ?? "unknown"
      const props = payload?.event?.properties ?? payload?.properties ?? {}
      const info = props?.info ?? {}

      if (!currentSessionID && info?.sessionID) {
        currentSessionID = info.sessionID
      }

      if (eventType === "session.idle" || eventType === "session.deleted") {
        fileLog(`${eventType}: sessionID=${currentSessionID}, userMessage=${userMessage || "(empty)"}`)
        await ensureEnd()
      }
    },
  }
}
