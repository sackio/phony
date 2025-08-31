import pytest
import time
import asyncio
import concurrent.futures
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from backend.main import app


@pytest.fixture
def client():
    """Test client for FastAPI app."""
    return TestClient(app)


def test_api_response_time_benchmarks(client):
    """Test API response time benchmarks for all endpoints."""
    endpoints_to_test = [
        ("/healthz", "GET", None),
        ("/start_call", "POST", {"CallSid": "CA123"}),
        ("/receive_call", "POST", {"CallSid": "CA456"}),
        ("/override/text", "POST", {"call_sid": "CA789", "text": "test"}),
        ("/override/dtmf", "POST", {"call_sid": "CA789", "digit": "1"}),
        ("/override/end", "POST", {"call_sid": "CA789"}),
        ("/override/transfer", "POST", {"call_sid": "CA789", "number": "+15551234567"}),
        ("/override/clarification", "POST", {"call_sid": "CA789", "clarification": "test"})
    ]
    
    # Acceptable response times (in seconds)
    max_response_times = {
        "/healthz": 0.1,  # Health check should be very fast
        "/start_call": 0.5,  # TwiML generation should be fast
        "/receive_call": 0.5,
        "/override/text": 0.2,  # Override commands should be fast
        "/override/dtmf": 0.2,
        "/override/end": 0.2,
        "/override/transfer": 0.2,
        "/override/clarification": 0.2,
    }
    
    with patch('backend.main.validate_twilio_request', return_value=True), \
         patch('backend.override_api.send_text_to_caller', return_value={"success": True}), \
         patch('backend.override_api.send_dtmf_to_caller', return_value={"success": True}), \
         patch('backend.override_api.terminate_call', return_value={"success": True}), \
         patch('backend.override_api.transfer_call', return_value={"success": True}), \
         patch('backend.override_api.provide_clarification', return_value={"success": True}):
        
        for endpoint, method, data in endpoints_to_test:
            start_time = time.time()
            
            if method == "GET":
                response = client.get(endpoint)
            else:
                if "/override/" in endpoint:
                    response = client.post(endpoint, json=data)
                else:
                    response = client.post(endpoint, data=data)
            
            end_time = time.time()
            response_time = end_time - start_time
            
            # Verify response is successful
            assert response.status_code in [200, 201], f"Endpoint {endpoint} failed with status {response.status_code}"
            
            # Check response time is within acceptable limits
            max_time = max_response_times.get(endpoint, 1.0)  # Default 1 second if not specified
            assert response_time < max_time, f"Endpoint {endpoint} took {response_time:.3f}s (max: {max_time}s)"
            
            print(f"✓ {endpoint} responded in {response_time:.3f}s")


def test_concurrent_request_handling(client):
    """Test system performance under concurrent requests."""
    num_concurrent_requests = 50
    endpoint_configs = [
        ("/start_call", {"CallSid": "CA_LOAD_TEST"}),
        ("/override/text", {"call_sid": "CA_LOAD_TEST", "text": "Load test message"})
    ]
    
    def make_request(endpoint, data):
        start_time = time.time()
        
        if "/override/" in endpoint:
            response = client.post(endpoint, json=data)
        else:
            response = client.post(endpoint, data=data)
        
        end_time = time.time()
        return {
            "endpoint": endpoint,
            "status_code": response.status_code,
            "response_time": end_time - start_time,
            "success": response.status_code in [200, 201]
        }
    
    with patch('backend.main.validate_twilio_request', return_value=True), \
         patch('backend.override_api.send_text_to_caller', return_value={"success": True}):
        
        for endpoint, data in endpoint_configs:
            print(f"\nTesting {num_concurrent_requests} concurrent requests to {endpoint}")
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                start_time = time.time()
                
                futures = [
                    executor.submit(make_request, endpoint, {**data, "CallSid": f"CA_{i}"})
                    for i in range(num_concurrent_requests)
                ]
                
                results = [future.result() for future in futures]
                
                end_time = time.time()
                total_time = end_time - start_time
            
            # Analyze results
            successful_requests = sum(1 for r in results if r["success"])
            failed_requests = len(results) - successful_requests
            avg_response_time = sum(r["response_time"] for r in results) / len(results)
            max_response_time = max(r["response_time"] for r in results)
            min_response_time = min(r["response_time"] for r in results)
            
            print(f"Total time: {total_time:.2f}s")
            print(f"Successful requests: {successful_requests}/{num_concurrent_requests}")
            print(f"Failed requests: {failed_requests}")
            print(f"Average response time: {avg_response_time:.3f}s")
            print(f"Min/Max response time: {min_response_time:.3f}s / {max_response_time:.3f}s")
            
            # Performance assertions
            assert successful_requests >= num_concurrent_requests * 0.95, "At least 95% of requests should succeed"
            assert avg_response_time < 1.0, f"Average response time should be under 1s, got {avg_response_time:.3f}s"
            assert max_response_time < 5.0, f"Max response time should be under 5s, got {max_response_time:.3f}s"


