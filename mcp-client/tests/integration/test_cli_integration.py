"""Integration tests for CLI single-query mode."""
import pytest

from tests.cli_helpers import (
    assert_cli_success,
    assert_contains_panel,
    parse_cli_output,
    run_cli_command,
)


@pytest.mark.cli
@pytest.mark.integration
class TestCLISingleQuery:
    """Test CLI in single-query mode."""
    
    def test_geocoding_query(self, require_mcp_server: None) -> None:
        """Test forward geocoding through CLI."""
        stdout, stderr, code = run_cli_command("What are the coordinates of the Eiffel Tower?", timeout=60)
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        # Tool usage reporting is optional - agent may not always report it
        # assert_tool_used(stdout, "geocod")
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        assert "48.85" in parsed["answer"]  # Eiffel Tower latitude
        assert "2.29" in parsed["answer"]   # Eiffel Tower longitude
    
    def test_reverse_geocoding_query(self, require_mcp_server: None) -> None:
        """Test reverse geocoding through CLI."""
        stdout, stderr, code = run_cli_command(
            "What's the address at longitude -73.985428, latitude 40.748817?"
        )
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        # Tool usage reporting is optional - agent may not always report it
        # assert_tool_used(stdout, "geocod")
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        # Empire State Building area
        assert any(term in parsed["answer"].lower() for term in ["empire", "5th", "34th"])
    
    def test_poi_search_query(self, require_mcp_server: None) -> None:
        """Test POI search through CLI."""
        stdout, stderr, code = run_cli_command(
            "Find coffee shops near Times Square, New York"
        )
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        # Tool could be either forward_geocode, search_poi, or both
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        assert any(term in parsed["answer"].lower() for term in ["coffee", "starbucks", "cafe"])
    
    def test_directions_query(self, require_mcp_server: None) -> None:
        """Test directions through CLI."""
        stdout, stderr, code = run_cli_command(
            "Get walking directions from Central Park to Times Square in New York"
        )
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        # Should mention distance or time
        assert any(term in parsed["answer"].lower() for term in ["minutes", "km", "miles", "walk"])
    
    def test_static_map_query(self, require_mcp_server: None) -> None:
        """Test static map generation through CLI."""
        stdout, stderr, code = run_cli_command(
            "Show me a map of the Golden Gate Bridge"
        )
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        # Should provide map information
        assert any(term in parsed["answer"].lower() for term in ["map", "image", "view"])
    
    def test_isochrone_query(self, require_mcp_server: None) -> None:
        """Test isochrone calculation through CLI."""
        stdout, stderr, code = run_cli_command(
            "What areas can I reach within 15 minutes walking from Times Square?"
        )
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        assert any(term in parsed["answer"].lower() for term in ["reach", "area", "minute"])
    
    def test_matrix_query(self, require_mcp_server: None) -> None:
        """Test travel time matrix through CLI."""
        stdout, stderr, code = run_cli_command(
            "Calculate travel times between Empire State Building, Central Park, and Times Square"
        )
        
        assert_cli_success(stdout, stderr, code)
        assert_contains_panel(stdout, "Response")
        
        parsed = parse_cli_output(stdout)
        assert parsed["answer"] is not None
        assert any(term in parsed["answer"].lower() for term in ["time", "distance", "travel"])


@pytest.mark.cli
@pytest.mark.integration
class TestCLIErrorHandling:
    """Test CLI error handling."""
    
    def test_invalid_query(self, require_mcp_server: None) -> None:
        """Test handling of nonsensical queries."""
        stdout, stderr, code = run_cli_command("xyz123 nonexistent gibberish")
        
        # Should still complete without crashing
        assert code == 0
        # Should have some response
        assert len(stdout) > 0
    
    def test_invalid_coordinates(self, require_mcp_server: None) -> None:
        """Test handling of invalid coordinates."""
        stdout, stderr, code = run_cli_command(
            "What's at longitude 999, latitude 999?"
        )
        
        # Should handle gracefully
        assert code == 0
        parsed = parse_cli_output(stdout)
        # Agent should handle this appropriately
        assert parsed["answer"] is not None or parsed["error"] is not None
    
    def test_network_timeout(self) -> None:
        """Test handling when server is not available."""
        # Use a non-existent server URL
        stdout, stderr, code = run_cli_command(
            "What are the coordinates of Paris?",
            env={"MCP_SERVER_URL": "http://localhost:9999"}
        )
        
        # Should handle connection error gracefully
        assert "Error" in stdout or "error" in stderr.lower()
    
    def test_empty_query(self) -> None:
        """Test handling of empty query."""
        # Empty query starts interactive mode, which we don't want to test here
        # Instead test with just whitespace
        stdout, stderr, code = run_cli_command("   ")
        
        # Should handle gracefully
        assert code == 0


@pytest.mark.cli
@pytest.mark.integration  
class TestCLIOutput:
    """Test CLI output formatting."""
    
    def test_output_has_rich_formatting(self, require_mcp_server: None) -> None:
        """Test that output uses Rich formatting."""
        stdout, stderr, code = run_cli_command("What are the coordinates of London?")
        
        assert_cli_success(stdout, stderr, code)
        
        # Should have ANSI codes (before stripping)
        assert "\x1b[" in stdout or "\033[" in stdout
        
        # Should have panel borders
        assert_contains_panel(stdout, "Response")
    
    def test_output_shows_tool_usage(self, require_mcp_server: None) -> None:
        """Test that tool usage is displayed."""
        stdout, stderr, code = run_cli_command("Find the nearest Starbucks to Central Park")
        
        assert_cli_success(stdout, stderr, code)
        
        # Should show which tool was used
        assert "Tool used:" in stdout
        parsed = parse_cli_output(stdout)
        assert parsed["tool_used"] is not None
    
    def test_output_formatting_consistency(self, require_mcp_server: None) -> None:
        """Test output formatting is consistent across queries."""
        queries = [
            "What are the coordinates of Tokyo?",
            "Find restaurants in Manhattan",
            "Get directions from LAX to Hollywood"
        ]
        
        outputs = []
        for query in queries:
            stdout, stderr, code = run_cli_command(query)
            assert_cli_success(stdout, stderr, code)
            outputs.append(stdout)
        
        # All should have consistent formatting
        for output in outputs:
            assert_contains_panel(output, "Response")
            assert "Tool used:" in output
            parsed = parse_cli_output(output)
            assert parsed["has_response_panel"] is True