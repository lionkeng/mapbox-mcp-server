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
        'mapbox_geocoding_forward',
        'mapbox_geocoding_reverse',
        'mapbox_directions',
        'mapbox_matrix',
        'mapbox_isochrone',
        'mapbox_poi_search',
        'mapbox_category_search',
        'mapbox_static_map'
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
      const geocodeTool = tools.find(
        (t) => t.name === 'mapbox_geocoding_forward'
      );

      expect(geocodeTool).toBeDefined();
      expect(geocodeTool?.name).toBe('mapbox_geocoding_forward');
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
        'mapbox_geocoding_forward',
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
          'mapbox_geocoding_forward', // Requires geocode permission
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
        'mapbox_geocoding_forward',
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
      expect(toolRegistry.hasTool('mapbox_geocoding_reverse')).toBe(true);
      expect(toolRegistry.hasTool('mapbox_geocoding_forward')).toBe(true);
      expect(toolRegistry.hasTool('mapbox_directions')).toBe(true);
      expect(toolRegistry.hasTool('mapbox_poi_search')).toBe(true);
      expect(toolRegistry.hasTool('mapbox_category_search')).toBe(true);

      // Test permission mapping
      const tools = toolRegistry.listTools();
      const geocodeTools = tools.filter((t) => t.name.includes('geocoding'));
      const directionsTool = tools.find((t) => t.name === 'mapbox_directions');
      const poiTools = tools.filter(
        (t) => t.name.includes('poi') || t.name.includes('category')
      );

      expect(geocodeTools.length).toBeGreaterThan(0);
      expect(directionsTool).toBeDefined();
      expect(poiTools.length).toBeGreaterThan(0);
    });
  });
});
