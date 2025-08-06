"""Test utilities and helpers."""
import math
from typing import Any, cast


def assert_coordinates_close(
    actual_lat: float,
    actual_lon: float,
    expected_lat: float,
    expected_lon: float,
    tolerance: float = 0.01,
) -> None:
    """Assert that two coordinate pairs are close within tolerance.
    
    Args:
        actual_lat: Actual latitude
        actual_lon: Actual longitude
        expected_lat: Expected latitude
        expected_lon: Expected longitude
        tolerance: Maximum allowed difference (default: 0.01 degrees)
    """
    lat_diff = abs(actual_lat - expected_lat)
    lon_diff = abs(actual_lon - expected_lon)
    
    assert lat_diff < tolerance, (
        f"Latitude difference {lat_diff} exceeds tolerance {tolerance}. "
        f"Expected: {expected_lat}, Actual: {actual_lat}"
    )
    
    assert lon_diff < tolerance, (
        f"Longitude difference {lon_diff} exceeds tolerance {tolerance}. "
        f"Expected: {expected_lon}, Actual: {actual_lon}"
    )


def assert_valid_geocoding_result(result: dict[str, Any]) -> None:
    """Assert that a geocoding result has the expected structure."""
    assert isinstance(result, dict), "Result should be a dictionary"
    
    # Check for common geocoding response fields
    if "features" in result:
        assert isinstance(result["features"], list), "Features should be a list"
        if result["features"]:
            feature = cast(dict[str, Any], result["features"][0])
            assert "geometry" in feature, "Feature should have geometry"
            assert "coordinates" in feature["geometry"], "Geometry should have coordinates"
            assert len(cast(list[Any], feature["geometry"]["coordinates"])) == 2, "Coordinates should be [lon, lat]"


def assert_valid_directions_result(result: dict[str, Any]) -> None:
    """Assert that a directions result has the expected structure."""
    assert isinstance(result, dict), "Result should be a dictionary"
    
    # Check for common directions response fields
    if "routes" in result:
        assert isinstance(result["routes"], list), "Routes should be a list"
        if result["routes"]:
            route = cast(dict[str, Any], result["routes"][0])
            assert "distance" in route, "Route should have distance"
            assert "duration" in route, "Route should have duration"
            assert cast(float, route["distance"]) > 0, "Distance should be positive"
            assert cast(float, route["duration"]) > 0, "Duration should be positive"


def assert_valid_poi_result(result: dict[str, Any]) -> None:
    """Assert that a POI search result has the expected structure."""
    assert isinstance(result, dict), "Result should be a dictionary"
    
    # Check for features in POI results
    if "features" in result:
        assert isinstance(result["features"], list), "Features should be a list"
        features_list = cast(list[dict[str, Any]], result["features"])
        for feature in features_list:
            assert "properties" in feature, "Feature should have properties"
            assert "geometry" in feature, "Feature should have geometry"


def assert_valid_map_url(url: str) -> None:
    """Assert that a map URL is valid."""
    assert isinstance(url, str), "URL should be a string"
    assert url.startswith("http"), "URL should start with http"
    assert "mapbox" in url, "URL should contain 'mapbox'"
    assert len(url) > 50, "URL should be reasonably long"


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in kilometers using Haversine formula.
    
    Args:
        lat1: Latitude of first point
        lon1: Longitude of first point
        lat2: Latitude of second point
        lon2: Longitude of second point
        
    Returns:
        Distance in kilometers
    """
    R = 6371  # Earth's radius in kilometers
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = (
        math.sin(delta_lat / 2) ** 2 +
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def extract_coordinates_from_feature(feature: dict[str, Any]) -> tuple[float, float]:
    """Extract latitude and longitude from a GeoJSON feature.
    
    Args:
        feature: GeoJSON feature
        
    Returns:
        Tuple of (latitude, longitude)
    """
    if "geometry" in feature and "coordinates" in feature["geometry"]:
        lon, lat = feature["geometry"]["coordinates"]
        return lat, lon
    raise ValueError("Feature does not contain valid geometry/coordinates")