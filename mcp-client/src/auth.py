"""JWT authentication utilities for MCP client."""
import json
import os
import time
from typing import Any

import jwt
from dotenv import load_dotenv

# Load environment variables (force override existing env vars)
load_dotenv(override=True)


class JWTAuth:
    """Handles JWT token generation for MCP server authentication."""

    def __init__(
        self,
        jwt_secret: str | None = None,
        issuer: str = "mapbox-mcp-server",
        audience: str = "mapbox-mcp-server",
        subject: str = "pydantic-ai-client",
    ):
        """Initialize JWT authentication.

        Args:
            jwt_secret: JWT secret key. If not provided, uses JWT_SECRET from env.
            issuer: Token issuer (default: "mapbox-mcp-server")
            audience: Token audience (default: "mapbox-mcp-server")
            subject: Token subject (default: "pydantic-ai-client")
        """
        self.jwt_secret = jwt_secret or os.getenv("JWT_SECRET")
        if not self.jwt_secret:
            raise ValueError(
                "JWT_SECRET environment variable is required. "
                "Set it in .env file or as an environment variable. "
                "Generate with: openssl rand -base64 32"
            )
        
        self.issuer = issuer
        self.audience = audience
        self.subject = subject

    def generate_token(
        self, 
        permissions: list[str] | None = None,
        expires_in: int = 3600
    ) -> str:
        """Generate a JWT token for MCP server authentication.

        Args:
            permissions: List of permissions (default: ["mapbox:*"])
            expires_in: Token expiration time in seconds (default: 3600)

        Returns:
            JWT token string
        """
        if permissions is None:
            permissions = ["mapbox:*"]

        now = int(time.time())
        
        # Include all required claims for fastify-jwt compatibility
        payload: dict[str, Any] = {
            "iss": self.issuer,
            "sub": self.subject,
            "aud": self.audience,
            "iat": now,
            "nbf": now,  # Not before claim
            "exp": now + expires_in,
            "permissions": permissions,
        }

        # Ensure we're using HS256 algorithm with proper headers
        if not self.jwt_secret:
            raise ValueError("JWT secret is required")
        token = jwt.encode(
            payload, 
            self.jwt_secret, 
            algorithm="HS256",
            headers={"alg": "HS256", "typ": "JWT"}
        )
        # jwt.encode returns bytes in some versions, str in others
        return token if isinstance(token, str) else token.decode('utf-8')

    def get_auth_header(
        self,
        permissions: list[str] | None = None,
        expires_in: int = 3600
    ) -> dict[str, str]:
        """Get authorization header with JWT token.

        Args:
            permissions: List of permissions (default: ["mapbox:*"])
            expires_in: Token expiration time in seconds (default: 3600)

        Returns:
            Dictionary with Authorization header
        """
        token = self.generate_token(permissions, expires_in)
        return {"Authorization": f"Bearer {token}"}
    
    def debug_token(self, token: str | None = None) -> None:
        """Debug helper to decode and print token contents.
        
        Args:
            token: JWT token to debug. If not provided, generates a new one.
        """
        if token is None:
            token = self.generate_token()
        
        print("\n=== JWT Token Debug ===")
        print(f"Token (first 50 chars): {token[:50]}...")
        
        try:
            # Decode without verification to see contents
            decoded = jwt.decode(token, options={"verify_signature": False})
            print("\nToken payload:")
            print(json.dumps(decoded, indent=2))
            
            # Check timestamps
            now = int(time.time())
            if "iat" in decoded:
                print(f"\nIssued at: {decoded['iat']} (now: {now}, diff: {now - decoded['iat']}s)")
            if "exp" in decoded:
                print(f"Expires at: {decoded['exp']} (now: {now}, diff: {decoded['exp'] - now}s)")
            if "nbf" in decoded:
                print(f"Not before: {decoded['nbf']} (now: {now}, diff: {now - decoded['nbf']}s)")
            
            # Also decode with verification
            if self.jwt_secret:
                jwt.decode(
                    token, 
                    self.jwt_secret, 
                    algorithms=["HS256"],
                    audience=self.audience,
                    issuer=self.issuer
                )
                print("\nToken verification: SUCCESS ✓")
            else:
                print("\nToken verification skipped: No JWT secret")
            
        except jwt.ExpiredSignatureError:
            print("\nToken verification failed: Token has expired")
        except jwt.InvalidTokenError as e:
            print(f"\nToken verification failed: {e}")
        except Exception as e:
            print(f"\nUnexpected error: {e}")
        
        print("======================\n")
    
    def test_auth(self) -> None:
        """Test authentication by generating and debugging a token."""
        print("\n🔍 Testing JWT Authentication\n")
        
        # Show JWT secret info
        if self.jwt_secret:
            print(f"JWT_SECRET length: {len(self.jwt_secret)}")
            print(f"JWT_SECRET first 20 chars: {self.jwt_secret[:20]}...")
            print(f"JWT_SECRET last 5 chars: ...{self.jwt_secret[-5:]}")
            print(f"JWT_SECRET is base64: {'=' in self.jwt_secret}")
        else:
            print("JWT_SECRET not set")
        
        # Generate a test token
        token = self.generate_token()
        print(f"\nGenerated token (first 100 chars): {token[:100]}...")
        
        # Debug the token
        self.debug_token(token)