"""Test agent geocoding capabilities."""
import pytest

from src.mapbox_agent import MapboxDependencies, mapbox_agent


@pytest.mark.asyncio
async def test_agent_forward_geocoding(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can handle forward geocoding queries."""
    result = await mapbox_agent.run(
        "What are the coordinates of the Empire State Building?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    assert "40.7" in result.output.answer or "73.9" in result.output.answer
    assert result.output.tool_used == "functions.forward_geocode"


@pytest.mark.asyncio
async def test_agent_reverse_geocoding(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can handle reverse geocoding queries."""
    result = await mapbox_agent.run(
        "What's the address at longitude -77.036133, latitude 38.895111?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should mention White House or Pennsylvania Avenue
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["white house", "pennsylvania", "1600"])
    assert result.output.tool_used == "reverse_geocode"


@pytest.mark.asyncio
async def test_agent_geocoding_with_context(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can handle geocoding with contextual information."""
    result = await mapbox_agent.run(
        "I need the exact coordinates for Central Park in New York City for my GPS",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should provide coordinates
    assert "40." in result.output.answer
    assert "-73." in result.output.answer
    assert result.output.tool_used == "forward_geocode"


@pytest.mark.asyncio
async def test_agent_multiple_geocoding_results(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent handles multiple geocoding results appropriately."""
    result = await mapbox_agent.run(
        "Find all Starbucks locations in Manhattan",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should mention multiple locations or results
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["multiple", "several", "found", "locations"])
    assert result.output.tool_used in ["forward_geocode", "search_poi"]