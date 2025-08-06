"""End-to-end workflow tests for CLI."""
import pytest

from tests.cli_helpers import (
    assert_cli_success,
    parse_cli_output,
    run_cli_command,
)


@pytest.mark.cli
@pytest.mark.integration
@pytest.mark.e2e
class TestCLIWorkflows:
    """Test complete user workflows through CLI."""
    
    def test_location_to_directions_workflow(self, require_mcp_server: None) -> None:
        """Test workflow: Find location -> Get directions to it."""
        # Step 1: Find a specific location
        stdout1, stderr1, code1 = run_cli_command(
            "What are the coordinates of the Statue of Liberty?"
        )
        assert_cli_success(stdout1, stderr1, code1)
        parsed1 = parse_cli_output(stdout1)
        assert "40.68" in parsed1["answer"]  # Statue of Liberty coordinates
        
        # Step 2: Get directions from another landmark
        stdout2, stderr2, code2 = run_cli_command(
            "Get directions from Times Square to the Statue of Liberty"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert parsed2["answer"] is not None
        assert any(term in parsed2["answer"].lower() for term in ["km", "miles", "minutes"])
    
    def test_poi_search_to_matrix_workflow(self, require_mcp_server: None) -> None:
        """Test workflow: Search POIs -> Calculate travel times between them."""
        # Step 1: Find coffee shops
        stdout1, stderr1, code1 = run_cli_command(
            "Find three coffee shops near Union Square, Manhattan"
        )
        assert_cli_success(stdout1, stderr1, code1)
        parsed1 = parse_cli_output(stdout1)
        assert parsed1["answer"] is not None
        assert "coffee" in parsed1["answer"].lower() or "cafe" in parsed1["answer"].lower()
        
        # Step 2: Calculate travel times in the area
        stdout2, stderr2, code2 = run_cli_command(
            "Calculate walking times between Union Square, Washington Square Park, and Madison Square Park"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert any(term in parsed2["answer"].lower() for term in ["time", "minutes", "walk"])
    
    def test_geocode_to_isochrone_workflow(self, require_mcp_server: None) -> None:
        """Test workflow: Geocode address -> Generate isochrone -> Find POIs."""
        # Step 1: Geocode an address
        stdout1, stderr1, code1 = run_cli_command(
            "What are the coordinates of Grand Central Terminal?"
        )
        assert_cli_success(stdout1, stderr1, code1)
        parsed1 = parse_cli_output(stdout1)
        assert "40.75" in parsed1["answer"]  # Grand Central coordinates
        
        # Step 2: Find reachable areas
        stdout2, stderr2, code2 = run_cli_command(
            "What areas can I reach within 10 minutes walking from Grand Central Terminal?"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert any(term in parsed2["answer"].lower() for term in ["reach", "area", "walk"])
        
        # Step 3: Find places within that area
        stdout3, stderr3, code3 = run_cli_command(
            "Find restaurants within 10 minutes walk of Grand Central Terminal"
        )
        assert_cli_success(stdout3, stderr3, code3)
        parsed3 = parse_cli_output(stdout3)
        assert "restaurant" in parsed3["answer"].lower() or "food" in parsed3["answer"].lower()
    
    def test_map_generation_workflow(self, require_mcp_server: None) -> None:
        """Test workflow: Find location -> Generate map -> Get more details."""
        # Step 1: Find a landmark
        stdout1, stderr1, code1 = run_cli_command(
            "Where is the Brooklyn Bridge?"
        )
        assert_cli_success(stdout1, stderr1, code1)
        
        # Step 2: Generate a map
        stdout2, stderr2, code2 = run_cli_command(
            "Show me a map of the Brooklyn Bridge area"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert any(term in parsed2["answer"].lower() for term in ["map", "image", "view"])
        
        # Step 3: Find nearby attractions
        stdout3, stderr3, code3 = run_cli_command(
            "What attractions are near the Brooklyn Bridge?"
        )
        assert_cli_success(stdout3, stderr3, code3)
        parsed3 = parse_cli_output(stdout3)
        assert parsed3["answer"] is not None


@pytest.mark.cli
@pytest.mark.integration
@pytest.mark.e2e
class TestCLIErrorRecovery:
    """Test error recovery in CLI workflows."""
    
    def test_invalid_then_valid_query(self, require_mcp_server: None) -> None:
        """Test recovery from invalid to valid query."""
        # Step 1: Invalid query
        stdout1, stderr1, code1 = run_cli_command(
            "qwerty123 asdf nonexistent place xyz"
        )
        assert code1 == 0  # Should not crash
        
        # Step 2: Valid query should work fine
        stdout2, stderr2, code2 = run_cli_command(
            "What are the coordinates of Central Park?"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert "40.78" in parsed2["answer"]  # Central Park coordinates
    
    def test_malformed_coordinates_recovery(self, require_mcp_server: None) -> None:
        """Test recovery from malformed coordinate input."""
        # Step 1: Invalid coordinates
        stdout1, stderr1, code1 = run_cli_command(
            "What's at coordinates abc, def?"
        )
        assert code1 == 0  # Should handle gracefully
        
        # Step 2: Correct format
        stdout2, stderr2, code2 = run_cli_command(
            "What's at longitude -73.9857, latitude 40.7484?"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert parsed2["answer"] is not None
        # Should identify Empire State Building area
        assert any(term in parsed2["answer"].lower() for term in ["empire", "manhattan"])
    
    def test_ambiguous_location_clarification(self, require_mcp_server: None) -> None:
        """Test handling of ambiguous location names."""
        # Step 1: Ambiguous query
        stdout1, stderr1, code1 = run_cli_command(
            "Find restaurants in Springfield"  # Many Springfields in USA
        )
        assert code1 == 0
        parsed1 = parse_cli_output(stdout1)
        # Should either pick one or mention ambiguity
        assert parsed1["answer"] is not None
        
        # Step 2: More specific query
        stdout2, stderr2, code2 = run_cli_command(
            "Find restaurants in Springfield, Massachusetts"
        )
        assert_cli_success(stdout2, stderr2, code2)
        parsed2 = parse_cli_output(stdout2)
        assert parsed2["answer"] is not None
        assert "restaurant" in parsed2["answer"].lower() or "food" in parsed2["answer"].lower()


@pytest.mark.cli
@pytest.mark.integration
@pytest.mark.e2e
class TestCLIComplexQueries:
    """Test complex multi-part queries."""
    
    def test_compound_query(self, require_mcp_server: None) -> None:
        """Test query that requires multiple tool calls."""
        stdout, stderr, code = run_cli_command(
            "Find the best route from JFK Airport to Central Park and show me what's near the destination"
        )
        
        assert_cli_success(stdout, stderr, code)
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        # Should mention both directions and nearby places
        assert any(term in parsed["answer"].lower() for term in ["route", "direction", "km", "miles"])
    
    def test_comparison_query(self, require_mcp_server: None) -> None:
        """Test query comparing multiple options."""
        stdout, stderr, code = run_cli_command(
            "Compare travel times from Times Square to JFK Airport by car versus public transit"
        )
        
        assert_cli_success(stdout, stderr, code)
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        # Should provide comparison
        assert any(term in parsed["answer"].lower() for term in ["driving", "car", "transit"])
    
    def test_multi_location_query(self, require_mcp_server: None) -> None:
        """Test query involving multiple locations."""
        stdout, stderr, code = run_cli_command(
            "Plan a route visiting Statue of Liberty, Brooklyn Bridge, and Central Park"
        )
        
        assert_cli_success(stdout, stderr, code)
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        # Should mention all three locations
        locations = ["statue", "brooklyn", "central park"]
        assert sum(1 for loc in locations if loc in parsed["answer"].lower()) >= 2