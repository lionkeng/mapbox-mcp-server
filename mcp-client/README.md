# Mapbox MCP Client

A Pydantic-AI agent client for interacting with the Mapbox MCP Server. This client provides an interactive CLI interface to query geospatial information, get directions, search for places, and create map visualizations using natural language.

## Quick Start

```bash
# Interactive CLI
uv run cli

# Single query
uv run cli "What are the coordinates of the Empire State Building?"

# Run tests
uv run pytest -v                    # All tests
uv run pytest tests/integration -v  # Integration tests only
uv run pytest tests/agent -v        # Agent tests only
```

## Features

- 🗺️ **Natural Language Interface**: Ask questions about locations in plain English
- 🔍 **Geocoding**: Convert addresses to coordinates and vice versa
- 📍 **POI Search**: Find points of interest like restaurants, coffee shops, etc.
- 🚗 **Directions**: Get turn-by-turn directions with multiple travel modes
- 🖼️ **Map Visualization**: Generate static map images
- ⏱️ **Isochrone Analysis**: Find areas reachable within specific time limits
- 📊 **Travel Matrix**: Calculate travel times between multiple locations
- 📝 **Comprehensive Logging**: Full observability with Logfire integration
- 🤖 **Pydantic-AI Agent**: Powered by OpenAI GPT-4 with structured outputs
- 🔐 **JWT Authentication**: Secure communication with MCP server
- 🎨 **Rich CLI Interface**: Beautiful terminal UI with Typer and Rich

## Prerequisites