@pytest.mark.asyncio
async def test_websocket_performance(client):
    """Test WebSocket connection and message handling performance."""
    num_messages = 100
    message_size_variants = [
        ("small", "Hello"),
        ("medium", "A" * 1000),  # 1KB message
        ("large", "B" * 10000),  # 10KB message
    ]
    
    for size_name, message_content in message_size_variants:
        print(f"\nTesting WebSocket performance with {size_name} messages ({len(message_content)} chars)")
        
        with client.websocket_connect("/relay/ws") as websocket:
            start_time = time.time()
            
            # Send messages
            for i in range(num_messages):
                test_message = {
                    "type": "prompt",
                    "voicePrompt": f"{message_content} {i}",
                    "callSid": f"CA_WS_PERF_{i}"
                }
                
                websocket.send_text(json.dumps(test_message))
                received_data = websocket.receive_text()
                
                # Verify message was echoed back correctly
                assert json.loads(received_data) == test_message
            
            end_time = time.time()
            total_time = end_time - start_time
            
            messages_per_second = num_messages / total_time
            avg_time_per_message = total_time / num_messages
            
            print(f"Processed {num_messages} {size_name} messages in {total_time:.2f}s")
            print(f"Rate: {messages_per_second:.1f} messages/second")
            print(f"Average time per message: {avg_time_per_message:.4f}s")
            
            # Performance assertions
            assert messages_per_second > 10, f"Should process at least 10 {size_name} messages/second"
            assert avg_time_per_message < 0.1, f"Average time per {size_name} message should be under 100ms"


