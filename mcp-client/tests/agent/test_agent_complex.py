"""Test complex agent scenarios involving multiple tools."""
import pytest

from src.mapbox_agent import MapboxDependencies, mapbox_agent


@pytest.mark.asyncio
async def test_agent_multi_step_planning(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent handling complex multi-step queries."""
    result = await mapbox_agent.run(
        "I'm at the Empire State Building and need to find a coffee shop nearby, "
        "then get walking directions to Times Square from there",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should provide comprehensive answer
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["coffee", "walk", "times square"])


@pytest.mark.asyncio
async def test_agent_location_analysis(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent analyzing location accessibility."""
    result = await mapbox_agent.run(
        "What restaurants can I reach within 10 minutes walking from the Golden Gate Bridge visitor center?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["restaurant", "walk", "minute", "reach"])


@pytest.mark.asyncio
async def test_agent_map_visualization(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent creating map visualizations."""
    result = await mapbox_agent.run(
        "Show me a map of the area around Central Park with nearby museums marked",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should either create a map or describe the area
    if result.output.map_url:
        assert result.output.map_url.startswith("http")
        assert "mapbox" in result.output.map_url
    assert result.output.tool_used in ["create_static_map", "search_poi"]


@pytest.mark.asyncio
async def test_agent_route_optimization(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent suggesting optimal routes."""
    result = await mapbox_agent.run(
        "What's the best way to visit the Statue of Liberty, Brooklyn Bridge, "
        "and One World Trade Center in one day using public transport?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should provide route suggestions
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["route", "visit", "travel", "subway", "ferry"])


@pytest.mark.asyncio
async def test_agent_comparative_analysis(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent comparing different travel options."""
    result = await mapbox_agent.run(
        "Compare driving vs walking time from Penn Station to Madison Square Garden",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    # Should mention both driving and walking
    assert "walk" in answer_lower
    assert any(term in answer_lower for term in ["drive", "driving", "car"])
    assert any(term in answer_lower for term in ["minute", "time"])


@pytest.mark.asyncio
async def test_agent_error_recovery(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent handling ambiguous or difficult queries."""
    result = await mapbox_agent.run(
        "How do I get to that famous bridge in San Francisco?",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should infer Golden Gate Bridge and provide helpful response
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["golden gate", "bridge", "direction"])