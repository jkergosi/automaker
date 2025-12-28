/**
 * POST /api/mcp/tools - List tools for an MCP server
 *
 * Lists available tools for an MCP server.
 * Similar to test but focused on tool discovery.
 *
 * Request body:
 *   { serverId: string } - Get tools by server ID from settings
 *   OR { serverConfig: MCPServerConfig } - Get tools with provided config
 *
 * Response: { success: boolean, tools?: MCPToolInfo[], error?: string }
 */

import type { Request, Response } from 'express';
import type { MCPTestService } from '../../../services/mcp-test-service.js';
import type { MCPServerConfig } from '@automaker/types';
import { getErrorMessage, logError } from '../common.js';

interface ListToolsRequest {
  serverId?: string;
  serverConfig?: MCPServerConfig;
}

/**
 * Create handler factory for POST /api/mcp/tools
 */
export function createListToolsHandler(mcpTestService: MCPTestService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as ListToolsRequest;

      if (!body.serverId && !body.serverConfig) {
        res.status(400).json({
          success: false,
          error: 'Either serverId or serverConfig is required',
        });
        return;
      }

      let result;
      if (body.serverId) {
        result = await mcpTestService.testServerById(body.serverId);
      } else if (body.serverConfig) {
        result = await mcpTestService.testServer(body.serverConfig);
      } else {
        res.status(400).json({
          success: false,
          error: 'Invalid request',
        });
        return;
      }

      // Return only tool-related information
      res.json({
        success: result.success,
        tools: result.tools,
        error: result.error,
      });
    } catch (error) {
      logError(error, 'List tools failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}
