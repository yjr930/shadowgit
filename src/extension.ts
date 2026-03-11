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

let serverRef: { stop(): void } | undefined;

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
            vscode.window.showWarningMessage('Failed to initialize Shadow Git');
        }
    });

    timelineView.refresh();

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            timelineView.refresh();
        })
    );

    setImmediate(async () => {
        const [{ registerCommands }, { agentHttpServer }, { diffPanel, preloadHighlighter }] = await Promise.all([
            import('./commands'),
            import('./server'),
            import('./diffPanel')
        ]);

        registerCommands(context);
        context.subscriptions.push(diffPanel);

        agentHttpServer.start().catch(err => {
            console.error('[ShadowGit] Failed to start HTTP server:', err);
        });
        serverRef = agentHttpServer;

        setTimeout(() => preloadHighlighter(), 3000);
    });
}

export function deactivate(): void {
    serverRef?.stop();
}
