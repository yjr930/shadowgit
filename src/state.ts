import * as vscode from 'vscode';

export interface AgentExecutionState {
    isExecuting: boolean;
    currentAgentTask: string;
    startTime: Date | null;
}

class AgentStateManager {
    private state: AgentExecutionState = {
        isExecuting: false,
        currentAgentTask: '',
        startTime: null
    };

    private stateChangeEmitter = new vscode.EventEmitter<AgentExecutionState>();

    public readonly onStateChange = this.stateChangeEmitter.event;

    getState(): AgentExecutionState {
        return { ...this.state };
    }

    startAgentTask(task: string): void {
        this.state = {
            isExecuting: true,
            currentAgentTask: task,
            startTime: new Date()
        };
        this.stateChangeEmitter.fire(this.getState());
    }

    endAgentTask(): void {
        this.state = {
            ...this.state,
            isExecuting: false
        };
        this.stateChangeEmitter.fire(this.getState());
    }

    updateTask(task: string): void {
        this.state = {
            ...this.state,
            currentAgentTask: task
        };
        this.stateChangeEmitter.fire(this.getState());
    }

    reset(): void {
        this.state = {
            isExecuting: false,
            currentAgentTask: '',
            startTime: null
        };
        this.stateChangeEmitter.fire(this.getState());
    }

    isAgentExecuting(): boolean {
        return this.state.isExecuting;
    }

    getCurrentTask(): string {
        return this.state.currentAgentTask;
    }
}

export const agentState = new AgentStateManager();
