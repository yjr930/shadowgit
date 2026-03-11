import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import { agentState } from './state';
import { fileChangeHooks } from './hooks';
import { shadowGit } from './shadowGit';
import { timelineView } from './timeline';

class AgentHttpServer {
    private server: http.Server | null = null;
    private port: number = 19789;
    private configPath: string = '';

    private async getConfig(): Promise<{ port: number }> {
        const defaultConfigPath = path.join(process.env.HOME || '/root', '.shadowgit', 'config.yaml');
        
        const config = vscode.workspace.getConfiguration('shadowgit');
        const configuredPath = config.get<string>('configPath');

        this.configPath = configuredPath || defaultConfigPath;

        try {
            const fs = require('fs');
            if (fs.existsSync(this.configPath)) {
                const content = await fs.promises.readFile(this.configPath, 'utf8');
                const portMatch = content.match(/port:\s*(\d+)/);
                if (portMatch) {
                    return { port: parseInt(portMatch[1]) };
                }
            }
        } catch (e) {
            console.log('[ShadowGit] Config file not found, using defaults');
        }

        return { port: 19789 };
    }

    async start(): Promise<void> {
        const { port } = await this.getConfig();
        this.port = port;

        if (this.server) {
            this.stop();
        }

        this.server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            const url = req.url || '/';
            const method = req.method;

            try {
                if (method === 'GET' && url === '/status') {
                    this.sendJson(res, {
                        status: 'ok',
                        isExecuting: agentState.isAgentExecuting(),
                        currentTask: agentState.getCurrentTask()
                    });
                    return;
                }

                if (method === 'POST' && url === '/start') {
                    let body = '';
                    for await (const chunk of req) {
                        body += chunk;
                    }
                    const { task } = JSON.parse(body);

                    if (!task) {
                        this.sendJson(res, { error: 'Task description required' }, 400);
                        return;
                    }

                    await fileChangeHooks.preAgentAutoSave();
                    agentState.startAgentTask(task);
                    timelineView.refresh();

                    this.sendJson(res, { status: 'started', task });
                    return;
                }

                if (method === 'POST' && url === '/end') {
                    const state = agentState.getState();
                    if (!state.isExecuting) {
                        this.sendJson(res, { error: 'No agent task is executing' }, 400);
                        return;
                    }

                    await fileChangeHooks.postAgentCommit(state.currentAgentTask);
                    agentState.endAgentTask();
                    timelineView.refresh();

                    this.sendJson(res, { status: 'ended' });
                    return;
                }

                if (method === 'GET' && url === '/commits') {
                    const commits = await shadowGit.getLog(50);
                    const formatted = commits.map(c => ({
                        hash: c.hash,
                        shortHash: c.shortHash,
                        message: c.message,
                        isAgent: c.isAgent,
                        date: c.date.toISOString()
                    }));
                    this.sendJson(res, { commits: formatted });
                    return;
                }

                this.sendJson(res, { error: 'Not found' }, 404);
            } catch (error: any) {
                this.sendJson(res, { error: error.message }, 500);
            }
        });

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, () => {
                console.log(`[ShadowGit] HTTP server running on port ${this.port}`);
                resolve();
            });
            this.server!.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    vscode.window.showWarningMessage(`Port ${this.port} is in use. Please change the port in settings.`);
                }
                reject(err);
            });
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            console.log('[ShadowGit] HTTP server stopped');
        }
    }

    private sendJson(res: http.ServerResponse, data: any, statusCode: number = 200): void {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
}

export const agentHttpServer = new AgentHttpServer();