- Python 3.11 or higher
- [uv](https://github.com/astral-sh/uv) package manager
- Mapbox access token (get one at [mapbox.com/signup](https://www.mapbox.com/signup/))
- JWT secret for MCP server authentication
- OpenAI API key for the Pydantic-AI agent
- (Optional) Logfire token for cloud logging

## Installation

1. Clone the repository and navigate to the mcp-client directory:

```bash
cd mapbox-mcp-server/mcp-client
```

2. Create a virtual environment and install dependencies:

```bash
uv sync
```

3. Create and configure the `.env` file:

```env
MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token_here
JWT_SECRET=your-secure-jwt-secret-here
MCP_SERVER_URL=http://localhost:8080  # Or your deployed server URL
OPENAI_API_KEY=sk-your-openai-key-here
LOGFIRE_TOKEN=your-logfire-token-here  # Optional
```

## Usage

### Interactive CLI Mode

Start the interactive CLI:

```bash
uv run cli
```

Alternatively, you can use:

```bash
uv run python -m src.cli
```

Example queries:

- "Find coffee shops near Times Square"
- "Get directions from LAX to Hollywood"
- "What's the address at -77.036, 38.895?"
- "Show me a map of Central Park"
- "What areas can I reach in 30 minutes from downtown Portland?"
- "Calculate travel times between Statue of Liberty, Empire State Building, and Central Park"
- "Find the nearest Starbucks to the Golden Gate Bridge"
- "How long does it take to walk from Central Park to Times Square?"

### Single Query Mode

Process a single query and exit:

```bash
uv run cli "Find Italian restaurants in San Francisco"
```

### CLI Commands

- `/help` - Show available commands and examples
- `/clear` - Clear the screen
- `/quit` or `/exit` - Exit the application

## Example Scripts

Run the example scripts to see the agent in action:

### Running Examples

```bash
# Geocoding examples
uv run python examples/basic_geocoding.py

# Route planning examples
uv run python examples/route_planning.py

# Location search and visualization
uv run python examples/location_search.py
```

## Project Structure

```
mcp-client/
├── src/
│   ├── __init__.py
│   ├── auth.py           # JWT authentication
│   ├── mcp_client.py     # MCP protocol client
│   ├── mapbox_agent.py   # Pydantic-AI agent
│   └── cli.py            # CLI interface
├── examples/
│   ├── basic_geocoding.py
│   ├── route_planning.py
│   └── location_search.py
├── tests/
│   ├── integration/     # Integration tests
│   ├── agent/           # Agent tests
│   └── test_helpers.py  # Test utilities
├── pyproject.toml       # Project configuration
└── README.md            # This file
```

## Architecture

The client consists of several key components:

1. **JWT Authentication** (`auth.py`): Handles JWT token generation for MCP server authentication
2. **MCP Client** (`mcp_client.py`): Async HTTP client with SSE support for MCP protocol communication
3. **Mapbox Agent** (`mapbox_agent.py`): Pydantic-AI agent with integrated Mapbox tools
4. **CLI Interface** (`cli.py`): Interactive command-line interface with rich formatting

## Available Tools

The agent has access to the following Mapbox MCP tools:

### Geocoding Tools

- **forward_geocode**: Convert addresses to coordinates
  - Example: "What are the coordinates of the Empire State Building?"
- **reverse_geocode**: Convert coordinates to addresses
  - Example: "What's at longitude -77.036, latitude 38.895?"

### Search Tools

- **search_poi**: Search for points of interest
  - Example: "Find Italian restaurants near Union Square, San Francisco"
  - Supports proximity search with radius

### Navigation Tools

- **get_directions**: Get turn-by-turn directions
  - Supports multiple profiles: driving, walking, cycling
  - Example: "Get directions from LAX to Hollywood"
- **calculate_matrix**: Compute travel time/distance matrices
  - Example: "Calculate travel times between multiple locations"

### Visualization Tools

- **create_static_map**: Generate static map images
  - Customizable size, zoom, and style
  - Support for markers
  - Example: "Show me a map of Central Park"
- **get_isochrone**: Calculate reachable areas within time limits
  - Example: "What areas can I reach in 15 minutes driving from downtown?"

## Implementation Details

### Technologies Used

- **Pydantic-AI**: Agent framework with structured outputs and tool integration
- **httpx**: Async HTTP client for API communication
- **httpx-sse**: Server-sent events support for streaming responses
- **PyJWT**: JWT token generation and validation
- **Typer**: Modern CLI framework
- **Rich**: Beautiful terminal formatting
- **Logfire**: Observability and distributed tracing

### Key Features

- **Async/Await**: Fully asynchronous implementation for better performance
- **Structured Outputs**: Type-safe responses using Pydantic models
- **Error Handling**: Comprehensive error handling with helpful messages
- **JWT Authentication**: Secure communication with the MCP server
- **Context Management**: Proper resource cleanup with async context managers

## Logging and Observability

The client uses Logfire for comprehensive logging:

- All HTTP requests are instrumented with spans
- Tool executions are tracked with detailed metrics
- Errors are logged with full context and tracebacks
- Performance metrics are captured for each operation
- Distributed tracing across client and server

To view logs in the Logfire cloud dashboard, set your `LOGFIRE_TOKEN` in the `.env` file.

## Development

### Running Tests

```bash
# Run all tests
uv run pytest -v

# Run specific test suites
uv run pytest tests/integration -v  # Integration tests only
uv run pytest tests/agent -v        # Agent tests only

# Run specific test files
uv run pytest tests/integration/test_auth.py -v
uv run pytest tests/integration/test_mcp_connection.py -v
```

### Code Quality

```bash
# Type checking
uv run mypy src

# Linting
uv run ruff check src tests examples

# Formatting
uv run ruff format src tests examples
```

### Testing Against Local MCP Server

1. Start the MCP server locally:

   ```bash
   cd ../  # Go to mapbox-mcp-server root
   npm run dev
   ```

2. Ensure your `.env` file points to localhost:

   ```
   MCP_SERVER_URL=http://localhost:8080
   ```

3. Run the client:
   ```bash
   uv run cli "What's the weather like in San Francisco?"
   ```

### Manual Usage (Without UV)

If you prefer not to use UV, you can activate the virtual environment manually:

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e .

# Run CLI
python -m src.cli

# Run examples
python examples/basic_geocoding.py

# Run tests
pytest -v
```

## Troubleshooting

### Authentication Errors (401 Unauthorized)

**Important:** If you're getting "The token signature is invalid" errors:

- Check if `JWT_SECRET` is set as an environment variable: `echo $JWT_SECRET`
- If it exists and is truncated (missing trailing `==`), unset it: `unset JWT_SECRET`
- Both the server and client must use the same JWT_SECRET from `.env` files
- The JWT_SECRET should be 87-88 characters long and end with `==`

General troubleshooting:

- Ensure your `JWT_SECRET` in `.env` matches the one used by the MCP server
- Check that the `MCP_SERVER_URL` is correct and accessible
- Verify the JWT token is being generated correctly using `uv run python -m src.auth`

### API Errors

- Verify your Mapbox access token is valid and has the necessary scopes
- Ensure your OpenAI API key has sufficient credits
- Check rate limits for both services

### Tool Execution Errors

- If you see "JSON-RPC error", check the tool arguments format
- Ensure coordinates are in [longitude, latitude] order
- Verify all required parameters are provided

### Connection Issues

- The MCP server must be running and accessible
- For local development, ensure the server is running on the configured port
- Check your internet connection for external APIs
- Verify firewall settings allow HTTP/HTTPS connections

### Logfire Issues

- If Logfire is not working, ensure your `LOGFIRE_TOKEN` is valid
- Check that the token has the correct permissions
- You can disable Logfire by removing the token from `.env`

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

This project is part of the Mapbox MCP Server repository.
