import asyncio
import pytest
import json
from unittest.mock import AsyncMock, patch

from backend import events


@pytest.mark.asyncio
async def test_session_lifecycle():
    """Test complete session lifecycle with start, events, and end."""
    call_sid = "CA123"
    await events.start_session(call_sid)
    queue = events.subscribe(call_sid)
    start_evt = await queue.get()
    assert start_evt["type"] == "session_start"
    await events.publish_event(call_sid, {"type": "custom", "payload": 1})
    evt = await queue.get()
    assert evt == {"type": "custom", "payload": 1}
    await events.end_session(call_sid)
    end_evt = await queue.get()
    assert end_evt["type"] == "session_end"
    sentinel = await queue.get()
    assert sentinel is None


@pytest.mark.asyncio
async def test_subscribe_creates_queue():
    """Test that subscribing to a new session creates a queue."""
    call_sid = "NEW123"
    queue = events.subscribe(call_sid)
    await events.publish_event(call_sid, {"type": "ping"})
    evt = await queue.get()
    assert evt["type"] == "ping"


@pytest.mark.asyncio
async def test_multiple_subscribers_same_session():
    """Test multiple subscribers for the same session."""
    call_sid = "CA456"
    await events.start_session(call_sid)
    
    queue1 = events.subscribe(call_sid)
    queue2 = events.subscribe(call_sid)
    
    # Consume start events from both queues
    start1 = await queue1.get()
    start2 = await queue2.get()
    assert start1["type"] == "session_start"
    assert start2["type"] == "session_start"
    
    # Publish a custom event
    await events.publish_event(call_sid, {"type": "broadcast", "message": "hello"})
    
    # Both queues should receive the event
    evt1 = await queue1.get()
    evt2 = await queue2.get()
    assert evt1 == {"type": "broadcast", "message": "hello"}
    assert evt2 == {"type": "broadcast", "message": "hello"}
    
    await events.end_session(call_sid)


@pytest.mark.asyncio
async def test_publish_to_nonexistent_session():
    """Test publishing to a session that doesn't exist."""
    call_sid = "NONEXISTENT"
    
    # Should not raise an exception
    await events.publish_event(call_sid, {"type": "test", "data": "value"})


@pytest.mark.asyncio
async def test_subscribe_to_ended_session():
    """Test subscribing to a session that has already ended."""
    call_sid = "CA789"
    await events.start_session(call_sid)
    await events.end_session(call_sid)
    
    # Subscribing to an ended session should still work
    queue = events.subscribe(call_sid)
    
    # Should be able to publish and receive events
    await events.publish_event(call_sid, {"type": "late_event"})
    evt = await queue.get()
    assert evt["type"] == "late_event"


@pytest.mark.asyncio
async def test_session_isolation():
    """Test that sessions are isolated from each other."""
    call_sid1 = "CA001"
    call_sid2 = "CA002"
    
    await events.start_session(call_sid1)
    await events.start_session(call_sid2)
    
    queue1 = events.subscribe(call_sid1)
    queue2 = events.subscribe(call_sid2)
    
    # Consume start events
    await queue1.get()
    await queue2.get()
    
    # Publish to session 1
    await events.publish_event(call_sid1, {"type": "session1_event"})
    
    # Only queue1 should receive the event
    evt1 = await queue1.get()
    assert evt1["type"] == "session1_event"
    
    # Queue2 should not have any events (besides start event)
    # Publishing to session 2 to verify isolation
    await events.publish_event(call_sid2, {"type": "session2_event"})
    evt2 = await queue2.get()
    assert evt2["type"] == "session2_event"
    
    await events.end_session(call_sid1)
    await events.end_session(call_sid2)


@pytest.mark.asyncio
async def test_event_ordering():
    """Test that events are received in the correct order."""
    call_sid = "CA_ORDER"
    await events.start_session(call_sid)
    queue = events.subscribe(call_sid)
    
    # Consume start event
    await queue.get()
    
    # Publish multiple events in sequence
    events_to_send = [
        {"type": "event1", "order": 1},
        {"type": "event2", "order": 2},
        {"type": "event3", "order": 3},
    ]
    
    for event in events_to_send:
        await events.publish_event(call_sid, event)
    
    # Events should be received in the same order
    received_events = []
    for _ in events_to_send:
        evt = await queue.get()
        received_events.append(evt)
    
    assert received_events == events_to_send
    
    await events.end_session(call_sid)


