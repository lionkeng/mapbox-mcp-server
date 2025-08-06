"""Test agent POI search capabilities."""
import pytest

from src.mapbox_agent import MapboxDependencies, mapbox_agent


@pytest.mark.asyncio
async def test_agent_poi_search_basic(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can search for points of interest."""
    result = await mapbox_agent.run(
        "Find coffee shops near Times Square",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["coffee", "starbucks", "found", "shops"])
    assert result.output.tool_used == "search_poi"


@pytest.mark.asyncio
async def test_agent_poi_search_with_type(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can search for specific types of POIs."""
    result = await mapbox_agent.run(
        "Show me Italian restaurants near Union Square in San Francisco",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["italian", "restaurant", "found"])
    assert result.output.tool_used == "search_poi"


@pytest.mark.asyncio
async def test_agent_poi_search_with_map(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent can search POIs and create a map."""
    result = await mapbox_agent.run(
        "Find coffee shops near the Space Needle and show them on a map",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should either have a map URL or mention creating a map
    if result.output.map_url:
        assert result.output.map_url.startswith("http")
        assert "mapbox" in result.output.map_url
    else:
        # Tool might be search_poi or create_static_map
        assert result.output.tool_used in ["search_poi", "create_static_map"]


@pytest.mark.asyncio  
async def test_agent_search_no_results(agent_deps: MapboxDependencies, skip_if_no_openai: None) -> None:
    """Test agent handles searches with no results."""
    result = await mapbox_agent.run(
        "Find Michelin 3-star restaurants in Death Valley",
        deps=agent_deps,
    )
    
    assert result.output is not None
    assert result.output.answer is not None
    # Should indicate no results or limited results
    answer_lower = result.output.answer.lower()
    assert any(term in answer_lower for term in ["no", "couldn't find", "not found", "limited", "few"])