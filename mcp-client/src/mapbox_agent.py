"""Pydantic-AI agent with Mapbox MCP tools integration."""
import os
import re
from dataclasses import dataclass
from typing import Any

import logfire
from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator
from pydantic_ai import Agent, RunContext

from .mcp_client import MCPClient

# Load environment variables (force override existing env vars)
load_dotenv(override=True)


@dataclass
class MapboxDependencies:
    """Dependencies for the Mapbox agent."""
    mcp_client: MCPClient
    mapbox_token: str
    jwt_secret: str


class LocationResult(BaseModel):
    """Structured output for location-based queries."""
    answer: str
    data: dict[str, Any] | None = None
    tool_used: str | None = None
    map_url: str | None = None


# Static Map Parameter Models
class MapCenter(BaseModel):
    """Map center coordinates."""
    longitude: float = Field(..., ge=-180, le=180)
    latitude: float = Field(..., ge=-85.0511, le=85.0511)


class MapSize(BaseModel):
    """Map image size."""
    width: int = Field(..., ge=1, le=200)
    height: int = Field(..., ge=1, le=200)


class MarkerOverlay(BaseModel):
    """Marker overlay for static map."""
    type: str = Field(default="marker")
    longitude: float = Field(..., ge=-180, le=180)
    latitude: float = Field(..., ge=-85.0511, le=85.0511)
    size: str | None = Field(default="small")
    label: str | None = Field(default=None)
    color: str | None = Field(default=None)
    
    @field_validator('size')
    @classmethod
    def validate_size(cls, v: str | None) -> str | None:
        """Validate marker size."""
        if v is not None and v not in ["small", "large"]:
            raise ValueError("Size must be 'small' or 'large'")
        return v
    
    @field_validator('color')
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        """Validate hex color."""
        if v is not None:
            if not re.match(r'^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$', v):
                raise ValueError("Color must be 3 or 6 digit hex without #")
        return v
    
    @field_validator('label')
    @classmethod
    def validate_label(cls, v: str | None) -> str | None:
        """Validate and transform label."""
        if v is None:
            return v
        # For simplicity, just ensure it's lowercase and truncate if needed
        v_lower = v.lower()
        # If single letter, number 0-99, or could be a Maki icon, keep it
        if len(v_lower) == 1 or (v_lower.isdigit() and int(v_lower) < 100):
            return v_lower
        # Otherwise truncate to first character
        return v_lower[0] if v_lower else None


class StaticMapParams(BaseModel):
    """Parameters for static map generation."""
    center: MapCenter
    zoom: int = Field(14, ge=0, le=22)
    size: MapSize
    style: str = Field("mapbox/streets-v12")
    overlays: list[MarkerOverlay] | None = None


# Create the Mapbox agent
mapbox_agent = Agent[MapboxDependencies, LocationResult](
    "openai:gpt-4o",
    deps_type=MapboxDependencies,
    output_type=LocationResult,
    system_prompt=(
        "You are a helpful geospatial assistant with access to Mapbox tools. "
        "You can help with geocoding, directions, POI search, and map visualization. "
        "Always provide clear, concise answers and use the appropriate tools when needed. "
        "When showing locations or routes, include map visualizations when relevant. "
        "IMPORTANT: When you use the create_static_map tool, it returns image data that MUST be included "
        "in your response's 'data' field. The tool returns {'type': 'image', 'data': '<base64>', 'mimeType': '...'}. "
        "Always include the full tool result in the LocationResult's data field when generating maps."
    ),
)


@mapbox_agent.tool
async def forward_geocode(
    ctx: RunContext[MapboxDependencies],
    query: str,
    limit: int = 5,
) -> dict[str, Any]:
    """Convert an address or place name to coordinates.
    
    Args:
        ctx: Agent context with dependencies
        query: Address or place name to geocode
        limit: Maximum number of results (default: 5)
    
    Returns:
        Geocoding results with coordinates and place details
    """
    logfire.info("Forward geocoding", query=query, limit=limit)
    
    result = await ctx.deps.mcp_client.call_tool(
        name="forward_geocode_tool",
        arguments={"q": query, "limit": limit}
    )
    
    return result


