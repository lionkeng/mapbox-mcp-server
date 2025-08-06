"""Pytest fixtures and configuration for MCP client tests."""
import asyncio
import os
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from dotenv import load_dotenv

from src.auth import JWTAuth
from src.mapbox_agent import MapboxDependencies
from src.mcp_client import MCPClient

# Load test environment
load_dotenv()


@pytest.fixture(scope="session")
def event_loop() -> asyncio.AbstractEventLoop:
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def mcp_client() -> AsyncGenerator[MCPClient, None]:
    """Create an authenticated MCP client for testing."""
    client = MCPClient(
        server_url="http://localhost:8080",
        timeout=30.0,
    )
    yield client
    await client.close()


@pytest.fixture
def jwt_auth() -> JWTAuth:
    """Create a JWT auth instance for testing."""
    return JWTAuth()


@pytest_asyncio.fixture
async def agent_deps(mcp_client: MCPClient) -> MapboxDependencies:
    """Create agent dependencies for testing."""
    mapbox_token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not mapbox_token:
        pytest.skip("MAPBOX_ACCESS_TOKEN not set")
    
    jwt_secret = os.getenv("JWT_SECRET")
    if not jwt_secret:
        pytest.skip("JWT_SECRET not set")
    
    return MapboxDependencies(
        mcp_client=mcp_client,
        mapbox_token=mapbox_token,
        jwt_secret=jwt_secret,
    )


@pytest.fixture
def test_coordinates() -> dict[str, dict[str, float]]:
    """Common test coordinates."""
    return {
        "empire_state": {"lat": 40.7484, "lon": -73.9857},
        "white_house": {"lat": 38.8977, "lon": -77.0365},
        "golden_gate": {"lat": 37.8199, "lon": -122.4783},
        "times_square": {"lat": 40.7580, "lon": -73.9855},
        "central_park": {"lat": 40.7829, "lon": -73.9654},
        "lax": {"lat": 33.9425, "lon": -118.4081},
        "hollywood": {"lat": 34.0928, "lon": -118.3287},
    }


@pytest.fixture
def test_addresses() -> dict[str, str]:
    """Common test addresses."""
    return {
        "empire_state": "Empire State Building, New York, NY",
        "white_house": "1600 Pennsylvania Avenue, Washington, DC",
        "golden_gate": "Golden Gate Bridge, San Francisco, CA",
        "times_square": "Times Square, New York, NY",
        "central_park": "Central Park, New York, NY",
    }


@pytest.fixture
def skip_if_no_openai() -> None:
    """Skip test if OpenAI API key is not available."""
    if not os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY") == "sk-xxx":
        pytest.skip("OPENAI_API_KEY not set or is placeholder")