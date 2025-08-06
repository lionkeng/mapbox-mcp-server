"""Route planning example using the Mapbox MCP Agent."""
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
    """Run route planning examples."""
    print("🗺️  Mapbox MCP Agent - Route Planning Examples\n")
    
    # Create agent and dependencies
    agent, deps = await create_agent_with_deps()
    
    async with deps.mcp_client:
        # Example 1: Basic directions
        print("1. Basic Directions:")
        print("   Query: 'Get driving directions from LAX airport to Hollywood Walk of Fame'")
        
        result = await agent.run(
            "Get driving directions from LAX airport to Hollywood Walk of Fame",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 2: Walking directions
        print("2. Walking Directions:")
        print("   Query: 'How long does it take to walk from Central Park to Times Square?'")
        
        result = await agent.run(
            "How long does it take to walk from Central Park to Times Square?",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 3: Route with traffic
        print("3. Route with Traffic:")
        print("   Query: 'What's the fastest route from San Francisco Airport to Golden Gate Bridge during rush hour?'")
        
        result = await agent.run(
            "What's the fastest route from San Francisco Airport to Golden Gate Bridge during rush hour?",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 4: Travel time matrix
        print("4. Travel Time Matrix:")
        print("   Query: 'Calculate travel times between Statue of Liberty, Empire State Building, and Central Park'")
        
        result = await agent.run(
            "Calculate travel times between Statue of Liberty, Empire State Building, and Central Park",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")


if __name__ == "__main__":
    asyncio.run(main())