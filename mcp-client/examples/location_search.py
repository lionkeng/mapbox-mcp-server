"""Location search and visualization example using the Mapbox MCP Agent."""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import logfire

from src.mapbox_agent import create_agent_with_deps

# Configure logfire
logfire.configure()


async def main():
    """Run location search and visualization examples."""
    print("🗺️  Mapbox MCP Agent - Location Search & Visualization Examples\n")
    
    # Create agent and dependencies
    agent, deps = await create_agent_with_deps()
    
    async with deps.mcp_client:
        # Example 1: POI search
        print("1. Point of Interest Search:")
        print("   Query: 'Find Italian restaurants near Union Square, San Francisco'")
        
        result = await agent.run(
            "Find Italian restaurants near Union Square, San Francisco",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 2: Static map generation
        print("2. Static Map Generation:")
        print("   Query: 'Show me a map of the Golden Gate Bridge area'")
        
        result = await agent.run(
            "Show me a map of the Golden Gate Bridge area",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.map_url:
            print(f"   Map URL: {result.output.map_url}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 3: Isochrone (reachable areas)
        print("3. Isochrone Analysis:")
        print("   Query: 'What areas can I reach within 15 minutes driving from downtown Seattle?'")
        
        result = await agent.run(
            "What areas can I reach within 15 minutes driving from downtown Seattle?",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 4: Combined search and visualization
        print("4. Combined Search & Visualization:")
        print("   Query: 'Find coffee shops near the Space Needle and show them on a map'")
        
        result = await agent.run(
            "Find coffee shops near the Space Needle and show them on a map",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.map_url:
            print(f"   Map URL: {result.output.map_url}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")


if __name__ == "__main__":
    asyncio.run(main())