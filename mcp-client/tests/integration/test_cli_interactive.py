"""Integration tests for CLI interactive mode."""
import os
import time
from collections.abc import Generator
from typing import Any

import pytest

# pexpect is optional - skip tests if not available
try:
    import pexpect
    PEXPECT_AVAILABLE = True
except ImportError:
    PEXPECT_AVAILABLE = False
    pexpect = None  # type: ignore[assignment]



@pytest.mark.skipif(not PEXPECT_AVAILABLE, reason="pexpect not installed")
@pytest.mark.cli
@pytest.mark.integration
@pytest.mark.interactive
class TestCLIInteractiveMode:
    """Test CLI in interactive mode."""
    
    @pytest.fixture
    def spawn_cli(self) -> Generator[Any, None, None]:
        """Spawn an interactive CLI session."""
        # Get the project root directory
        project_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        # Set up environment
        env = os.environ.copy()
        env["MCP_SERVER_URL"] = "http://localhost:8080"
        
        # Spawn the CLI
        child = pexpect.spawn(  # type: ignore[union-attr]
            "uv run cli",
            cwd=project_dir,
            env=env,
            timeout=30,
            encoding='utf-8'
        )
        
        # Wait for welcome message
        child.expect("Mapbox MCP Agent", timeout=10)
        
        yield child
        
        # Clean up
        child.terminate()
        child.wait()
    
    def test_interactive_help_command(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test /help command in interactive mode."""
        child = spawn_cli
        
        # Send help command
        child.sendline("/help")
        
        # Should see help output
        child.expect("Available Commands", timeout=5)
        child.expect("/quit", timeout=2)
        child.expect("/exit", timeout=2)
        child.expect("/clear", timeout=2)
        
        # Should also see example queries
        child.expect("Example Queries", timeout=2)
    
    def test_interactive_query_response(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test sending a query in interactive mode."""
        child = spawn_cli
        
        # Send a simple query
        child.sendline("What are the coordinates of Paris?")
        
        # Should see processing indicator
        child.expect("Thinking", timeout=5)
        
        # Should get response
        child.expect("Response", timeout=15)
        
        # Should see coordinates in answer
        output = child.before + child.after
        assert "48.8" in output  # Paris latitude
        assert "2.3" in output   # Paris longitude
        
        # Should show tool used
        child.expect("Tool used:", timeout=2)
    
    def test_interactive_multiple_queries(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test multiple sequential queries."""
        child = spawn_cli
        
        # First query
        child.sendline("What are the coordinates of London?")
        child.expect("Response", timeout=15)
        child.expect("51.5", timeout=2)  # London latitude
        
        # Second query
        child.sendline("Find coffee shops in Manhattan")
        child.expect("Response", timeout=15)
        output = child.before + child.after
        assert "coffee" in output.lower() or "cafe" in output.lower()
        
        # Third query
        child.sendline("What's at longitude -73.9857, latitude 40.7484?")
        child.expect("Response", timeout=15)
        output = child.before + child.after
        assert any(term in output.lower() for term in ["empire", "manhattan"])
    
    def test_interactive_clear_command(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test /clear command."""
        child = spawn_cli
        
        # Send a query first
        child.sendline("What are the coordinates of Tokyo?")
        child.expect("Response", timeout=15)
        
        # Clear screen
        child.sendline("/clear")
        
        # Terminal should be cleared (ANSI clear screen sequence)
        # Look for clear screen escape sequence
        time.sleep(0.5)  # Give time for clear to execute
        
        # After clear, we should be able to send another query
        child.sendline("What are the coordinates of Berlin?")
        child.expect("Response", timeout=15)
        child.expect("52.5", timeout=2)  # Berlin latitude
    
    def test_interactive_quit_command(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test /quit command."""
        child = spawn_cli
        
        # Send quit command
        child.sendline("/quit")
        
        # Should see goodbye message or exit cleanly
        try:
            child.expect(["Goodbye", "bye", pexpect.EOF], timeout=5)
        except pexpect.TIMEOUT:
            # If no goodbye message, check if process ended
            assert not child.isalive(), "CLI should have exited after /quit"
    
    def test_interactive_exit_command(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test /exit command (alias for /quit)."""
        child = spawn_cli
        
        # Send exit command
        child.sendline("/exit")
        
        # Should exit cleanly
        try:
            child.expect(["Goodbye", "bye", pexpect.EOF], timeout=5)
        except pexpect.TIMEOUT:
            # If no goodbye message, check if process ended
            assert not child.isalive(), "CLI should have exited after /exit"
    
    def test_interactive_interrupt_handling(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test Ctrl+C handling."""
        child = spawn_cli
        
        # Send a query
        child.sendline("Find all restaurants in New York City")
        
        # Send interrupt during processing
        time.sleep(0.5)  # Let query start processing
        child.sendintr()  # Send Ctrl+C
        
        # Should see interrupt message
        try:
            child.expect(["Interrupted", "KeyboardInterrupt"], timeout=5)
        except pexpect.TIMEOUT:
            # Some systems might handle this differently
            pass
        
        # Should still be in interactive mode (not exited)
        child.sendline("/help")
        child.expect("Available Commands", timeout=5)
    
    def test_interactive_empty_input(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test handling of empty input."""
        child = spawn_cli
        
        # Send empty line
        child.sendline("")
        
        # Should just show prompt again, not crash
        time.sleep(0.5)
        
        # Send a real query to verify still working
        child.sendline("What are the coordinates of Sydney?")
        child.expect("Response", timeout=15)
        child.expect("-33.8", timeout=2)  # Sydney latitude
    
    def test_interactive_invalid_command(self, spawn_cli: Any, require_mcp_server: None) -> None:
        """Test handling of invalid commands."""
        child = spawn_cli
        
        # Send invalid command
        child.sendline("/invalid")
        
        # Should handle gracefully (might show error or ignore)
        time.sleep(0.5)
        
        # Should still be functional
        child.sendline("/help")
        child.expect("Available Commands", timeout=5)


@pytest.mark.skipif(not PEXPECT_AVAILABLE, reason="pexpect not installed")
@pytest.mark.cli
@pytest.mark.integration
@pytest.mark.interactive
class TestCLIInteractiveErrors:
    """Test error handling in interactive mode."""
    
    @pytest.fixture
    def spawn_cli_no_server(self) -> Generator[Any, None, None]:
        """Spawn CLI with wrong server URL."""
        project_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        env = os.environ.copy()
        env["MCP_SERVER_URL"] = "http://localhost:9999"  # Non-existent server
        
        child = pexpect.spawn(  # type: ignore[union-attr]
            "uv run cli",
            cwd=project_dir,
            env=env,
            timeout=30,
            encoding='utf-8'
        )
        
        # Wait for welcome message
        child.expect("Mapbox MCP Agent", timeout=10)
        
        yield child
        
        child.terminate()
        child.wait()
    
    def test_interactive_server_connection_error(self, spawn_cli_no_server: Any) -> None:
        """Test handling when server is not available."""
        child = spawn_cli_no_server
        
        # Send a query
        child.sendline("What are the coordinates of Rome?")
        
        # Should see error message
        child.expect(["Error", "error", "failed"], timeout=10)
        
        # Should still be in interactive mode
        child.sendline("/help")
        child.expect("Available Commands", timeout=5)