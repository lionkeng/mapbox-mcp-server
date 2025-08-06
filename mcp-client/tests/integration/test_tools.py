"""Test individual MCP tools."""
import pytest

from src.mcp_client import MCPClient
from tests.test_helpers import (
    assert_coordinates_close,
    assert_valid_directions_result,
    assert_valid_geocoding_result,
    assert_valid_poi_result,
)


@pytest.mark.asyncio
async def test_forward_geocode(mcp_client: MCPClient, test_addresses):
    """Test forward geocoding tool."""
    result = await mcp_client.call_tool(
        name="forward_geocode_tool",
        arguments={"q": test_addresses["empire_state"], "limit": 5},
    )
    
    assert_valid_geocoding_result(result)
    
    # Check that we got results
    assert result.get("features"), "Should have features"
    
    # First result should be close to Empire State Building
    first_feature = result["features"][0]
    lon, lat = first_feature["geometry"]["coordinates"]
    
    # Empire State Building coordinates
    assert_coordinates_close(lat, lon, 40.7484, -73.9857, tolerance=0.05)


@pytest.mark.asyncio
async def test_reverse_geocode(mcp_client: MCPClient, test_coordinates: dict[str, dict[str, float]]) -> None:
    """Test reverse geocoding tool."""
    coords = test_coordinates["white_house"]
    
    result = await mcp_client.call_tool(
        name="reverse_geocode_tool",
        arguments={
            "longitude": coords["lon"],
            "latitude": coords["lat"],
        },
    )
    
    assert_valid_geocoding_result(result)
    
    # Check that we got results
    assert result.get("features"), "Should have features"
    
    # Should contain White House or Pennsylvania Avenue
    first_feature = result["features"][0]
    place_name = first_feature.get("place_name", "").lower()
    
    assert any(term in place_name for term in ["white house", "pennsylvania", "1600"]), (
        f"Expected White House location, got: {place_name}"
    )


@pytest.mark.asyncio
async def test_poi_search(mcp_client: MCPClient, test_coordinates: dict[str, dict[str, float]]) -> None:
    """Test POI search tool."""
    times_square = test_coordinates["times_square"]
    
    result = await mcp_client.call_tool(
        name="poi_search_tool",
        arguments={
            "q": "coffee",
            "proximity": {
                "longitude": times_square["lon"],
                "latitude": times_square["lat"],
            },
            "limit": 10,
        },
    )
    
    assert_valid_poi_result(result)
    
    # Should find coffee shops
    assert result.get("features"), "Should have features"
    assert len(result["features"]) > 0, "Should find at least one coffee shop"
    
    # Results should mention coffee
    for feature in result["features"][:3]:  # Check first 3
        name = feature.get("properties", {}).get("name", "").lower()
        assert "coffee" in name or "starbucks" in name or "cafe" in name, (
            f"Expected coffee-related place, got: {name}"
        )


@pytest.mark.asyncio
async def test_directions(mcp_client: MCPClient, test_coordinates: dict[str, dict[str, float]]) -> None:
    """Test directions tool."""
    start = test_coordinates["central_park"]
    end = test_coordinates["times_square"]
    
    result = await mcp_client.call_tool(
        name="directions_tool",
        arguments={
            "profile": "walking",
            "coordinates": [
                {"longitude": start["lon"], "latitude": start["lat"]},
                {"longitude": end["lon"], "latitude": end["lat"]},
            ],
        },
    )
    
    assert_valid_directions_result(result)
    
    # Check distance is reasonable (Central Park to Times Square ~2-3km)
    route = result["routes"][0]
    distance_km = route["distance"] / 1000
    
    assert 1 < distance_km < 5, f"Unexpected distance: {distance_km}km"
    
    # Walking should take 15-45 minutes
    duration_min = route["duration"] / 60
    assert 10 < duration_min < 60, f"Unexpected duration: {duration_min}min"


@pytest.mark.asyncio
async def test_static_map(mcp_client: MCPClient, test_coordinates: dict[str, dict[str, float]]) -> None:
    """Test static map generation tool."""
    golden_gate = test_coordinates["golden_gate"]
    
    result = await mcp_client.call_tool(
        name="static_map_image_tool",
        arguments={
            "center": {
                "longitude": golden_gate["lon"],
                "latitude": golden_gate["lat"],
            },
            "zoom": 14,
            "size": {"width": 200, "height": 200},
            "style": "mapbox/outdoors-v12",
        },
    )
    
    # Check if result contains content array (MCP response format)
    if "content" in result and isinstance(result["content"], list) and result["content"]:
        # Extract first content item
        image_result = result["content"][0]
    else:
        # Direct result format
        image_result = result
    
    # Should return image data
    assert image_result.get("type") == "image", f"Should return image type, got: {image_result}"
    assert "data" in image_result, "Should have base64 data in result"
    assert "mimeType" in image_result, "Should have mimeType in result"
    
    # Validate base64 data
    image_data = image_result.get("data", "")
    assert len(image_data) > 0, "Should have non-empty image data"
    
    # Validate mime type
    mime_type = image_result.get("mimeType", "")
    assert mime_type in ["image/png", "image/jpeg"], f"Invalid mime type: {mime_type}"


@pytest.mark.asyncio
async def test_isochrone(mcp_client: MCPClient, test_coordinates: dict[str, dict[str, float]]) -> None:
    """Test isochrone tool."""
    start = test_coordinates["times_square"]
    
    result = await mcp_client.call_tool(
        name="isochrone_tool",
        arguments={
            "coordinates": {
                "longitude": start["lon"],
                "latitude": start["lat"],
            },
            "profile": "walking",
            "contours_minutes": [5, 10, 15],
        },
    )
    
    # Should return features (polygons)
    assert "features" in result, "Should have features"
    assert len(result["features"]) == 3, "Should have 3 isochrone polygons"
    
    # Each feature should be a polygon
    for feature in result["features"]:
        assert feature["geometry"]["type"] == "Polygon"
        assert "coordinates" in feature["geometry"]


@pytest.mark.asyncio
async def test_matrix(mcp_client: MCPClient, test_coordinates: dict[str, dict[str, float]]) -> None:
    """Test travel time matrix tool."""
    locations = [
        {"longitude": test_coordinates["empire_state"]["lon"], 
         "latitude": test_coordinates["empire_state"]["lat"]},
        {"longitude": test_coordinates["times_square"]["lon"], 
         "latitude": test_coordinates["times_square"]["lat"]},
        {"longitude": test_coordinates["central_park"]["lon"], 
         "latitude": test_coordinates["central_park"]["lat"]},
    ]
    
    result = await mcp_client.call_tool(
        name="matrix_tool",
        arguments={
            "profile": "driving",
            "sources": locations,
            "destinations": locations,
        },
    )
    
    # Should have matrix data
    assert "durations" in result, "Should have durations matrix"
    assert "distances" in result, "Should have distances matrix"
    
    # Matrix should be 3x3
    assert len(result["durations"]) == 3, "Should have 3 source rows"
    assert all(len(row) == 3 for row in result["durations"]), "Each row should have 3 destinations"
    
    # Diagonal should be 0 (same location)
    for i in range(3):
        assert result["durations"][i][i] == 0, f"Duration from location {i} to itself should be 0"
        assert result["distances"][i][i] == 0, f"Distance from location {i} to itself should be 0"