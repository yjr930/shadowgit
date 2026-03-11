import * as vscode from 'vscode';
import { shadowGit } from './shadowGit';
import { agentState } from './state';

const HUMAN_AUTHOR = 'Yukio';
const HUMAN_EMAIL = 'yukio@localhost';
const AGENT_AUTHOR = 'AI Agent';
const AGENT_EMAIL = 'agent@localhost';

class FileChangeHooks {
    private disposables: vscode.Disposable[] = [];
    private pendingChanges: Set<string> = new Set();
    private preAgentCommitted: boolean = false;

    constructor() {
        this.setupHooks();
    }

    private setupHooks(): void {
        const saveListener = vscode.workspace.onWillSaveTextDocument(async (event) => {
            if (!agentState.isAgentExecuting() && !this.preAgentCommitted) {
                return;
            }

            if (agentState.isAgentExecuting()) {
                this.pendingChanges.add(event.document.uri.fsPath);
            }
        });

        const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
            if (agentState.isAgentExecuting()) {
                this.pendingChanges.add(event.document.uri.fsPath);
            }
        });

        this.disposables.push(saveListener, changeListener);
    }

    async preAgentAutoSave(): Promise<void> {
        if (!await shadowGit.hasChanges()) {
            return;
        }

        const success = await shadowGit.commit(
            HUMAN_AUTHOR,
            HUMAN_EMAIL,
            'Human changes auto-tracked'
        );

        if (success) {
            this.preAgentCommitted = true;
        }
    }

    async postAgentCommit(message: string): Promise<boolean> {
        if (!message) {
            message = agentState.getCurrentTask() || '🤖 Unspecified modification';
        }

        const success = await shadowGit.commit(
            AGENT_AUTHOR,
            AGENT_EMAIL,
            `Agent: ${message}`
        );

        if (success) {
            this.pendingChanges.clear();
            this.preAgentCommitted = false;
        }

        return success;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

export const fileChangeHooks = new FileChangeHooks();
