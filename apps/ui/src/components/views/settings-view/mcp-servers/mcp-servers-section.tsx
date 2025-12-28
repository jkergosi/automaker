import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Plug,
  Plus,
  Pencil,
  Trash2,
  Terminal,
  Globe,
  FileJson,
  Download,
  RefreshCw,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { MCPServerConfig } from '@automaker/types';
import { syncSettingsToServer, loadMCPServersFromServer } from '@/hooks/use-settings-migration';
import { getHttpApiClient } from '@/lib/http-api-client';
import { MCPToolsList, type MCPToolDisplay } from './mcp-tools-list';

type ServerType = 'stdio' | 'sse' | 'http';

interface ServerFormData {
  name: string;
  description: string;
  type: ServerType;
  command: string;
  args: string;
  url: string;
  headers: string; // JSON string for headers
  env: string; // JSON string for env vars
}

const defaultFormData: ServerFormData = {
  name: '',
  description: '',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
  headers: '',
  env: '',
};

interface ServerTestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  tools?: MCPToolDisplay[];
  error?: string;
  connectionTime?: number;
}

export function MCPServersSection() {
  const {
    mcpServers,
    addMCPServer,
    updateMCPServer,
    removeMCPServer,
    mcpAutoApproveTools,
    mcpUnrestrictedTools,
    setMcpAutoApproveTools,
    setMcpUnrestrictedTools,
  } = useAppStore();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [formData, setFormData] = useState<ServerFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverTestStates, setServerTestStates] = useState<Record<string, ServerTestState>>({});
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  // Auto-load MCP servers from settings file on mount
  useEffect(() => {
    loadMCPServersFromServer().catch((error) => {
      console.error('Failed to load MCP servers on mount:', error);
    });
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const success = await loadMCPServersFromServer();
      if (success) {
        toast.success('MCP servers refreshed from settings');
      } else {
        toast.error('Failed to refresh MCP servers');
      }
    } catch (error) {
      toast.error('Error refreshing MCP servers');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTestServer = async (server: MCPServerConfig) => {
    setServerTestStates((prev) => ({
      ...prev,
      [server.id]: { status: 'testing' },
    }));

    try {
      const api = getHttpApiClient();
      const result = await api.mcp.testServer(server.id);

      if (result.success) {
        setServerTestStates((prev) => ({
          ...prev,
          [server.id]: {
            status: 'success',
            tools: result.tools,
            connectionTime: result.connectionTime,
          },
        }));
        // Auto-expand to show tools
        setExpandedServers((prev) => new Set([...prev, server.id]));
        toast.success(
          `Connected to ${server.name} (${result.tools?.length || 0} tools, ${result.connectionTime}ms)`
        );
      } else {
        setServerTestStates((prev) => ({
          ...prev,
          [server.id]: {
            status: 'error',
            error: result.error,
            connectionTime: result.connectionTime,
          },
        }));
        toast.error(`Failed to connect: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setServerTestStates((prev) => ({
        ...prev,
        [server.id]: {
          status: 'error',
          error: errorMessage,
        },
      }));
      toast.error(`Test failed: ${errorMessage}`);
    }
  };

  const toggleServerExpanded = (serverId: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const getTestStatusIcon = (status: ServerTestState['status']) => {
    switch (status) {
      case 'testing':
        return <Loader2 className="w-4 h-4 animate-spin text-brand-500" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return null;
    }
  };

  const handleOpenAddDialog = () => {
    setFormData(defaultFormData);
    setEditingServer(null);
    setIsAddDialogOpen(true);
  };

  const handleOpenEditDialog = (server: MCPServerConfig) => {
    setFormData({
      name: server.name,
      description: server.description || '',
      type: server.type || 'stdio',
      command: server.command || '',
      args: server.args?.join(' ') || '',
      url: server.url || '',
      headers: server.headers ? JSON.stringify(server.headers, null, 2) : '',
      env: server.env ? JSON.stringify(server.env, null, 2) : '',
    });
    setEditingServer(server);
    setIsAddDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsAddDialogOpen(false);
    setEditingServer(null);
    setFormData(defaultFormData);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Server name is required');
      return;
    }

    if (formData.type === 'stdio' && !formData.command.trim()) {
      toast.error('Command is required for stdio servers');
      return;
    }

    if ((formData.type === 'sse' || formData.type === 'http') && !formData.url.trim()) {
      toast.error('URL is required for SSE/HTTP servers');
      return;
    }

    // Parse headers if provided
    let parsedHeaders: Record<string, string> | undefined;
    if (formData.headers.trim()) {
      try {
        parsedHeaders = JSON.parse(formData.headers.trim());
        if (typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
          toast.error('Headers must be a JSON object');
          return;
        }
      } catch {
        toast.error('Invalid JSON for headers');
        return;
      }
    }

    // Parse env if provided
    let parsedEnv: Record<string, string> | undefined;
    if (formData.env.trim()) {
      try {
        parsedEnv = JSON.parse(formData.env.trim());
        if (typeof parsedEnv !== 'object' || Array.isArray(parsedEnv)) {
          toast.error('Environment variables must be a JSON object');
          return;
        }
      } catch {
        toast.error('Invalid JSON for environment variables');
        return;
      }
    }

    const serverData: Omit<MCPServerConfig, 'id'> = {
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      type: formData.type,
      enabled: editingServer?.enabled ?? true,
    };

    if (formData.type === 'stdio') {
      serverData.command = formData.command.trim();
      if (formData.args.trim()) {
        serverData.args = formData.args.trim().split(/\s+/);
      }
      if (parsedEnv) {
        serverData.env = parsedEnv;
      }
    } else {
      serverData.url = formData.url.trim();
      if (parsedHeaders) {
        serverData.headers = parsedHeaders;
      }
    }

    if (editingServer) {
      updateMCPServer(editingServer.id, serverData);
      toast.success('MCP server updated');
    } else {
      addMCPServer(serverData);
      toast.success('MCP server added');
    }

    await syncSettingsToServer();
    handleCloseDialog();
  };

  const handleToggleEnabled = async (server: MCPServerConfig) => {
    updateMCPServer(server.id, { enabled: !server.enabled });
    await syncSettingsToServer();
    toast.success(server.enabled ? 'Server disabled' : 'Server enabled');
  };

  const handleDelete = async (id: string) => {
    removeMCPServer(id);
    await syncSettingsToServer();
    setDeleteConfirmId(null);
    toast.success('MCP server removed');
  };

  const getServerIcon = (type: ServerType = 'stdio') => {
    if (type === 'stdio') return Terminal;
    return Globe;
  };

  const handleImportJson = async () => {
    try {
      const parsed = JSON.parse(importJson);

      // Support both formats:
      // 1. Claude Code format: { "mcpServers": { "name": { command, args, ... } } }
      // 2. Direct format: { "name": { command, args, ... } }
      const servers = parsed.mcpServers || parsed;

      if (typeof servers !== 'object' || Array.isArray(servers)) {
        toast.error('Invalid format: expected object with server configurations');
        return;
      }

      let addedCount = 0;
      let skippedCount = 0;

      for (const [name, config] of Object.entries(servers)) {
        if (typeof config !== 'object' || config === null) continue;

        const serverConfig = config as Record<string, unknown>;

        // Check if server with this name already exists
        if (mcpServers.some((s) => s.name === name)) {
          skippedCount++;
          continue;
        }

        const serverData: Omit<MCPServerConfig, 'id'> = {
          name,
          type: (serverConfig.type as ServerType) || 'stdio',
          enabled: true,
        };

        if (serverData.type === 'stdio') {
          if (!serverConfig.command) {
            console.warn(`Skipping ${name}: no command specified`);
            skippedCount++;
            continue;
          }
          serverData.command = serverConfig.command as string;
          if (Array.isArray(serverConfig.args)) {
            serverData.args = serverConfig.args as string[];
          }
          if (typeof serverConfig.env === 'object' && serverConfig.env !== null) {
            serverData.env = serverConfig.env as Record<string, string>;
          }
        } else {
          if (!serverConfig.url) {
            console.warn(`Skipping ${name}: no url specified`);
            skippedCount++;
            continue;
          }
          serverData.url = serverConfig.url as string;
          if (typeof serverConfig.headers === 'object' && serverConfig.headers !== null) {
            serverData.headers = serverConfig.headers as Record<string, string>;
          }
        }

        addMCPServer(serverData);
        addedCount++;
      }

      await syncSettingsToServer();

      if (addedCount > 0) {
        toast.success(`Imported ${addedCount} MCP server${addedCount > 1 ? 's' : ''}`);
      }
      if (skippedCount > 0) {
        toast.info(
          `Skipped ${skippedCount} server${skippedCount > 1 ? 's' : ''} (already exist or invalid)`
        );
      }
      if (addedCount === 0 && skippedCount === 0) {
        toast.warning('No servers found in JSON');
      }

      setIsImportDialogOpen(false);
      setImportJson('');
    } catch (error) {
      toast.error('Invalid JSON: ' + (error instanceof Error ? error.message : 'Parse error'));
    }
  };

  const handleExportJson = () => {
    const exportData: Record<string, Record<string, unknown>> = {};

    for (const server of mcpServers) {
      const serverConfig: Record<string, unknown> = {
        type: server.type || 'stdio',
      };

      if (server.type === 'stdio' || !server.type) {
        serverConfig.command = server.command;
        if (server.args?.length) serverConfig.args = server.args;
        if (server.env && Object.keys(server.env).length > 0) serverConfig.env = server.env;
      } else {
        serverConfig.url = server.url;
        if (server.headers && Object.keys(server.headers).length > 0)
          serverConfig.headers = server.headers;
      }

      exportData[server.name] = serverConfig;
    }

    const json = JSON.stringify({ mcpServers: exportData }, null, 2);
    navigator.clipboard.writeText(json);
    toast.success('Copied to clipboard');
  };

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-border/50',
        'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
        'shadow-sm shadow-black/5'
      )}
    >
      {/* Header */}
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
                <Plug className="w-5 h-5 text-brand-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">MCP Servers</h2>
            </div>
            <p className="text-sm text-muted-foreground/80 ml-12">
              Configure Model Context Protocol servers to extend agent capabilities.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRefresh}
              disabled={isRefreshing}
              data-testid="refresh-mcp-servers-button"
            >
              <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
            </Button>
            {mcpServers.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportJson}
                data-testid="export-mcp-servers-button"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsImportDialogOpen(true)}
              data-testid="import-mcp-servers-button"
            >
              <FileJson className="w-4 h-4 mr-2" />
              Import JSON
            </Button>
            <Button size="sm" onClick={handleOpenAddDialog} data-testid="add-mcp-server-button">
              <Plus className="w-4 h-4 mr-2" />
              Add Server
            </Button>
          </div>
        </div>
      </div>

      {/* Permission Settings */}
      {mcpServers.length > 0 && (
        <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="mcp-auto-approve" className="text-sm font-medium">
                  Auto-approve MCP tools
                </Label>
                <p className="text-xs text-muted-foreground">
                  Allow MCP tool calls without permission prompts (recommended)
                </p>
              </div>
              <Switch
                id="mcp-auto-approve"
                checked={mcpAutoApproveTools}
                onCheckedChange={async (checked) => {
                  setMcpAutoApproveTools(checked);
                  await syncSettingsToServer();
                }}
                data-testid="mcp-auto-approve-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="mcp-unrestricted" className="text-sm font-medium">
                  Unrestricted tools
                </Label>
                <p className="text-xs text-muted-foreground">
                  Allow all tools when MCP is enabled (don't filter to default set)
                </p>
              </div>
              <Switch
                id="mcp-unrestricted"
                checked={mcpUnrestrictedTools}
                onCheckedChange={async (checked) => {
                  setMcpUnrestrictedTools(checked);
                  await syncSettingsToServer();
                }}
                data-testid="mcp-unrestricted-toggle"
              />
            </div>
          </div>
        </div>
      )}

      {/* Server List */}
      <div className="p-6">
        {mcpServers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Plug className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No MCP servers configured</p>
            <p className="text-xs mt-1">Add a server to extend agent capabilities</p>
          </div>
        ) : (
          <div className="space-y-3">
            {mcpServers.map((server) => {
              const Icon = getServerIcon(server.type);
              const testState = serverTestStates[server.id];
              const isExpanded = expandedServers.has(server.id);
              const hasTools = testState?.tools && testState.tools.length > 0;

              return (
                <Collapsible
                  key={server.id}
                  open={isExpanded}
                  onOpenChange={() => toggleServerExpanded(server.id)}
                >
                  <div
                    className={cn(
                      'rounded-xl border',
                      server.enabled !== false
                        ? 'border-border/50 bg-accent/20'
                        : 'border-border/30 bg-muted/30 opacity-60'
                    )}
                    data-testid={`mcp-server-${server.id}`}
                  >
                    <div className="flex items-center justify-between p-4 gap-2">
                      <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                        <CollapsibleTrigger asChild>
                          <button
                            className={cn(
                              'flex items-center gap-3 text-left min-w-0 flex-1',
                              hasTools && 'cursor-pointer hover:opacity-80'
                            )}
                            disabled={!hasTools}
                          >
                            {hasTools ? (
                              isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                              )
                            ) : (
                              <div className="w-4 shrink-0" />
                            )}
                            <div
                              className={cn(
                                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                                server.enabled !== false ? 'bg-brand-500/20' : 'bg-muted'
                              )}
                            >
                              <Icon className="w-4 h-4 text-brand-500" />
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm truncate">{server.name}</span>
                                {testState && getTestStatusIcon(testState.status)}
                                {testState?.status === 'success' && testState.tools && (
                                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded whitespace-nowrap">
                                    {testState.tools.length} tool
                                    {testState.tools.length !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {server.description && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {server.description}
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground/60 mt-0.5 truncate">
                                {server.type === 'stdio'
                                  ? `${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}`
                                  : server.url}
                              </div>
                              {testState?.status === 'error' && testState.error && (
                                <div className="text-xs text-destructive mt-1 line-clamp-2 break-words">
                                  {testState.error}
                                </div>
                              )}
                            </div>
                          </button>
                        </CollapsibleTrigger>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTestServer(server)}
                          disabled={testState?.status === 'testing' || server.enabled === false}
                          data-testid={`mcp-server-test-${server.id}`}
                          className="h-8 px-2"
                        >
                          {testState?.status === 'testing' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <PlayCircle className="w-4 h-4" />
                          )}
                          <span className="ml-1.5 text-xs">Test</span>
                        </Button>
                        <Switch
                          checked={server.enabled !== false}
                          onCheckedChange={() => handleToggleEnabled(server)}
                          data-testid={`mcp-server-toggle-${server.id}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEditDialog(server)}
                          data-testid={`mcp-server-edit-${server.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirmId(server.id)}
                          data-testid={`mcp-server-delete-${server.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {hasTools && (
                      <CollapsibleContent>
                        <div className="px-4 pb-4 pt-0 ml-7 overflow-hidden">
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            Available Tools
                          </div>
                          <MCPToolsList
                            tools={testState.tools!}
                            isLoading={testState.status === 'testing'}
                            error={testState.error}
                            className="max-w-full"
                          />
                        </div>
                      </CollapsibleContent>
                    )}
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid="mcp-server-dialog">
          <DialogHeader>
            <DialogTitle>{editingServer ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
            <DialogDescription>
              Configure an MCP server to extend agent capabilities with custom tools.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="my-mcp-server"
                data-testid="mcp-server-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-description">Description (optional)</Label>
              <Input
                id="server-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What this server provides..."
                data-testid="mcp-server-description-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-type">Transport Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value: ServerType) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger id="server-type" data-testid="mcp-server-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Stdio (subprocess)</SelectItem>
                  <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.type === 'stdio' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server-command">Command</Label>
                  <Input
                    id="server-command"
                    value={formData.command}
                    onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                    placeholder="npx, node, python, etc."
                    data-testid="mcp-server-command-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server-args">Arguments (space-separated)</Label>
                  <Input
                    id="server-args"
                    value={formData.args}
                    onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                    placeholder="-y @modelcontextprotocol/server-filesystem"
                    data-testid="mcp-server-args-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server-env">Environment Variables (JSON, optional)</Label>
                  <Textarea
                    id="server-env"
                    value={formData.env}
                    onChange={(e) => setFormData({ ...formData, env: e.target.value })}
                    placeholder={'{\n  "API_KEY": "your-key"\n}'}
                    className="font-mono text-sm h-24"
                    data-testid="mcp-server-env-input"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server-url">URL</Label>
                  <Input
                    id="server-url"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder="https://example.com/mcp"
                    data-testid="mcp-server-url-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server-headers">Headers (JSON, optional)</Label>
                  <Textarea
                    id="server-headers"
                    value={formData.headers}
                    onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                    placeholder={
                      '{\n  "x-api-key": "your-api-key",\n  "Authorization": "Bearer token"\n}'
                    }
                    className="font-mono text-sm h-24"
                    data-testid="mcp-server-headers-input"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} data-testid="mcp-server-save-button">
              {editingServer ? 'Save Changes' : 'Add Server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent data-testid="mcp-server-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this MCP server? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              data-testid="mcp-server-confirm-delete-button"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import JSON Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="mcp-import-dialog">
          <DialogHeader>
            <DialogTitle>Import MCP Servers</DialogTitle>
            <DialogDescription>
              Paste JSON configuration in Claude Code format. Servers with duplicate names will be
              skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={`{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "type": "stdio"
    }
  }
}`}
              className="font-mono text-sm h-64"
              data-testid="mcp-import-textarea"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsImportDialogOpen(false);
                setImportJson('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImportJson}
              disabled={!importJson.trim()}
              data-testid="mcp-import-button"
            >
              <FileJson className="w-4 h-4 mr-2" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
