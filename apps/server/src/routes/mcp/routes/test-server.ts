/**
 * POST /api/mcp/test - Test MCP server connection and list tools
 *
 * Tests connection to an MCP server and returns available tools.
 * Accepts either a serverId to look up config, or a full server config.
 *
 * Request body:
 *   { serverId: string } - Test server by ID from settings
 *   OR { serverConfig: MCPServerConfig } - Test with provided config
 *
 * Response: { success: boolean, tools?: MCPToolInfo[], error?: string, connectionTime?: number }
 */

import type { Request, Response } from 'express';
import type { MCPTestService } from '../../../services/mcp-test-service.js';
import type { MCPServerConfig } from '@automaker/types';
import { getErrorMessage, logError } from '../common.js';

interface TestServerRequest {
  serverId?: string;
  serverConfig?: MCPServerConfig;
}

/**
 * Create handler factory for POST /api/mcp/test
 */
export function createTestServerHandler(mcpTestService: MCPTestService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as TestServerRequest;

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

      res.json(result);
    } catch (error) {
      logError(error, 'Test server failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}
