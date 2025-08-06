# CLI Integration Tests

This directory contains integration tests for the Mapbox MCP Client CLI.

## Test Files

### test_cli_integration.py

Tests the CLI in single-query mode:

- **TestCLISingleQuery**: Tests various query types (geocoding, directions, POI search, etc.)
- **TestCLIErrorHandling**: Tests error scenarios (invalid queries, network errors)
- **TestCLIOutput**: Tests output formatting and Rich terminal UI

### test_cli_e2e.py

End-to-end workflow tests:

- **TestCLIWorkflows**: Complete user workflows (location → directions → map)
- **TestCLIErrorRecovery**: Error recovery scenarios
- **TestCLIComplexQueries**: Multi-part and comparison queries

### test_cli_interactive.py

Interactive mode tests (requires pexpect):

- **TestCLIInteractiveMode**: Tests interactive commands (/help, /quit, etc.)
- **TestCLIInteractiveErrors**: Tests error handling in interactive mode

## Running the Tests

### Prerequisites

1. MCP server must be running on `localhost:8080`
2. Environment variables must be set in `.env`
3. For interactive tests: `pip install pexpect`

### Run all CLI tests:

```bash
uv run pytest tests/integration -m cli -v
```

### Run specific test categories:

```bash
# Single query tests only
uv run pytest tests/integration/test_cli_integration.py -v

# End-to-end tests only
uv run pytest tests/integration/test_cli_e2e.py -v

# Interactive tests only (requires pexpect)
uv run pytest tests/integration/test_cli_interactive.py -v
```

### Skip tests if server not running:

```bash
# Tests will be automatically skipped if MCP server is not available
uv run pytest tests/integration -m "cli and not requires_server" -v
```

## Test Utilities

The `cli_helpers.py` module provides utilities for:

- Running CLI commands with subprocess
- Parsing CLI output (stripping ANSI codes, extracting answers)
- Assertions for CLI output validation
- Server availability checking

## Known Issues

1. **Timeouts**: Some tests may timeout if the agent makes multiple tool calls. Increase timeout if needed.
2. **Tool Usage**: The agent doesn't always report tool usage consistently, so tool assertions are optional.
3. **Interactive Mode**: Empty queries start interactive mode, which requires special handling.

## Adding New Tests

When adding new CLI tests:

1. Use appropriate pytest markers: `@pytest.mark.cli`, `@pytest.mark.integration`
2. Use the `require_mcp_server` fixture to skip tests when server is unavailable
3. Use helper functions from `cli_helpers.py` for consistency
4. Set appropriate timeouts for long-running queries
5. Make assertions flexible to handle agent response variations
