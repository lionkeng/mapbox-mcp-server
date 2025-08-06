"""MCP client wrapper for HTTP transport with SSE support."""
import json
import os
import time
import types
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import httpx
import logfire
from dotenv import load_dotenv
from httpx_sse import aconnect_sse

from .auth import JWTAuth

# Load environment variables (force override existing env vars)
load_dotenv(override=True)

# Configure logfire
logfire.configure()


class MCPClient:
    """Async MCP client for HTTP transport with JWT authentication."""

    def __init__(
        self,
        server_url: str | None = None,
        jwt_auth: JWTAuth | None = None,
        timeout: float = 30.0,
    ):
        """Initialize MCP client.

        Args:
            server_url: MCP server URL. If not provided, uses MCP_SERVER_URL from env.
            jwt_auth: JWT authentication instance. If not provided, creates one.
            timeout: Request timeout in seconds (default: 30)
        """
        self.server_url = server_url or os.getenv("MCP_SERVER_URL")
        if not self.server_url:
            raise ValueError("MCP_SERVER_URL environment variable is required")
        
        # Ensure URL ends with /mcp
        if not self.server_url.endswith("/mcp"):
            self.server_url = f"{self.server_url.rstrip('/')}/mcp"
        
        self.jwt_auth = jwt_auth or JWTAuth()
        self.timeout = timeout
        self.session_id = str(uuid4())
        
        # Token refresh management
        self._current_token: str | None = None
        self._token_generated_at: float = 0
        self._token_ttl: float = 3300  # Refresh 5 minutes before expiry (1 hour - 5 min)
        
        # Create HTTP client with logfire instrumentation
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "pydantic-ai-mcp-client/0.1.0",
            }
        )
        logfire.instrument_httpx(self.client)

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: types.TracebackType | None,
    ) -> None:
        """Async context manager exit."""
        await self.close()

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
    
    def _get_fresh_token(self) -> str:
        """Get a fresh token, generating a new one if needed.
        
        Returns:
            Valid JWT token
        """
        now = time.time()
        if self._current_token is None or (now - self._token_generated_at) > self._token_ttl:
            logfire.info("Generating new JWT token", 
                         expired=self._current_token is not None,
                         age=now - self._token_generated_at if self._token_generated_at > 0 else 0)
            self._current_token = self.jwt_auth.generate_token()
            self._token_generated_at = now
        return self._current_token

    async def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        id: str | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request to the MCP server.

        Args:
            method: JSON-RPC method name
            params: Method parameters
            id: Request ID (generated if not provided)

        Returns:
            JSON-RPC response

        Raises:
            httpx.HTTPStatusError: If request fails
            ValueError: If response is invalid
        """
        with logfire.span("mcp_request", method=method):
            if id is None:
                id = str(uuid4())

            request_data: dict[str, Any] = {
                "jsonrpc": "2.0",
                "method": method,
                "id": id,
            }
            
            if params is not None:
                request_data["params"] = params

            # Get fresh token and create auth headers
            token = self._get_fresh_token()
            headers = {"Authorization": f"Bearer {token}"}
            headers["mcp-session-id"] = self.session_id

            logfire.info(
                "Sending MCP request",
                method=method,
                params=params,
                request_id=id,
                session_id=self.session_id,
            )

            response = await self.client.post(
                self.server_url,  # type: ignore[arg-type]
                json=request_data,
                headers=headers,
            )
            response.raise_for_status()

            result = response.json()
            
            # Check for JSON-RPC error
            if "error" in result:
                error = result["error"]
                logfire.error(
                    "MCP request error",
                    method=method,
                    error_code=error.get("code"),
                    error_message=error.get("message"),
                    error_data=error.get("data"),
                )
                raise ValueError(f"JSON-RPC error: {error}")

            logfire.info(
                "MCP request successful",
                method=method,
                request_id=id,
                has_result="result" in result,
            )

            return result

    async def stream(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Send a streaming request using Server-Sent Events.

        Args:
            method: JSON-RPC method name
            params: Method parameters

        Yields:
            SSE events as dictionaries
        """
        with logfire.span("mcp_stream", method=method):
            request_data = {
                "jsonrpc": "2.0",
                "method": method,
                "params": params or {},
            }

            # Get fresh token and create auth headers
            token = self._get_fresh_token()
            headers = {"Authorization": f"Bearer {token}"}
            headers["mcp-session-id"] = self.session_id
            headers["Accept"] = "text/event-stream"

            logfire.info(
                "Starting MCP stream",
                method=method,
                params=params,
                session_id=self.session_id,
            )

            async with aconnect_sse(
                self.client,
                "POST",
                self.server_url,  # type: ignore[arg-type]
                json=request_data,
                headers=headers,
            ) as event_source:
                async for sse in event_source.aiter_sse():
                    if sse.data:
                        try:
                            data = json.loads(sse.data)
                            logfire.debug(
                                "Received SSE event",
                                event_type=sse.event,
                                event_id=sse.id,
                                data_keys=list(data.keys()) if isinstance(data, dict) else None,  # type: ignore[arg-type]
                            )
                            yield data
                        except json.JSONDecodeError as e:
                            logfire.error(
                                "Failed to parse SSE data",
                                error=str(e),
                                raw_data=sse.data,
                            )

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Call an MCP tool.

        Args:
            name: Tool name
            arguments: Tool arguments

        Returns:
            Tool execution result
        """
        with logfire.span("call_tool", tool_name=name):
            logfire.info(
                "Calling MCP tool",
                tool_name=name,
                arguments=arguments,
            )

            result = await self.request(
                method="tools/call",
                params={
                    "name": name,
                    "arguments": arguments,
                }
            )

            if "result" in result:
                return result["result"]
            
            return result

    async def list_tools(self) -> list[dict[str, Any]]:
        """List available MCP tools.

        Returns:
            List of tool definitions
        """
        result = await self.request(method="tools/list")
        return result.get("result", {}).get("tools", [])