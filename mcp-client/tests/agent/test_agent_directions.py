"""Test agent directions and routing capabilities."""
import pytest

from src.mapbox_agent import MapboxDependencies, mapbox_agent


@pytest.mark.asyncio
async def test_agent_basic_directions(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can provide basic directions."""
    result = await mapbox_agent.run(
        "Get driving directions from LAX airport to Hollywood Walk of Fame",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    # Should mention distance, time, or route
    assert any(term in answer_lower for term in ["miles", "kilometers", "minutes", "route", "drive"])
    assert result.output.tool_used == "get_directions"


@pytest.mark.asyncio
async def test_agent_walking_directions(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can provide walking directions."""
    result = await mapbox_agent.run(
        "How long does it take to walk from Central Park to Times Square?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    # Should mention walking time
    assert any(term in answer_lower for term in ["walk", "minutes", "on foot"])
    assert result.output.tool_used == "get_directions"


@pytest.mark.asyncio
async def test_agent_traffic_aware_directions(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent considers traffic in directions."""
    result = await mapbox_agent.run(
        "What's the fastest route from San Francisco Airport to Golden Gate Bridge during rush hour?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    # Should mention route, time, or traffic
    assert any(term in answer_lower for term in ["route", "minutes", "traffic", "fastest"])
    assert result.output.tool_used == "get_directions"


@pytest.mark.asyncio
async def test_agent_isochrone_query(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can handle isochrone queries."""
    result = await mapbox_agent.run(
        "What areas can I reach within 15 minutes driving from downtown Seattle?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    # Should mention areas, reach, or accessibility
    assert any(term in answer_lower for term in ["reach", "area", "within", "accessible"])
    assert result.output.tool_used == "get_isochrone"


@pytest.mark.asyncio
async def test_agent_travel_matrix(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can calculate travel time matrices."""
    result = await mapbox_agent.run(
        "Calculate travel times between Statue of Liberty, Empire State Building, and Central Park",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    # Should mention times between locations
    assert any(term in answer_lower for term in ["between", "travel time", "minutes", "matrix"])
    assert result.output.tool_used == "calculate_matrix"