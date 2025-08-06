"""Interactive CLI for Mapbox MCP Agent."""
import asyncio
import sys

import logfire
import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.prompt import Prompt
from rich.syntax import Syntax
from rich.table import Table
from rich.text import Text

from .mapbox_agent import LocationResult, create_agent_with_deps

# Load environment variables (force override existing env vars)
load_dotenv(override=True)

# Configure logfire
logfire.configure()

# Create console for rich output
console = Console()

# Create typer app
app = typer.Typer(
    name="mapbox-mcp-client",
    help="Interactive CLI for Mapbox MCP Agent",
    add_completion=False,
)


def print_welcome():
    """Print welcome message."""
    welcome_text = Text()
    welcome_text.append("🗺️  ", style="bold blue")
    welcome_text.append("Mapbox MCP Agent", style="bold cyan")
    welcome_text.append(" - Interactive CLI\n\n", style="bold blue")
    welcome_text.append("Ask questions about locations, get directions, search for places, and more!\n", style="dim")
    welcome_text.append("Type ", style="dim")
    welcome_text.append("/help", style="bold yellow")
    welcome_text.append(" for commands or ", style="dim")
    welcome_text.append("/quit", style="bold red")
    welcome_text.append(" to exit.", style="dim")
    
    panel = Panel(
        welcome_text,
        border_style="blue",
        padding=(1, 2),
    )
    console.print(panel)


def print_help():
    """Print help message."""
    table = Table(title="Available Commands", show_header=True, header_style="bold cyan")
    table.add_column("Command", style="yellow", no_wrap=True)
    table.add_column("Description")
    
    table.add_row("/help", "Show this help message")
    table.add_row("/quit", "Exit the application")
    table.add_row("/exit", "Exit the application")
    table.add_row("/clear", "Clear the screen")
    
    console.print(table)
    console.print()
    
    examples = Table(title="Example Queries", show_header=True, header_style="bold cyan")
    examples.add_column("Query", style="green")
    examples.add_column("Description")
    
    examples.add_row(
        "Find coffee shops near Times Square",
        "Search for POIs near a location"
    )
    examples.add_row(
        "Get directions from LAX to Hollywood",
        "Get turn-by-turn directions"
    )
    examples.add_row(
        "What's the address at -77.036, 38.895?",
        "Reverse geocode coordinates"
    )
    examples.add_row(
        "Show me a map of Central Park",
        "Create a static map image"
    )
    examples.add_row(
        "What's reachable in 30 minutes from downtown Portland?",
        "Generate isochrone areas"
    )
    
    console.print(examples)


async def process_query(query: str) -> LocationResult | None:
    """Process a user query with the Mapbox agent.
    
    Args:
        query: User's natural language query
        
    Returns:
        Agent's response or None if error
    """
    try:
        # Create agent and dependencies
        agent, deps = await create_agent_with_deps()
        
        # Create progress indicator
        with Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            task = progress.add_task("Thinking...", total=None)
            
            # Run the agent
            async with deps.mcp_client:
                result = await agent.run(
                    query,
                    deps=deps,
                )
                
            progress.update(task, completed=True)
        
        return result.output
        
    except Exception as e:
        logfire.error("Query processing failed", error=str(e), query=query)
        console.print(f"[red]Error: {str(e)}[/red]")
        return None


def format_result(result: LocationResult):
    """Format and display the agent's result.
    
    Args:
        result: Agent's response
    """
    # Main answer
    console.print(Panel(
        result.answer,
        title="[bold cyan]Response[/bold cyan]",
        border_style="cyan",
        padding=(1, 2),
    ))
    
    # Tool information
    if result.tool_used:
        console.print(f"\n[dim]Tool used: {result.tool_used}[/dim]")
    
    # Map URL if available
    if result.map_url:
        console.print(f"\n[bold blue]Map URL:[/bold blue] {result.map_url}")
    
    # Additional data if available
    if result.data:
        # Check if data contains image data
        if result.data.get("type") == "image":
            console.print("\n[bold yellow]Static Map Image Data:[/bold yellow]")
            console.print(f"[dim]MIME Type:[/dim] {result.data.get('mimeType', 'unknown')}")
            console.print("\n[bold green]Base64 Image Data:[/bold green]")
            # Print the raw base64 string
            image_data = result.data.get("data", "")
            if image_data:
                # Print base64 data in a box for clarity
                console.print(Panel(
                    image_data,
                    title="[bold]Base64 Encoded Image[/bold]",
                    border_style="green",
                    padding=(1, 2),
                ))
            else:
                console.print("[red]No image data found[/red]")
        else:
            console.print("\n[bold yellow]Additional Data:[/bold yellow]")
            # Pretty print JSON data
            syntax = Syntax(
                str(result.data),
                "json",
                theme="monokai",
                line_numbers=False,
            )
            console.print(syntax)


async def interactive_loop():
    """Run the interactive query loop."""
    print_welcome()
    
    while True:
        try:
            # Get user input
            console.print()
            query = Prompt.ask("[bold green]You[/bold green]")
            
            # Handle commands
            if query.lower() in ["/quit", "/exit"]:
                console.print("[yellow]Goodbye! 👋[/yellow]")
                break
            elif query.lower() == "/help":
                print_help()
                continue
            elif query.lower() == "/clear":
                console.clear()
                print_welcome()
                continue
            elif query.strip() == "":
                continue
            
            # Process the query
            result = await process_query(query)
            
            if result:
                format_result(result)
            
        except KeyboardInterrupt:
            console.print("\n[yellow]Interrupted. Use /quit to exit.[/yellow]")
        except Exception as e:
            logfire.error("Unexpected error in interactive loop", error=str(e))
            console.print(f"[red]Unexpected error: {str(e)}[/red]")


@app.command()
def main(
    query: str | None = typer.Argument(
        None,
        help="Single query to process (if not provided, starts interactive mode)"
    ),
):
    """Run the Mapbox MCP Agent CLI.
    
    If a query is provided, processes it and exits.
    Otherwise, starts an interactive session.
    """
    try:
        if query:
            # Single query mode
            result = asyncio.run(process_query(query))
            if result:
                format_result(result)
        else:
            # Interactive mode
            try:
                asyncio.run(interactive_loop())
            except KeyboardInterrupt:
                console.print("\n[yellow]Goodbye! 👋[/yellow]")
    finally:
        # Ensure clean shutdown
        logfire.shutdown()
        sys.exit(0)


if __name__ == "__main__":
    app()