@pytest.mark.asyncio
async def test_concurrent_publishing():
    """Test concurrent event publishing."""
    call_sid = "CA_CONCURRENT"
    await events.start_session(call_sid)
    queue = events.subscribe(call_sid)
    
    # Consume start event
    await queue.get()
    
    # Publish events concurrently
    events_to_send = [
        {"type": f"concurrent_{i}", "value": i}
        for i in range(10)
    ]
    
    # Use asyncio.gather to publish concurrently
    await asyncio.gather(*[
        events.publish_event(call_sid, event)
        for event in events_to_send
    ])
    
    # All events should be received (order may vary due to concurrency)
    received_events = []
    for _ in events_to_send:
        evt = await asyncio.wait_for(queue.get(), timeout=1.0)
        received_events.append(evt)
    
    # Sort both lists for comparison since order may vary
    received_events.sort(key=lambda x: x["value"])
    events_to_send.sort(key=lambda x: x["value"])
    
    assert received_events == events_to_send
    
    await events.end_session(call_sid)


@pytest.mark.asyncio
async def test_queue_overflow_handling():
    """Test queue behavior under high load."""
    call_sid = "CA_OVERFLOW"
    await events.start_session(call_sid)
    queue = events.subscribe(call_sid)
    
    # Consume start event
    await queue.get()
    
    # Publish many events quickly
    num_events = 100
    for i in range(num_events):
        await events.publish_event(call_sid, {"type": "load_test", "index": i})
    
    # All events should be received
    received_count = 0
    for _ in range(num_events):
        evt = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert evt["type"] == "load_test"
        received_count += 1
    
    assert received_count == num_events
    
    await events.end_session(call_sid)


@pytest.mark.asyncio
async def test_session_cleanup_on_end():
    """Test that session resources are cleaned up properly."""
    call_sid = "CA_CLEANUP"
    await events.start_session(call_sid)
    
    # Verify session exists in internal data structures
    assert call_sid in events.SESSION_QUEUES
    
    queue = events.subscribe(call_sid)
    await queue.get()  # Consume start event
    
    await events.end_session(call_sid)
    
    # Session should still be in queues until all subscribers are done
    # But end event should be published
    end_evt = await queue.get()
    assert end_evt["type"] == "session_end"
    
    sentinel = await queue.get()
    assert sentinel is None


@pytest.mark.asyncio 
async def test_event_with_complex_data():
    """Test events with complex nested data structures."""
    call_sid = "CA_COMPLEX"
    await events.start_session(call_sid)
    queue = events.subscribe(call_sid)
    
    await queue.get()  # Consume start event
    
    complex_event = {
        "type": "complex_data",
        "metadata": {
            "caller": {
                "number": "+15551234567",
                "location": "US",
                "verified": True
            },
            "ai_response": {
                "model": "gpt-4o-realtime-preview",
                "confidence": 0.95,
                "tokens": 150,
                "latency_ms": 200
            },
            "tags": ["urgent", "billing", "dispute"],
            "timestamps": {
                "call_started": 1234567890,
                "ai_engaged": 1234567895
            }
        },
        "payload": {
            "transcript": "I need help with my billing",
            "sentiment": "negative",
            "entities": ["billing", "help"]
        }
    }
    
    await events.publish_event(call_sid, complex_event)
    
    received_evt = await queue.get()
    assert received_evt == complex_event
    
    await events.end_session(call_sid)


@pytest.mark.asyncio
async def test_websocket_integration():
    """Test integration with WebSocket publishing."""
    call_sid = "CA_WS"
    mock_websocket = AsyncMock()
    
    # Mock the EVENT_SUBSCRIBERS global if it exists
    with patch.dict('backend.events.EVENT_SUBSCRIBERS', {call_sid: [mock_websocket]}, clear=True):
        event_data = {"type": "websocket_test", "message": "hello websocket"}
        
        # This would be the actual publish_event function
        if hasattr(events, 'EVENT_SUBSCRIBERS'):
            await events.publish_event(call_sid, event_data)
            mock_websocket.send_text.assert_called_once_with(json.dumps(event_data))


def test_event_data_serialization():
    """Test that event data can be serialized to JSON."""
    test_events = [
        {"type": "simple", "message": "hello"},
        {"type": "with_numbers", "count": 42, "price": 19.99},
        {"type": "with_booleans", "active": True, "verified": False},
        {"type": "with_null", "optional_field": None},
        {"type": "with_array", "items": [1, 2, 3, "four"]},
        {"type": "nested", "data": {"inner": {"value": "deep"}}},
    ]
    
    for event in test_events:
        # Should be serializable to JSON
        json_str = json.dumps(event)
        
        # Should be deserializable from JSON
        parsed = json.loads(json_str)
        assert parsed == event


@pytest.mark.asyncio
async def test_session_start_idempotency():
    """Test that starting an already started session is safe."""
    call_sid = "CA_IDEMPOTENT"
    
    # Start session twice
    await events.start_session(call_sid)
    await events.start_session(call_sid)  # Should be safe
    
    queue = events.subscribe(call_sid)
    
    # Should only receive one start event
    start_evt = await queue.get()
    assert start_evt["type"] == "session_start"
    
    # Publish a test event to verify everything still works
    await events.publish_event(call_sid, {"type": "test"})
    evt = await queue.get()
    assert evt["type"] == "test"
    
    await events.end_session(call_sid)
