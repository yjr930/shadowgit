import * as vscode from 'vscode';
import { shadowGit } from './shadowGit';
import { timelineView } from './timeline';

const DiffDocumentProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
        const params = new URLSearchParams(uri.query);
        const commitHash = params.get('commit');
        const filePath = params.get('path');
        
        if (!commitHash || !filePath) {
            return null;
        }
        
        return shadowGit.getFileAtCommit(commitHash, filePath);
    }
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Shadow Git requires an open workspace folder');
        return;
    }

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('shadowgit-diff', DiffDocumentProvider)
    );

    shadowGit.initialize().then(success => {
        if (!success) {
            console.log('[ShadowGit] .agent-repo not found; waiting for commits');
        }
    });

    timelineView.refresh();

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            timelineView.refresh();
        })
    );

    const refreshTimelineDebounced = (() => {
        let timeout: NodeJS.Timeout | undefined;
        return () => {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => timelineView.refresh(), 300);
        };
    })();

    const repoWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, '.agent-repo/{HEAD,refs/**,logs/HEAD}')
    );
    repoWatcher.onDidChange(refreshTimelineDebounced);
    repoWatcher.onDidCreate(refreshTimelineDebounced);
    repoWatcher.onDidDelete(refreshTimelineDebounced);
    context.subscriptions.push(repoWatcher);

    setImmediate(async () => {
        const [{ registerCommands }, { diffPanel, preloadHighlighter }] = await Promise.all([
            import('./commands'),
            import('./diffPanel')
        ]);

        registerCommands(context);
        context.subscriptions.push(diffPanel);

        setTimeout(() => preloadHighlighter(), 3000);
    });
}

export function deactivate(): void {
}