@mapbox_agent.tool
# @logfire.span("reverse_geocode")
async def reverse_geocode(
    ctx: RunContext[MapboxDependencies],
    longitude: float,
    latitude: float,
) -> dict[str, Any]:
    """Convert coordinates to an address.
    
    Args:
        ctx: Agent context with dependencies
        longitude: Longitude coordinate
        latitude: Latitude coordinate
    
    Returns:
        Address and place information for the coordinates
    """
    logfire.info("Reverse geocoding", longitude=longitude, latitude=latitude)
    
    result = await ctx.deps.mcp_client.call_tool(
        name="reverse_geocode_tool",
        arguments={"longitude": longitude, "latitude": latitude}
    )
    
    return result


@mapbox_agent.tool
# @logfire.span("search_poi")
async def search_poi(
    ctx: RunContext[MapboxDependencies],
    query: str,
    latitude: float | None = None,
    longitude: float | None = None,
    radius: int | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Search for points of interest (POIs).
    
    Args:
        ctx: Agent context with dependencies
        query: Search query (e.g., "coffee shops", "restaurants")
        latitude: Optional center latitude for proximity search
        longitude: Optional center longitude for proximity search
        radius: Optional search radius in meters
        limit: Maximum number of results (default: 10)
    
    Returns:
        List of POIs matching the search criteria
    """
    logfire.info(
        "Searching POIs",
        query=query,
        has_location=latitude is not None,
        radius=radius,
        limit=limit,
    )
    
    arguments: dict[str, Any] = {"q": query, "limit": limit}
    
    if latitude is not None and longitude is not None:
        arguments["proximity"] = {"longitude": longitude, "latitude": latitude}
    
    if radius is not None:
        arguments["radius"] = radius
    
    result = await ctx.deps.mcp_client.call_tool(
        name="poi_search_tool",
        arguments=arguments
    )
    
    return result


@mapbox_agent.tool
# @logfire.span("get_directions")
async def get_directions(
    ctx: RunContext[MapboxDependencies],
    start_longitude: float,
    start_latitude: float,
    end_longitude: float,
    end_latitude: float,
    profile: str = "driving-traffic",
) -> dict[str, Any]:
    """Get directions between two points.
    
    Args:
        ctx: Agent context with dependencies
        start_longitude: Starting point longitude
        start_latitude: Starting point latitude
        end_longitude: Destination longitude
        end_latitude: Destination latitude
        profile: Travel mode (driving-traffic, driving, walking, cycling)
    
    Returns:
        Route information including distance, duration, and turn-by-turn directions
    """
    logfire.info(
        "Getting directions",
        profile=profile,
        start=(start_latitude, start_longitude),
        end=(end_latitude, end_longitude),
    )
    
    result = await ctx.deps.mcp_client.call_tool(
        name="directions_tool",
        arguments={
            "profile": profile,
            "coordinates": [
                [start_longitude, start_latitude],
                [end_longitude, end_latitude],
            ],
        }
    )
    
    return result


@mapbox_agent.tool
# @logfire.span("create_static_map")
async def create_static_map(
    ctx: RunContext[MapboxDependencies],
    longitude: float,
    latitude: float,
    zoom: int = 14,
    width: int = 200,
    height: int = 200,
    style: str = "mapbox/streets-v12",
    markers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create a static map image.
    
    Args:
        ctx: Agent context with dependencies
        longitude: Center longitude (-180 to 180)
        latitude: Center latitude (-85.0511 to 85.0511)
        zoom: Zoom level (0-22, default: 14)
        width: Image width in pixels (1-200, default: 200)
        height: Image height in pixels (1-200, default: 200)
        style: Map style (default: "mapbox/streets-v12")
        markers: Optional list of markers to add to the map
    
    Returns:
        Dictionary containing base64 image data and mime type
    """
    logfire.info(
        "Creating static map",
        center=(latitude, longitude),
        zoom=zoom,
        size=(width, height),
        style=style,
        num_markers=len(markers) if markers else 0,
    )
    
    # Validate parameters using Pydantic models
    try:
        params = StaticMapParams(
            center=MapCenter(longitude=longitude, latitude=latitude),
            zoom=zoom,
            size=MapSize(width=width, height=height),
            style=style,
            overlays=None
        )
        
        # Convert markers to overlays format if provided
        if markers:
            overlays_list: list[MarkerOverlay] = []
            for marker in markers:
                # Handle both simple and complex marker formats
                overlay = MarkerOverlay(
                    type="marker",
                    longitude=marker.get("longitude", marker.get("lon", longitude)),
                    latitude=marker.get("latitude", marker.get("lat", latitude)),
                    size=marker.get("size", "small"),
                    label=marker.get("label"),
                    color=marker.get("color")
                )
                overlays_list.append(overlay)
            params.overlays = overlays_list
        
        # Convert to dict for API call
        arguments = params.model_dump(exclude_none=True)
        
    except Exception as e:
        logfire.error(f"Invalid parameters for static map: {e}")
        return {"error": f"Invalid parameters: {str(e)}"}
    
    result = await ctx.deps.mcp_client.call_tool(
        name="static_map_image_tool",
        arguments=arguments
    )
    
    # Handle MCP response format
    # Check if result is wrapped in content array
    if "content" in result and isinstance(result["content"], list) and result["content"]:
        # Extract first content item
        first_content = result["content"][0]  # type: ignore[assignment]
        if isinstance(first_content, dict) and first_content.get("type") == "image":  # type: ignore[union-attr]
            return first_content  # type: ignore[return-value]
    # Check direct format
    elif result.get("type") == "image":
        return result
    
    return {"error": "Map generation failed"}


@mapbox_agent.tool
# @logfire.span("get_isochrone")
async def get_isochrone(
    ctx: RunContext[MapboxDependencies],
    longitude: float,
    latitude: float,
    profile: str = "driving",
    minutes: list[int] | None = None,
) -> dict[str, Any]:
    """Get areas reachable within specified time limits.
    
    Args:
        ctx: Agent context with dependencies
        longitude: Starting point longitude
        latitude: Starting point latitude
        profile: Travel mode (driving, walking, cycling)
        minutes: Time limits in minutes (default: [5, 10, 15])
    
    Returns:
        Isochrone polygons showing reachable areas
    """
    if minutes is None:
        minutes = [5, 10, 15]
    
    logfire.info(
        "Getting isochrone",
        center=(latitude, longitude),
        profile=profile,
        minutes=minutes,
    )
    
    result = await ctx.deps.mcp_client.call_tool(
        name="isochrone_tool",
        arguments={
            "coordinates": {"longitude": longitude, "latitude": latitude},
            "profile": profile,
            "contours_minutes": minutes,
        }
    )
    
    return result


@mapbox_agent.tool
# @logfire.span("calculate_matrix")
async def calculate_matrix(
    ctx: RunContext[MapboxDependencies],
    origins: list[dict[str, float]],
    destinations: list[dict[str, float]],
    profile: str = "driving-traffic",
) -> dict[str, Any]:
    """Calculate travel time/distance matrix between multiple points.
    
    Args:
        ctx: Agent context with dependencies
        origins: List of origin points with longitude and latitude
        destinations: List of destination points with longitude and latitude
        profile: Travel mode (driving-traffic, driving, walking, cycling)
    
    Returns:
        Matrix of travel times and distances
    """
    logfire.info(
        "Calculating matrix",
        num_origins=len(origins),
        num_destinations=len(destinations),
        profile=profile,
    )
    
    result = await ctx.deps.mcp_client.call_tool(
        name="matrix_tool",
        arguments={
            "profile": profile,
            "sources": origins,
            "destinations": destinations,
        }
    )
    
    return result


async def create_agent_with_deps() -> tuple[Agent[MapboxDependencies, LocationResult], MapboxDependencies]:
    """Create an agent with initialized dependencies.
    
    Returns:
        Tuple of (agent, dependencies)
    """
    # Get environment variables
    mapbox_token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not mapbox_token:
        raise ValueError("MAPBOX_ACCESS_TOKEN environment variable is required")
    
    jwt_secret = os.getenv("JWT_SECRET")
    if not jwt_secret:
        raise ValueError("JWT_SECRET environment variable is required")
    
    # Create MCP client
    mcp_client = MCPClient()
    
    # Create dependencies
    deps = MapboxDependencies(
        mcp_client=mcp_client,
        mapbox_token=mapbox_token,
        jwt_secret=jwt_secret,
    )
    
    return mapbox_agent, deps