"""Helper utilities for CLI integration testing."""
import os
import re
import subprocess

import httpx
import pytest


def strip_ansi_codes(text: str) -> str:
    """Remove ANSI escape codes from text.
    
    Args:
        text: Text with potential ANSI codes
        
    Returns:
        Text with ANSI codes removed
    """
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)


def run_cli_command(
    query: str,
    timeout: int = 30,
    env: dict[str, str] | None = None
) -> tuple[str, str, int]:
    """Run a CLI command and capture output.
    
    Args:
        query: Query to pass to CLI
        timeout: Command timeout in seconds
        env: Additional environment variables
        
    Returns:
        Tuple of (stdout, stderr, return_code)
    """
    # Merge environment variables
    cmd_env = os.environ.copy()
    if env:
        cmd_env.update(env)
    
    # Ensure MCP_SERVER_URL is set
    if "MCP_SERVER_URL" not in cmd_env:
        cmd_env["MCP_SERVER_URL"] = "http://localhost:8080"
    
    # Run the command
    result = subprocess.run(
        ["uv", "run", "cli", query],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=cmd_env,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    
    return result.stdout, result.stderr, result.returncode


def parse_cli_output(output: str) -> dict[str, str | None]:
    """Parse CLI output to extract key information.
    
    Args:
        output: Raw CLI output
        
    Returns:
        Dict with parsed information (answer, tool_used, error, etc.)
    """
    clean_output = strip_ansi_codes(output)
    result = {
        "answer": None,
        "tool_used": None,
        "error": None,
        "has_response_panel": False,
    }
    
    # Check for response panel
    if "Response" in clean_output and ("─" in clean_output or "│" in clean_output):
        result["has_response_panel"] = True
    
    # Extract answer from response panel
    # Look for content between panel borders
    response_match = re.search(
        r'Response\s*─+╮\s*│(.*?)╰',
        clean_output,
        re.DOTALL
    )
    if response_match:
        # Extract all text between the panel borders
        panel_content = response_match.group(1)
        # Remove line borders and clean up
        lines = panel_content.split('\n')
        answer_lines = []
        for line in lines:
            # Remove the │ borders and extra spaces
            cleaned_line = re.sub(r'^\s*│\s*', '', line)
            cleaned_line = re.sub(r'\s*│\s*$', '', cleaned_line)
            if cleaned_line.strip():
                answer_lines.append(cleaned_line.strip())
        result["answer"] = ' '.join(answer_lines)
    
    # Extract tool used
    tool_match = re.search(r'Tool used:\s*(.+?)(?:\n|$)', clean_output)
    if tool_match:
        result["tool_used"] = tool_match.group(1).strip()
    
    # Check for errors
    if "Error:" in clean_output:
        error_match = re.search(r'Error:\s*(.+?)(?:\n|$)', clean_output)
        if error_match:
            result["error"] = error_match.group(1).strip()
    
    return result


def assert_cli_success(output: str, stderr: str = "", return_code: int = 0):
    """Assert that CLI command executed successfully.
    
    Args:
        output: stdout from command
        stderr: stderr from command
        return_code: Command return code
    """
    assert return_code == 0, f"CLI command failed with code {return_code}. stderr: {stderr}"
    assert "Error:" not in strip_ansi_codes(output), f"CLI output contains error: {output}"
    assert "Response" in output, "CLI output missing response panel"


def assert_contains_panel(output: str, title: str):
    """Assert that output contains a Rich panel with given title.
    
    Args:
        output: CLI output
        title: Expected panel title
    """
    clean_output = strip_ansi_codes(output)
    assert title in clean_output, f"Expected panel with title '{title}' not found in output"
    # Check for panel borders
    assert any(border in clean_output for border in ["╭", "╰", "│"]), \
        "Output doesn't appear to contain Rich panel formatting"


def assert_tool_used(output: str, expected_tool: str):
    """Assert that a specific tool was used.
    
    Args:
        output: CLI output
        expected_tool: Expected tool name (partial match)
    """
    parsed = parse_cli_output(output)
    assert parsed["tool_used"] is not None, "No tool usage found in output"
    # Allow partial matches and case-insensitive comparison
    tool_used_lower = parsed["tool_used"].lower()
    expected_lower = expected_tool.lower()
    assert expected_lower in tool_used_lower or tool_used_lower in expected_lower, \
        f"Expected tool containing '{expected_tool}' but got '{parsed['tool_used']}'"


@pytest.fixture
def require_mcp_server():
    """Skip test if MCP server is not accessible."""
    try:
        # Try to access the MCP endpoint
        response = httpx.post(
            "http://localhost:8080/mcp",
            json={"jsonrpc": "2.0", "method": "list", "params": {}, "id": "test"},
            timeout=2,
        )
        # If we get a response (even an error), server is running
        if response.status_code not in [200, 401, 405]:
            pytest.skip("MCP server not responding correctly on localhost:8080")
    except (httpx.ConnectError, httpx.TimeoutException):
        pytest.skip("MCP server not running on localhost:8080")


def wait_for_server(max_attempts: int = 5, delay: float = 1.0) -> bool:
    """Wait for MCP server to be available.
    
    Args:
        max_attempts: Maximum number of connection attempts
        delay: Delay between attempts in seconds
        
    Returns:
        True if server is available, False otherwise
    """
    import time
    
    for attempt in range(max_attempts):
        try:
            response = httpx.post(
                "http://localhost:8080/mcp",
                json={"jsonrpc": "2.0", "method": "list", "params": {}, "id": "test"},
                timeout=2,
            )
            if response.status_code in [200, 401, 405]:
                return True
        except (httpx.ConnectError, httpx.TimeoutException):
            pass
        
        if attempt < max_attempts - 1:
            time.sleep(delay)
    
    return False