/**
 * Unit tests for the tool registry
 * Tests tool registration, validation, and execution
 */

import { ToolRegistry } from '../server/toolRegistry.js';
import { ValidationError } from '@/utils/errors.js';

describe('Tool Registry', () => {
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
  });

  describe('Initialization', () => {
    it('should initialize with tools', () => {
      const stats = toolRegistry.getStats();

      expect(stats.totalTools).toBeGreaterThan(0);
      expect(Array.isArray(stats.toolNames)).toBe(true);
      expect(typeof stats.toolsByCategory).toBe('object');

      // Check that we have the expected Mapbox tools
      const expectedTools = [
        'forward_geocode_tool',
        'reverse_geocode_tool',
        'directions_tool',
        'matrix_tool',
        'isochrone_tool',
        'poi_search_tool',
        'category_search_tool',
        'static_map_image_tool'
      ];

      expectedTools.forEach((toolName) => {
        expect(toolRegistry.hasTool(toolName)).toBe(true);
      });
    });
  });

  describe('Tool Listing', () => {
    it('should return tool definitions', () => {
      const tools = toolRegistry.listTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      // Check tool structure
      tools.forEach((tool) => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
      });
    });

    it('should return tools with proper structure', () => {
      const tools = toolRegistry.listTools();
      const geocodeTool = tools.find((t) => t.name === 'forward_geocode_tool');

      expect(geocodeTool).toBeDefined();
      expect(geocodeTool?.name).toBe('forward_geocode_tool');
      expect(geocodeTool?.description).toContain('geocod');
      expect(geocodeTool?.inputSchema).toBeDefined();
      expect(typeof geocodeTool?.inputSchema).toBe('object');
    });
  });

  describe('Tool Execution', () => {
    it('should execute tools with proper permissions', async () => {
      const user = {
        sub: 'test-user',
        permissions: ['mapbox:*']
      };

      const result = await toolRegistry.executeTool(
        'forward_geocode_tool',
        { q: 'San Francisco', limit: 1 },
        user
      );

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('should throw for non-existent tool', async () => {
      const user = {
        sub: 'test-user',
        permissions: ['mapbox:*']
      };

      await expect(
        toolRegistry.executeTool('nonexistent_tool', {}, user)
      ).rejects.toThrow(ValidationError);
    });

    it('should check permissions', async () => {
      const user = {
        sub: 'test-user',
        permissions: ['mapbox:directions'] // Only directions permission
      };

      await expect(
        toolRegistry.executeTool(
          'forward_geocode_tool', // Requires geocode permission
          { q: 'San Francisco', limit: 1 },
          user
        )
      ).rejects.toThrow('Insufficient permissions');
    });

    it('should allow wildcard permissions', async () => {
      const user = {
        sub: 'test-user',
        permissions: ['mapbox:*']
      };

      const result = await toolRegistry.executeTool(
        'forward_geocode_tool',
        { q: 'San Francisco', limit: 1 },
        user
      );

      expect(result).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should return correct count', () => {
      const count = toolRegistry.getToolCount();
      const stats = toolRegistry.getStats();

      expect(count).toBe(stats.toolNames.length);
      expect(count).toBeGreaterThan(0);
    });

    it('should return comprehensive statistics', () => {
      const stats = toolRegistry.getStats();

      expect(typeof stats.totalTools).toBe('number');
      expect(Array.isArray(stats.toolNames)).toBe(true);
      expect(typeof stats.toolsByCategory).toBe('object');
      expect(stats.toolsByCategory.geocode).toBeDefined();
      expect(stats.toolsByCategory.directions).toBeDefined();
      expect(stats.toolsByCategory.poi).toBeDefined();

      // Category counts should match total
      const categorySum = Object.values(stats.toolsByCategory).reduce(
        (sum: number, tools) => sum + tools.length,
        0
      );
      expect(categorySum).toBe(stats.totalTools);
    });
  });

  describe('Tool Permissions', () => {
    it('should have correct permission mappings', () => {
      expect(toolRegistry.hasTool('reverse_geocode_tool')).toBe(true);
      expect(toolRegistry.hasTool('forward_geocode_tool')).toBe(true);
      expect(toolRegistry.hasTool('directions_tool')).toBe(true);
      expect(toolRegistry.hasTool('poi_search_tool')).toBe(true);
      expect(toolRegistry.hasTool('category_search_tool')).toBe(true);

      // Test permission mapping
      const tools = toolRegistry.listTools();
      const geocodeTools = tools.filter((t) => t.name.includes('geocode_tool'));
      const directionsTool = tools.find((t) => t.name === 'directions_tool');
      const poiTools = tools.filter(
        (t) =>
          t.name.includes('poi_search_tool') ||
          t.name.includes('category_search_tool')
      );

      expect(geocodeTools.length).toBeGreaterThan(0);
      expect(directionsTool).toBeDefined();
      expect(poiTools.length).toBeGreaterThan(0);
    });

    it('should have permissions defined for all registered tools', () => {
      const tools = toolRegistry.listTools();

      // Verify that all tools have permissions defined
      tools.forEach((tool) => {
        expect(tool.permissions).toBeDefined();
        expect(Array.isArray(tool.permissions)).toBe(true);
        expect(tool.permissions!.length).toBeGreaterThan(0);
      });
    });

    it('should throw error for undefined tool permissions', () => {
      // Test accessing the private method through reflection to verify error handling
      const toolRegistryAny = toolRegistry as any;

      expect(() => {
        toolRegistryAny.getToolPermissions('nonexistent_tool');
      }).toThrow(ValidationError);

      expect(() => {
        toolRegistryAny.getToolPermissions('nonexistent_tool');
      }).toThrow('No permissions defined for tool: nonexistent_tool');
    });
  });
});
