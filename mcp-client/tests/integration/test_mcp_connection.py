"""Test basic MCP client-server connectivity."""
import httpx
import pytest

from src.mcp_client import MCPClient


@pytest.mark.asyncio
async def test_mcp_client_connection(mcp_client: MCPClient):
    """Test that MCP client can connect to the server."""
    # Simple test - list tools to verify connection
    tools = await mcp_client.list_tools()
    
    assert isinstance(tools, list), "Tools should be a list"
    assert len(tools) > 0, "Should have at least one tool"
    
    # Check that we have expected tools
    tool_names = {tool.get("name") for tool in tools}
    expected_tools = {
        "forward_geocode_tool",
        "reverse_geocode_tool",
        "poi_search_tool",
        "directions_tool",
        "static_map_image_tool",
        "isochrone_tool",
        "matrix_tool",
    }
    
    assert expected_tools.issubset(tool_names), (
        f"Missing expected tools. Found: {tool_names}"
    )


@pytest.mark.asyncio
async def test_mcp_request_response():
    """Test basic request/response with MCP server."""
    async with MCPClient(server_url="http://localhost:8080") as client:
        # Test listing tools
        tools = await client.list_tools()
        
        assert tools is not None, "Should get tools list"
        assert isinstance(tools, list), "Tools should be a list"
        assert len(tools) > 0, "Should have at least one tool"


@pytest.mark.asyncio
async def test_mcp_error_handling():
    """Test MCP client error handling."""
    async with MCPClient(server_url="http://localhost:8080") as client:
        # Test calling non-existent tool
        with pytest.raises(ValueError, match="JSON-RPC error"):
            await client.call_tool(
                name="non_existent_tool",
                arguments={},
            )


@pytest.mark.asyncio
async def test_mcp_timeout_handling():
    """Test MCP client timeout handling."""
    # Create client with very short timeout
    async with MCPClient(
        server_url="http://localhost:8080",
        timeout=0.001,  # 1ms timeout
    ) as client:
        # This should timeout
        with pytest.raises(httpx.TimeoutException):
            await client.list_tools()