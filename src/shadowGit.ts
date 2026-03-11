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

    async initialize(): Promise<boolean> {
        if (!this.workspaceRoot || !this.repoPath) {
            return false;
        }

        try {
            const headPath = path.join(this.repoPath, 'HEAD');
            if (fs.existsSync(headPath)) {
                setImmediate(() => this.ensureGitignore());
                return true;
            }
            await this.execGit(['init']);
            await this.ensureGitignore();
            return true;
        } catch (error) {
            console.error('Failed to initialize Shadow Git:', error);
            return false;
        }
    }

    private async execGit(args: string[]): Promise<string> {
        if (!this.workspaceRoot) {
            throw new Error('No workspace folder found');
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

    private ensureGitignore(): void {
        if (!this.workspaceRoot) return;

        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');

        try {
            if (fs.existsSync(gitignorePath)) {
                const content = fs.readFileSync(gitignorePath, 'utf8');
                if (!content.includes(SHADOW_REPO_DIR)) {
                    fs.appendFileSync(gitignorePath, `\n${SHADOW_REPO_DIR}/\n`);
                }
            } else {
                fs.writeFileSync(gitignorePath, `${SHADOW_REPO_DIR}/\n`);
            }
        } catch (error) {
            console.error('Failed to update .gitignore:', error);
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

    async getCommitDiff(commitHash: string): Promise<{ files: { path: string; status: string; oldContent: string; newContent: string }[] }> {
        try {
            const files = await this.getCommitFiles(commitHash);
            const parentHash = await this.getParentCommitHash(commitHash);
            
            const result: { path: string; status: string; oldContent: string; newContent: string }[] = [];
            
            for (const file of files) {
                let oldContent = '';
                let newContent = '';
                
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
                
                result.push({
                    path: file.path,
                    status: file.status,
                    oldContent,
                    newContent
                });
            }
            
            result.sort((a, b) => a.path.localeCompare(b.path));
            
            return { files: result };
        } catch {
            return { files: [] };
        }
    }

    async revertToCommit(commitHash: string): Promise<boolean> {
        try {
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

    getRepoPath(): string | undefined {
        return this.repoPath;
    }
}

export const shadowGit = new ShadowGit();