def test_memory_usage_under_load(client):
    """Test memory usage during high load scenarios."""
    import psutil
    import os
    
    # Get current process for memory monitoring
    process = psutil.Process(os.getpid())
    initial_memory = process.memory_info().rss / 1024 / 1024  # MB
    
    print(f"Initial memory usage: {initial_memory:.1f} MB")
    
    # Simulate sustained load
    num_requests = 200
    batch_size = 20
    
    with patch('backend.main.validate_twilio_request', return_value=True), \
         patch('backend.override_api.send_text_to_caller', return_value={"success": True}):
        
        memory_readings = [initial_memory]
        
        for batch in range(num_requests // batch_size):
            # Make batch of requests
            responses = []
            for i in range(batch_size):
                call_id = f"CA_MEM_TEST_{batch}_{i}"
                
                # Alternate between different endpoints
                if i % 2 == 0:
                    response = client.post("/start_call", data={"CallSid": call_id})
                else:
                    response = client.post("/override/text", json={
                        "call_sid": call_id,
                        "text": "Memory test message " * 50  # Larger message
                    })
                
                responses.append(response)
            
            # Check memory usage
            current_memory = process.memory_info().rss / 1024 / 1024  # MB
            memory_readings.append(current_memory)
            
            # Verify all requests succeeded
            for response in responses:
                assert response.status_code in [200, 201]
            
            if batch % 5 == 0:  # Print every 5 batches
                print(f"Batch {batch}: Memory usage: {current_memory:.1f} MB")
        
        final_memory = process.memory_info().rss / 1024 / 1024  # MB
        memory_increase = final_memory - initial_memory
        max_memory = max(memory_readings)
        
        print(f"Final memory usage: {final_memory:.1f} MB")
        print(f"Memory increase: {memory_increase:.1f} MB")
        print(f"Peak memory usage: {max_memory:.1f} MB")
        
        # Memory usage assertions
        assert memory_increase < 100, f"Memory increase should be under 100MB, got {memory_increase:.1f}MB"
        assert max_memory < initial_memory + 150, f"Peak memory should not exceed initial + 150MB"


@pytest.mark.asyncio
async def test_websocket_concurrent_connections(client):
    """Test multiple concurrent WebSocket connections."""
    num_connections = 20
    messages_per_connection = 10
    
    async def websocket_client_simulation(connection_id):
        """Simulate a WebSocket client sending messages."""
        results = []
        
        try:
            with client.websocket_connect("/relay/ws") as websocket:
                for i in range(messages_per_connection):
                    start_time = time.time()
                    
                    message = {
                        "type": "prompt",
                        "voicePrompt": f"Message {i} from connection {connection_id}",
                        "callSid": f"CA_CONN_{connection_id}"
                    }
                    
                    websocket.send_text(json.dumps(message))
                    received = websocket.receive_text()
                    
                    end_time = time.time()
                    
                    results.append({
                        "connection_id": connection_id,
                        "message_id": i,
                        "response_time": end_time - start_time,
                        "success": json.loads(received) == message
                    })
                    
                    # Small delay to simulate realistic usage
                    await asyncio.sleep(0.01)
        
        except Exception as e:
            print(f"Connection {connection_id} failed: {e}")
            return []
        
        return results
    
    print(f"Testing {num_connections} concurrent WebSocket connections")
    
    # Run concurrent WebSocket connections
    start_time = time.time()
    
    tasks = [
        websocket_client_simulation(i) 
        for i in range(num_connections)
    ]
    
    results_per_connection = await asyncio.gather(*tasks, return_exceptions=True)
    
    end_time = time.time()
    total_time = end_time - start_time
    
    # Flatten results and filter out exceptions
    all_results = []
    successful_connections = 0
    
    for connection_results in results_per_connection:
        if isinstance(connection_results, list):
            all_results.extend(connection_results)
            if connection_results:  # Non-empty results
                successful_connections += 1
    
    if all_results:
        avg_response_time = sum(r["response_time"] for r in all_results) / len(all_results)
        successful_messages = sum(1 for r in all_results if r["success"])
        total_messages = len(all_results)
        
        print(f"Total time: {total_time:.2f}s")
        print(f"Successful connections: {successful_connections}/{num_connections}")
        print(f"Successful messages: {successful_messages}/{total_messages}")
        print(f"Average response time: {avg_response_time:.4f}s")
        
        # Performance assertions
        assert successful_connections >= num_connections * 0.9, "At least 90% of connections should succeed"
        assert successful_messages >= total_messages * 0.95, "At least 95% of messages should succeed"
        assert avg_response_time < 0.1, f"Average response time should be under 100ms, got {avg_response_time:.4f}s"


def test_api_throughput_measurement(client):
    """Measure API throughput under sustained load."""
    test_duration = 30  # seconds
    endpoint = "/start_call"
    
    print(f"Measuring API throughput for {test_duration} seconds...")
    
    request_count = 0
    successful_requests = 0
    start_time = time.time()
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        while time.time() - start_time < test_duration:
            response = client.post(endpoint, data={"CallSid": f"CA_THROUGHPUT_{request_count}"})
            request_count += 1
            
            if response.status_code == 200:
                successful_requests += 1
            
            # Small delay to prevent overwhelming the system
            time.sleep(0.01)
    
    actual_duration = time.time() - start_time
    requests_per_second = request_count / actual_duration
    success_rate = successful_requests / request_count if request_count > 0 else 0
    
    print(f"Total requests: {request_count}")
    print(f"Successful requests: {successful_requests}")
    print(f"Success rate: {success_rate:.2%}")
    print(f"Requests per second: {requests_per_second:.1f}")
    
    # Throughput assertions
    assert success_rate >= 0.99, f"Success rate should be at least 99%, got {success_rate:.2%}"
    assert requests_per_second >= 50, f"Should handle at least 50 requests/second, got {requests_per_second:.1f}"


def test_error_rate_under_stress(client):
    """Test error rate under stress conditions."""
    stress_scenarios = [
        ("high_volume", 500, 1),  # 500 requests with 1ms delay
        ("rapid_fire", 100, 0),   # 100 requests with no delay
        ("mixed_endpoints", 200, 5)  # 200 requests across different endpoints with 5ms delay
    ]
    
    for scenario_name, num_requests, delay_ms in stress_scenarios:
        print(f"\nTesting error rate under {scenario_name} stress...")
        
        responses = []
        start_time = time.time()
        
        with patch('backend.main.validate_twilio_request', return_value=True), \
             patch('backend.override_api.send_text_to_caller', return_value={"success": True}):
            
            for i in range(num_requests):
                if scenario_name == "mixed_endpoints" and i % 3 == 0:
                    # Mix in override requests
                    response = client.post("/override/text", json={
                        "call_sid": f"CA_STRESS_{i}",
                        "text": f"Stress test message {i}"
                    })
                else:
                    response = client.post("/start_call", data={
                        "CallSid": f"CA_STRESS_{i}"
                    })
                
                responses.append({
                    "status_code": response.status_code,
                    "success": response.status_code in [200, 201]
                })
                
                if delay_ms > 0:
                    time.sleep(delay_ms / 1000.0)
        
        end_time = time.time()
        total_time = end_time - start_time
        
        # Calculate metrics
        successful_responses = sum(1 for r in responses if r["success"])
        error_rate = 1 - (successful_responses / len(responses))
        requests_per_second = len(responses) / total_time
        
        print(f"Scenario: {scenario_name}")
        print(f"Total requests: {len(responses)}")
        print(f"Successful: {successful_responses}")
        print(f"Error rate: {error_rate:.2%}")
        print(f"Duration: {total_time:.2f}s")
        print(f"RPS: {requests_per_second:.1f}")
        
        # Stress test assertions
        assert error_rate < 0.05, f"Error rate should be under 5% for {scenario_name}, got {error_rate:.2%}"
        
        if scenario_name != "rapid_fire":  # Rapid fire might have lower RPS due to no delays
            assert requests_per_second > 10, f"Should maintain at least 10 RPS under {scenario_name}"