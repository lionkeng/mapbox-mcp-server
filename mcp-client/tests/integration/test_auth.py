"""Test JWT authentication with MCP server."""
import time
from unittest.mock import patch

import httpx
import jwt
import pytest

from src.auth import JWTAuth
from src.mcp_client import MCPClient


@pytest.mark.asyncio
async def test_valid_jwt_authentication():
    """Test that valid JWT tokens are accepted."""
    auth = JWTAuth()
    token = auth.generate_token()
    
    # Decode to verify structure
    decoded = jwt.decode(
        token,
        auth.jwt_secret,
        algorithms=["HS256"],
        audience="mapbox-mcp-server",
    )
    
    assert decoded["iss"] == "mapbox-mcp-server"
    assert decoded["sub"] == "pydantic-ai-client"
    assert decoded["aud"] == "mapbox-mcp-server"
    assert decoded["permissions"] == ["mapbox:*"]
    assert "exp" in decoded
    assert "iat" in decoded


@pytest.mark.asyncio
async def test_expired_token_handling():
    """Test that expired tokens are handled properly."""
    auth = JWTAuth()
    
    # Create an already expired token
    with patch("time.time", return_value=time.time() - 7200):  # 2 hours ago
        expired_token = auth.generate_token(expires_in=3600)
    
    # Create client with expired token
    with patch.object(auth, "generate_token", return_value=expired_token):
        client = MCPClient(
            server_url="http://localhost:8080",
            jwt_auth=auth,
        )
        
        # This should fail with authentication error
        with pytest.raises(httpx.HTTPStatusError):  # Expect 401 or similar
            async with client:
                await client.list_tools()


@pytest.mark.asyncio
async def test_invalid_secret():
    """Test that invalid JWT secrets are rejected."""
    # Create auth with wrong secret
    wrong_auth = JWTAuth(jwt_secret="wrong_secret_12345678901234567890")
    
    client = MCPClient(
        server_url="http://localhost:8080",
        jwt_auth=wrong_auth,
    )
    
    # This should fail with authentication error
    with pytest.raises(httpx.HTTPStatusError):  # Expect 401 or similar
        async with client:
            await client.list_tools()


@pytest.mark.asyncio
async def test_custom_permissions():
    """Test JWT tokens with custom permissions."""
    auth = JWTAuth()
    
    # Test with limited permissions
    limited_token = auth.generate_token(permissions=["mapbox:geocode"])
    
    # Verify token has correct permissions
    decoded = jwt.decode(
        limited_token,
        auth.jwt_secret,
        algorithms=["HS256"],
        audience="mapbox-mcp-server",
    )
    
    assert decoded["permissions"] == ["mapbox:geocode"]


@pytest.mark.asyncio
async def test_auth_header_generation():
    """Test authorization header generation."""
    auth = JWTAuth()
    headers = auth.get_auth_header()
    
    assert "Authorization" in headers
    assert headers["Authorization"].startswith("Bearer ")
    
    # Extract and verify token
    token = headers["Authorization"].split(" ")[1]
    decoded = jwt.decode(
        token,
        auth.jwt_secret,
        algorithms=["HS256"],
        audience="mapbox-mcp-server",
    )
    
    assert decoded["sub"] == "pydantic-ai-client"