import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SHADOW_REPO_DIR = '.agent-repo';

export interface CommitInfo {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: Date;
    message: string;
    isAgent: boolean;
}

export class ShadowGit {
    private workspaceRoot: string | undefined;
    private repoPath: string | undefined;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (this.workspaceRoot) {
            this.repoPath = path.join(this.workspaceRoot, SHADOW_REPO_DIR);
        }
    }

    async initRepo(): Promise<boolean> {
        if (!this.workspaceRoot || !this.repoPath) {
            vscode.window.showErrorMessage('No workspace folder found');
            return false;
        }

        try {
            if (!fs.existsSync(this.repoPath)) {
                fs.mkdirSync(this.repoPath, { recursive: true });
            }

            const headPath = path.join(this.repoPath, 'HEAD');
            if (!fs.existsSync(headPath)) {
                const { execFile } = require('child_process');
                const { promisify } = require('util');
                const execFileAsync = promisify(execFile);
                
                await execFileAsync('git', ['init'], {
                    cwd: this.workspaceRoot,
                    env: {
                        ...process.env,
                        GIT_DIR: this.repoPath,
                        GIT_WORK_TREE: this.workspaceRoot
                    }
                });
            }

            this.ensureGitignore();
            this.ensureOpencodeConfig();

            vscode.window.showInformationMessage('Shadow Git repository initialized');
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to initialize: ${error.message}`);
            return false;
        }
    }

    private ensureGitignore(): void {
        if (!this.workspaceRoot) return;
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        try {
            if (fs.existsSync(gitignorePath)) {
                const content = fs.readFileSync(gitignorePath, 'utf8');
                if (!content.includes('.agent-repo/')) {
                    fs.appendFileSync(gitignorePath, '\n.agent-repo/\n');
                }
            } else {
                fs.writeFileSync(gitignorePath, '.agent-repo/\n');
            }
        } catch {}
    }

    private ensureOpencodeConfig(): void {
        if (!this.workspaceRoot) return;
        const configPath = path.join(this.workspaceRoot, '.opencode.yaml');
        try {
            if (!fs.existsSync(configPath)) {
                fs.writeFileSync(configPath, 'plugins:\n  - name: shadowgit\n    enabled: true\n');
            }
        } catch {}
    }

    async initialize(): Promise<boolean> {
        if (!this.workspaceRoot || !this.repoPath) {
            return false;
        }

        try {
            const headPath = path.join(this.repoPath, 'HEAD');
            return fs.existsSync(headPath);
        } catch (error) {
            console.error('Failed to initialize Shadow Git:', error);
            return false;
        }
    }

    private hasRepo(): boolean {
        if (!this.repoPath) {
            return false;
        }
        return fs.existsSync(path.join(this.repoPath, 'HEAD'));
    }

    private async execGit(args: string[]): Promise<string> {
        if (!this.workspaceRoot) {
            throw new Error('No workspace folder found');
        }
        if (!this.hasRepo()) {
            throw new Error('Shadow Git repo not initialized');
        }

        const env = {
            ...process.env,
            GIT_DIR: this.repoPath,
            GIT_WORK_TREE: this.workspaceRoot,
            HOME: process.env.HOME || '/root'
        };

        const filteredArgs = args.filter(arg => arg !== undefined && arg !== null);

        try {
            const { stdout, stderr } = await execFileAsync('git', filteredArgs, {
                cwd: this.workspaceRoot,
                env
            });
            return stdout || stderr;
        } catch (error: any) {
            if (error.stdout) {
                return error.stdout;
            }
            throw error;
        }
    }

    async hasChanges(): Promise<boolean> {
        try {
            const status = await this.execGit(['status', '--porcelain']);
            return status.trim().length > 0;
        } catch {
            return false;
        }
    }

    async commit(author: string, email: string, message: string): Promise<boolean> {
        try {
            await this.execGit(['config', 'user.name', author]);
            await this.execGit(['config', 'user.email', email]);
            await this.execGit(['add', '-A']);
            await this.execGit(['commit', '-m', message]);
            return true;
        } catch (error) {
            console.error('Failed to commit:', error);
            return false;
        }
    }

    async getLog(limit: number = 50): Promise<CommitInfo[]> {
        console.log('[ShadowGit] getLog called, workspace:', this.workspaceRoot);
        try {
            if (!this.hasRepo()) {
                return [];
            }
            const format = '%H|%h|%an|%ae|%ai|%s';
            const output = await this.execGit([
                'log',
                `--format=${format}`,
                '-n',
                limit.toString()
            ]);

            console.log('[ShadowGit] git log output:', output);
            
            if (!output.trim()) {
                console.log('[ShadowGit] no commits found');
                return [];
            }

            const commits: CommitInfo[] = [];
            for (const line of output.trim().split('\n')) {
                if (!line) continue;
                const [hash, shortHash, author, email, dateStr, ...msgParts] = line.split('|');
                const message = msgParts.join('|');
                const isAgent = message.startsWith('Agent:');

                commits.push({
                    hash,
                    shortHash,
                    author,
                    email,
                    date: new Date(dateStr),
                    message,
                    isAgent
                });
            }

            return commits;
        } catch (error) {
            console.error('Failed to get log:', error);
            return [];
        }
    }

    async getFileAtCommit(commitHash: string, filePath: string): Promise<string | null> {
        try {
            if (!this.hasRepo()) {
                return null;
            }
            const fullPath = path.isAbsolute(filePath) 
                ? filePath 
                : path.join(this.workspaceRoot!, filePath);
            const relativePath = path.relative(this.workspaceRoot!, fullPath);
            
            const content = await this.execGit([
                'show',
                `${commitHash}:${relativePath}`
            ]);
            return content;
        } catch (error) {
            return null;
        }
    }

    async getParentCommitHash(commitHash: string): Promise<string | null> {
        try {
            if (!this.hasRepo()) {
                return null;
            }
            const output = await this.execGit([
                'log',
                '--format=%H',
                '-n',
                '1',
                `${commitHash}~1`
            ]);
            return output.trim() || null;
        } catch {
            return null;
        }
    }

    async getCommitFiles(commitHash: string): Promise<{ path: string; additions: number; deletions: number; status: string }[]> {
        try {
            if (!this.hasRepo()) {
                return [];
            }
            const numstatOutput = await this.execGit([
                'log',
                '--format=',
                '--numstat',
                '-n',
                '1',
                commitHash
            ]);
            
            const nameStatusOutput = await this.execGit([
                'show',
                '--name-status',
                '--format=',
                '-n',
                '1',
                commitHash
            ]);
            
            if (!numstatOutput.trim()) {
                return [];
            }
            
            const statusMap = new Map<string, string>();
            for (const line of nameStatusOutput.trim().split('\n')) {
                const match = line.match(/^([AMD])\s+(.+)$/);
                if (match) {
                    statusMap.set(match[2], match[1]);
                }
            }
            
            const files: { path: string; additions: number; deletions: number; status: string }[] = [];
            for (const line of numstatOutput.trim().split('\n')) {
                const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
                if (match) {
                    const deletions = match[1] === '-' ? 0 : parseInt(match[1]);
                    const additions = match[2] === '-' ? 0 : parseInt(match[2]);
                    const path = match[3];
                    const status = statusMap.get(path) || 'M';
                    files.push({ path, additions, deletions, status });
                }
            }
            return files;
        } catch {
            return [];
        }
    }

    private static readonly MAX_DIFF_FILES = 50;
    private static readonly MAX_FILE_SIZE = 100 * 1024; // 100KB

    async getCommitDiff(commitHash: string): Promise<{ files: { path: string; status: string; oldContent: string; newContent: string }[]; truncated?: number }> {
        try {
            const allFiles = await this.getCommitFiles(commitHash);
            const parentHash = await this.getParentCommitHash(commitHash);
            const truncated = allFiles.length > ShadowGit.MAX_DIFF_FILES ? allFiles.length - ShadowGit.MAX_DIFF_FILES : 0;
            const files = allFiles.slice(0, ShadowGit.MAX_DIFF_FILES);
            
            const result: { path: string; status: string; oldContent: string; newContent: string }[] = [];
            
            for (const file of files) {
                let oldContent = '';
                let newContent = '';
                
                try {
                    if (file.status === 'A') {
                        newContent = await this.getFileAtCommit(commitHash, file.path) || '';
                    } else if (file.status === 'D') {
                        if (parentHash) {
                            oldContent = await this.getFileAtCommit(parentHash, file.path) || '';
                        }
                    } else {
                        if (parentHash) {
                            oldContent = await this.getFileAtCommit(parentHash, file.path) || '';
                        }
                        newContent = await this.getFileAtCommit(commitHash, file.path) || '';
                    }

                    if (oldContent.length > ShadowGit.MAX_FILE_SIZE) {
                        oldContent = oldContent.slice(0, ShadowGit.MAX_FILE_SIZE) + '\n... (truncated, file too large)';
                    }
                    if (newContent.length > ShadowGit.MAX_FILE_SIZE) {
                        newContent = newContent.slice(0, ShadowGit.MAX_FILE_SIZE) + '\n... (truncated, file too large)';
                    }
                } catch {
                    newContent = '(failed to load content)';
                }
                
                result.push({
                    path: file.path,
                    status: file.status,
                    oldContent,
                    newContent
                });
            }
            
            result.sort((a, b) => a.path.localeCompare(b.path));
            
            return { files: result, truncated };
        } catch {
            return { files: [] };
        }
    }

    async revertToCommit(commitHash: string): Promise<boolean> {
        try {
            if (!this.hasRepo()) {
                vscode.window.showWarningMessage('Shadow Git repo not initialized');
                return false;
            }
            const parentHash = await this.getParentCommitHash(commitHash);
            
            if (!parentHash) {
                vscode.window.showWarningMessage('Cannot revert the first commit');
                return false;
            }
            
            const currentFiles = fs.readdirSync(this.workspaceRoot!).filter((f: string) => f !== '.agent-repo');
            const parentFileList = await this.getCommitFiles(parentHash);
            const parentFiles = new Set(parentFileList.map(f => f.path));
            
            for (const file of currentFiles) {
                const fullPath = path.join(this.workspaceRoot!, file);
                const stat = fs.statSync(fullPath);
                if (stat.isFile() && !parentFiles.has(file)) {
                    fs.unlinkSync(fullPath);
                }
            }
            
            await this.execGit(['checkout', parentHash, '--', '.']);
            await this.execGit(['reset', 'HEAD', '.']);
            
            vscode.window.showInformationMessage('Reverted to parent commit');
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to revert: ${error.message}`);
            return false;
        }
    }

    async checkoutToCommit(commitHash: string): Promise<boolean> {
        try {
            if (!this.hasRepo()) {
                vscode.window.showWarningMessage('Shadow Git repo not initialized');
                return false;
            }
            const lsTreeOutput = await this.execGit([
                'ls-tree',
                '-r',
                '--name-only',
                commitHash
            ]);
            
            const targetFiles = new Set(
                lsTreeOutput.trim().split('\n').filter(f => f)
            );
            
            const currentFiles = fs.readdirSync(this.workspaceRoot!).filter((f: string) => f !== '.agent-repo');
            
            for (const file of currentFiles) {
                const fullPath = path.join(this.workspaceRoot!, file);
                const stat = fs.statSync(fullPath);
                if (stat.isFile() && !targetFiles.has(file)) {
                    fs.unlinkSync(fullPath);
                }
            }
            
            await this.execGit(['checkout', commitHash, '--', '.']);
            await this.execGit(['reset', 'HEAD', '.']);
            
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to checkout: ${error.message}`);
            return false;
        }
    }

    async truncateHistoryBefore(commitHash: string): Promise<boolean> {
        try {
            if (!this.hasRepo()) {
                vscode.window.showWarningMessage('Shadow Git repo not initialized');
                return false;
            }
            await this.execGit(['replace', '--graft', commitHash]);
            await this.execGit(['filter-branch', '--', '--all']);
            // Clean up replace ref and filter-branch backup
            try { await this.execGit(['replace', '-d', commitHash]); } catch { /* may not exist */ }
            try { await this.execGit(['for-each-ref', '--format=delete %(refname)', 'refs/original/']); } catch { /* ignore */ }
            const refs = await this.execGit(['for-each-ref', '--format=%(refname)', 'refs/original/']);
            for (const ref of refs.trim().split('\n').filter(r => r)) {
                try { await this.execGit(['update-ref', '-d', ref]); } catch { /* ignore */ }
            }
            await this.execGit(['reflog', 'expire', '--expire=now', '--all']);
            await this.execGit(['gc', '--prune=now', '--aggressive']);
            return true;
        } catch (error) {
            console.error('Failed to truncate history:', error);
            return false;
        }
    }

    getExcludePatterns(): string[] {
        if (!this.repoPath) return [];
        const excludePath = path.join(this.repoPath, 'info', 'exclude');
        try {
            if (!fs.existsSync(excludePath)) return [];
            return fs.readFileSync(excludePath, 'utf8')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'));
        } catch {
            return [];
        }
    }

    async getTrackedByExclude(): Promise<string[]> {
        if (!this.hasRepo()) return [];
        const patterns = this.getExcludePatterns();
        if (patterns.length === 0) return [];

        const tracked: Set<string> = new Set();
        try {
            const output = await this.execGit(['ls-files']);
            const files = output.trim().split('\n').filter(f => f);

            for (const file of files) {
                for (const pattern of patterns) {
                    const dir = pattern.replace(/\/+$/, '');
                    if (
                        file === dir ||
                        file.startsWith(dir + '/') ||
                        file.endsWith(pattern.replace('*', '')) ||
                        (pattern.startsWith('*.') && file.endsWith(pattern.slice(1)))
                    ) {
                        tracked.add(dir + '/');
                        break;
                    }
                }
            }
        } catch {}
        return Array.from(tracked);
    }

    async cleanExcludedFromHistory(
        onProgress?: (msg: string) => void
    ): Promise<{ success: boolean; cleaned: string[]; size: string; error?: string }> {
        if (!this.hasRepo() || !this.repoPath || !this.workspaceRoot) {
            return { success: false, cleaned: [], size: 'N/A', error: 'Repository not initialized' };
        }

        const toClean = await this.getTrackedByExclude();
        if (toClean.length === 0) {
            return { success: true, cleaned: [], size: await this.getRepoSize() };
        }

        try {
            // Clean up stale .git-rewrite from previous failed filter-branch
            const gitRewriteDir = path.join(this.workspaceRoot!, '.git-rewrite');
            if (fs.existsSync(gitRewriteDir)) {
                fs.rmSync(gitRewriteDir, { recursive: true, force: true });
                await this.execGit(['rm', '-r', '--cached', '--ignore-unmatch', '.git-rewrite']);
                try { await this.execGit(['commit', '-m', 'Remove stale .git-rewrite']); } catch {}
            }

            // Remove stale refs/original from previous runs
            const refsOriginal = path.join(this.repoPath, 'refs', 'original');
            if (fs.existsSync(refsOriginal)) {
                fs.rmSync(refsOriginal, { recursive: true, force: true });
            }

            const hasUnstaged = await this.hasChanges();
            if (hasUnstaged) {
                await this.execGit(['stash']);
            }

            // Shell-escape paths for the index-filter command
            const rmArgs = toClean.map(p => {
                const escaped = p.replace(/'/g, "'\\''");
                return `git rm -r --cached --ignore-unmatch '${escaped}'`;
            }).join(' && ');

            const env = {
                ...process.env,
                GIT_DIR: this.repoPath,
                GIT_WORK_TREE: this.workspaceRoot,
                HOME: process.env.HOME || '/root',
                FILTER_BRANCH_SQUELCH_WARNING: '1',
            };

            onProgress?.(`正在从历史中移除: ${toClean.join(', ')}`);
            await execFileAsync('git', [
                'filter-branch', '--force', '--index-filter',
                rmArgs,
                '--prune-empty', '--', '--all'
            ], {
                cwd: this.workspaceRoot,
                env,
                maxBuffer: 50 * 1024 * 1024,
            });

            // Clean up refs/original created by filter-branch
            if (fs.existsSync(refsOriginal)) {
                fs.rmSync(refsOriginal, { recursive: true, force: true });
            }

            // Clean up .git-rewrite if filter-branch left it
            if (fs.existsSync(gitRewriteDir)) {
                fs.rmSync(gitRewriteDir, { recursive: true, force: true });
            }

            onProgress?.('正在回收空间...');
            await this.execGit(['reflog', 'expire', '--expire=now', '--all']);
            await this.execGit(['gc', '--prune=now', '--aggressive']);

            if (hasUnstaged) {
                try { await this.execGit(['stash', 'pop']); } catch {}
            }

            return { success: true, cleaned: toClean, size: await this.getRepoSize() };
        } catch (error: any) {
            const errMsg = error?.stderr || error?.message || String(error);
            console.error('Failed to clean excluded from history:', errMsg);
            return { success: false, cleaned: [], size: 'N/A', error: errMsg };
        }
    }

    async getRepoSize(): Promise<string> {
        try {
            if (!this.hasRepo()) return 'N/A';
            const output = await this.execGit(['count-objects', '-vH']);
            const sizeMatch = output.match(/size-pack:\s*(.+)/);
            const looseMatch = output.match(/^size:\s*(.+)/m);
            const packSize = sizeMatch?.[1]?.trim() || '0';
            const looseSize = looseMatch?.[1]?.trim() || '0';
            return `loose: ${looseSize}, packed: ${packSize}`;
        } catch {
            return 'N/A';
        }
    }

    getRepoPath(): string | undefined {
        return this.repoPath;
    }
}

export const shadowGit = new ShadowGit();
