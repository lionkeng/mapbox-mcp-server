"""Basic geocoding example using the Mapbox MCP Agent."""
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
    """Run basic geocoding examples."""
    print("🗺️  Mapbox MCP Agent - Geocoding Examples\n")
    
    # Create agent and dependencies
    agent, deps = await create_agent_with_deps()
    
    async with deps.mcp_client:
        # Example 1: Forward geocoding
        print("1. Forward Geocoding - Converting address to coordinates:")
        print("   Query: 'What are the coordinates of the Empire State Building?'")
        
        result = await agent.run(
            "What are the coordinates of the Empire State Building?",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 2: Reverse geocoding
        print("2. Reverse Geocoding - Converting coordinates to address:")
        print("   Query: 'What's the address at longitude -77.036133, latitude 38.895111?'")
        
        result = await agent.run(
            "What's the address at longitude -77.036133, latitude 38.895111?",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")
        print()
        
        # Example 3: Multiple results
        print("3. Multiple geocoding results:")
        print("   Query: 'Find all Starbucks locations in Manhattan'")
        
        result = await agent.run(
            "Find all Starbucks locations in Manhattan",
            deps=deps,
        )
        
        print(f"   Answer: {result.output.answer}")
        if result.output.tool_used:
            print(f"   Tool used: {result.output.tool_used}")


if __name__ == "__main__":
    asyncio.run(main())