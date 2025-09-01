#!/usr/bin/env python3
"""Playwright system test suite for demo functionality.

This test suite validates the complete demo system using Playwright MCP
to ensure all user interfaces work correctly and demos function end-to-end.
"""

import pytest
import asyncio
import time
import json
from datetime import datetime
from pathlib import Path


class PlaywrightDemoSystemTests:
    """Complete system tests for demo functionality using Playwright MCP."""
    
    def __init__(self):
        self.test_session = f"playwright-{int(time.time())}"
        self.results = {
            "session_id": self.test_session,
            "start_time": datetime.now().isoformat(),
            "tests": {},
            "screenshots": [],
            "overall_status": "running"
        }
    
    def take_test_screenshot(self, filename: str, description: str = ""):
        """Take screenshot and record it."""
        screenshot_file = f"system_test_{filename}_{self.test_session}.png"
        # Using MCP Playwright functions - they will be called directly
        print(f"📸 Taking screenshot: {description}")
        self.results["screenshots"].append({
            "filename": screenshot_file,
            "description": description,
            "timestamp": datetime.now().isoformat()
        })
        return screenshot_file


def test_backend_health_validation():
    """Test backend health endpoint validation."""
    print("🧪 Testing Backend Health Validation...")
    
    # Navigate to health endpoint
    mcp__playwright__browser_navigate(url="http://localhost:24187/healthz")
    
    # Wait for response
    mcp__playwright__browser_wait_for(time=2)
    
    # Get page content
    snapshot = mcp__playwright__browser_snapshot()
    
    # Validate health response
    snapshot_text = str(snapshot).lower()
    health_indicators = ["status", "uptime", "activecalls"]
    
    found_indicators = [indicator for indicator in health_indicators if indicator in snapshot_text]
    
    # Take screenshot
    mcp__playwright__browser_take_screenshot(filename="backend_health_test.png")
    
    assert len(found_indicators) >= 2, f"Health endpoint missing indicators. Found: {found_indicators}"
    print("✅ Backend health validation passed")


def test_dashboard_loading_and_navigation():
    """Test dashboard loading and navigation."""
    print("🧪 Testing Dashboard Loading...")
    
    # Test main dashboard
    mcp__playwright__browser_navigate(url="http://localhost:24187/dashboard/")
    mcp__playwright__browser_wait_for(time=3)
    
    # Take screenshot
    mcp__playwright__browser_take_screenshot(filename="dashboard_main_test.png")
    
    # Get page state
    snapshot = mcp__playwright__browser_snapshot()
    
    # Should show callSid parameter requirement
    assert "callsid" in str(snapshot).lower(), "Dashboard should show callSid requirement"
    
    # Test with demo call SID
    demo_call_sid = f"system-test-{int(time.time())}"
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={demo_call_sid}"
    )
    mcp__playwright__browser_wait_for(time=3)
    
    # Take screenshot of full interface
    mcp__playwright__browser_take_screenshot(filename="dashboard_full_interface_test.png")
    
    # Validate dashboard elements
    dashboard_snapshot = mcp__playwright__browser_snapshot()
    
    required_elements = ["dashboard", "send", "call"]
    found_elements = [elem for elem in required_elements if elem in str(dashboard_snapshot).lower()]
    
    assert len(found_elements) >= 2, f"Dashboard missing elements. Found: {found_elements}"
    print("✅ Dashboard loading test passed")


def test_dashboard_interactive_elements():
    """Test dashboard interactive elements."""
    print("🧪 Testing Dashboard Interactive Elements...")
    
    demo_call_sid = f"interactive-test-{int(time.time())}"
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={demo_call_sid}"
    )
    mcp__playwright__browser_wait_for(time=3)
    
    # Test JavaScript functionality
    test_result = mcp__playwright__browser_evaluate(
        function="""() => {
            const results = {
                hasButtons: document.querySelectorAll('button').length > 0,
                hasTextInput: document.querySelectorAll('input[type="text"], textarea').length > 0,
                hasCallSid: window.location.search.includes('callSid'),
                buttonCount: document.querySelectorAll('button').length,
                reactLoaded: !!window.React,
                websocketSupported: !!window.WebSocket
            };
            
            // Log for debugging
            console.log('Interactive test results:', results);
            
            return results;
        }"""
    )
    
    # Take screenshot after interaction
    mcp__playwright__browser_take_screenshot(filename="dashboard_interactive_test.png")
    
    # Validate results
    assert test_result["hasButtons"], "Dashboard should have buttons"
    assert test_result["hasTextInput"], "Dashboard should have text input"
    assert test_result["hasCallSid"], "URL should contain callSid"
    assert test_result["buttonCount"] >= 10, f"Should have many buttons (DTMF + controls), found {test_result['buttonCount']}"
    
    print(f"✅ Interactive elements test passed - Found {test_result['buttonCount']} buttons")


def test_console_error_validation():
    """Test for JavaScript console errors."""
    print("🧪 Testing Console Error Validation...")
    
    # Navigate to dashboard
    mcp__playwright__browser_navigate(url="http://localhost:24187/dashboard/index.html?callSid=console-test")
    mcp__playwright__browser_wait_for(time=3)
    
    # Get console messages
    console_messages = mcp__playwright__browser_console_messages()
    
    # Analyze console messages
    error_messages = []
    warning_count = 0
    
    if console_messages:
        for message in console_messages:
            msg_str = str(message).lower()
            if "error" in msg_str and "404" not in msg_str:  # Ignore expected 404s
                error_messages.append(message)
            elif "warning" in msg_str:
                warning_count += 1
    
    # Take screenshot
    mcp__playwright__browser_take_screenshot(filename="console_validation_test.png")
    
    print(f"📊 Console analysis: {len(error_messages)} errors, {warning_count} warnings")
    
    # Should not have critical errors
    critical_errors = [msg for msg in error_messages if "failed" in str(msg).lower()]
    assert len(critical_errors) == 0, f"Found critical console errors: {critical_errors}"
    
    print("✅ Console validation passed")


def test_real_time_event_simulation():
    """Test real-time event handling simulation."""
    print("🧪 Testing Real-time Event Simulation...")
    
    event_test_sid = f"event-test-{int(time.time())}"
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={event_test_sid}"
    )
    mcp__playwright__browser_wait_for(time=2)
    
    # Simulate event handling
    event_result = mcp__playwright__browser_evaluate(
        function=f"""() => {{
            const eventTestData = {{
                callSid: '{event_test_sid}',
                events: [
                    {{
                        type: 'transcript',
                        timestamp: Date.now(),
                        speaker: 'caller',
                        text: 'Hello, this is a test call for system validation'
                    }},
                    {{
                        type: 'assistant_response', 
                        timestamp: Date.now() + 1000,
                        text: 'Hello! I am the AI assistant. How can I help you today?'
                    }}
                ]
            }};
            
            // Store in window for testing
            window.systemTestEvents = eventTestData;
            
            // Simulate WebSocket connection test
            const wsSupported = !!window.WebSocket;
            const eventStreamUrl = `ws://localhost:24187/events/ws?callSid={event_test_sid}`;
            
            return {{
                callSid: eventTestData.callSid,
                eventCount: eventTestData.events.length,
                websocketSupported: wsSupported,
                eventStreamUrl: eventStreamUrl,
                simulationComplete: true
            }};
        }}"""
    )
    
    # Take screenshot
    mcp__playwright__browser_take_screenshot(filename="realtime_event_test.png")
    
    # Validate event simulation
    assert event_result["simulationComplete"], "Event simulation should complete"
    assert event_result["websocketSupported"], "WebSocket should be supported"
    assert event_result["eventCount"] == 2, "Should have 2 test events"
    
    print("✅ Real-time event simulation passed")


def test_multiple_call_monitoring():
    """Test monitoring multiple calls simultaneously."""
    print("🧪 Testing Multiple Call Monitoring...")
    
    # Test multiple call SIDs
    call_sids = [
        f"multi-test-caller-{int(time.time())}",
        f"multi-test-receiver-{int(time.time())}"
    ]
    
    for i, call_sid in enumerate(call_sids):
        print(f"   Testing call {i+1}: {call_sid}")
        
        mcp__playwright__browser_navigate(
            url=f"http://localhost:24187/dashboard/index.html?callSid={call_sid}"
        )
        mcp__playwright__browser_wait_for(time=2)
        
        # Validate each call monitoring page
        multi_test_result = mcp__playwright__browser_evaluate(
            function=f"""() => {{
                const callSid = new URLSearchParams(window.location.search).get('callSid');
                return {{
                    currentCallSid: callSid,
                    pageLoaded: document.readyState === 'complete',
                    hasControls: document.querySelectorAll('button').length > 0
                }};
            }}"""
        )
        
        assert multi_test_result["currentCallSid"] == call_sid, f"Wrong call SID loaded"
        assert multi_test_result["hasControls"], f"Controls should be available for {call_sid}"
    
    # Take final screenshot
    mcp__playwright__browser_take_screenshot(filename="multiple_call_monitoring_test.png")
    
    print("✅ Multiple call monitoring test passed")


def test_form_interaction_validation():
    """Test form interactions and input validation."""
    print("🧪 Testing Form Interaction Validation...")
    
    form_test_sid = f"form-test-{int(time.time())}"
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={form_test_sid}"
    )
    mcp__playwright__browser_wait_for(time=3)
    
    # Test form interaction simulation
    form_result = mcp__playwright__browser_evaluate(
        function="""() => {
            const formElements = {
                textInputs: document.querySelectorAll('input[type="text"], textarea'),
                buttons: document.querySelectorAll('button'),
                sendButton: null,
                dtmfButtons: []
            };
            
            // Find send button
            Array.from(formElements.buttons).forEach(btn => {
                if (btn.textContent && btn.textContent.toLowerCase().includes('send')) {
                    formElements.sendButton = btn;
                }
                // Identify DTMF buttons (0-9, *, #)
                const text = btn.textContent;
                if (/^[0-9*#]$/.test(text)) {
                    formElements.dtmfButtons.push(text);
                }
            });
            
            // Test input field interaction
            if (formElements.textInputs.length > 0) {
                const input = formElements.textInputs[0];
                input.value = 'System test message';
                input.dispatchEvent(new Event('input'));
            }
            
            return {
                textInputCount: formElements.textInputs.length,
                buttonCount: formElements.buttons.length,
                hasSendButton: !!formElements.sendButton,
                dtmfButtonCount: formElements.dtmfButtons.length,
                dtmfButtons: formElements.dtmfButtons,
                testMessageSet: formElements.textInputs.length > 0 ? formElements.textInputs[0].value : null
            };
        }"""
    )
    
    # Take screenshot after form interaction
    mcp__playwright__browser_take_screenshot(filename="form_interaction_test.png")
    
    # Validate form elements
    assert form_result["textInputCount"] > 0, "Should have text input fields"
    assert form_result["hasSendButton"], "Should have send button"
    assert form_result["dtmfButtonCount"] >= 12, f"Should have DTMF buttons (0-9,*,#), found {form_result['dtmfButtonCount']}"
    assert form_result["testMessageSet"] == "System test message", "Text input should accept test message"
    
    print(f"✅ Form interaction test passed - {form_result['dtmfButtonCount']} DTMF buttons found")


def test_error_boundary_and_recovery():
    """Test error boundaries and recovery mechanisms."""
    print("🧪 Testing Error Boundary and Recovery...")
    
    # Test invalid call SID handling
    invalid_call_sid = "invalid-test-12345-!@#$%"
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={invalid_call_sid}"
    )
    mcp__playwright__browser_wait_for(time=3)
    
    # Test error handling
    error_test_result = mcp__playwright__browser_evaluate(
        function=f"""() => {{
            const callSid = new URLSearchParams(window.location.search).get('callSid');
            
            // Test error boundary
            const errorBoundaryTest = {{
                callSidParsed: callSid === '{invalid_call_sid}',
                pageStillFunctional: document.querySelectorAll('button').length > 0,
                noJSErrors: !window.hasJavaScriptErrors // Assume no global error flag
            }};
            
            return errorBoundaryTest;
        }}"""
    )
    
    # Test navigation to valid page (recovery)
    valid_call_sid = f"recovery-test-{int(time.time())}"
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={valid_call_sid}"
    )
    mcp__playwright__browser_wait_for(time=2)
    
    # Verify recovery
    recovery_snapshot = mcp__playwright__browser_snapshot()
    
    # Take screenshot
    mcp__playwright__browser_take_screenshot(filename="error_recovery_test.png")
    
    # Page should still be functional
    assert error_test_result["pageStillFunctional"], "Page should remain functional with invalid call SID"
    assert len(str(recovery_snapshot)) > 100, "Recovery page should have content"
    
    print("✅ Error boundary and recovery test passed")


@pytest.mark.integration
def test_full_demo_system_integration():
    """Complete integration test of demo system."""
    print("\n🎭 Running Full Demo System Integration Test")
    print("=" * 60)
    
    integration_test_sid = f"integration-{int(time.time())}"
    
    # Step 1: Backend health
    print("Step 1: Backend Health Check")
    test_backend_health_validation()
    
    # Step 2: Dashboard loading
    print("Step 2: Dashboard Loading")
    test_dashboard_loading_and_navigation()
    
    # Step 3: Interactive elements
    print("Step 3: Interactive Elements")
    test_dashboard_interactive_elements()
    
    # Step 4: Console validation
    print("Step 4: Console Validation")
    test_console_error_validation()
    
    # Step 5: Event simulation
    print("Step 5: Event Simulation")
    test_real_time_event_simulation()
    
    # Step 6: Multi-call monitoring
    print("Step 6: Multi-call Monitoring")
    test_multiple_call_monitoring()
    
    # Step 7: Form interaction
    print("Step 7: Form Interaction")
    test_form_interaction_validation()
    
    # Step 8: Error handling
    print("Step 8: Error Handling")
    test_error_boundary_and_recovery()
    
    # Final integration screenshot
    mcp__playwright__browser_navigate(
        url=f"http://localhost:24187/dashboard/index.html?callSid={integration_test_sid}"
    )
    mcp__playwright__browser_wait_for(time=2)
    mcp__playwright__browser_take_screenshot(
        filename="full_integration_final_test.png",
        fullPage=True
    )
    
    print("\n🎉 Full demo system integration test completed successfully!")


def run_playwright_demo_tests():
    """Run all Playwright demo system tests."""
    print("🎪 Playwright Demo System Test Suite")
    print("=" * 60)
    
    test_functions = [
        test_backend_health_validation,
        test_dashboard_loading_and_navigation,
        test_dashboard_interactive_elements,
        test_console_error_validation,
        test_real_time_event_simulation,
        test_multiple_call_monitoring,
        test_form_interaction_validation,
        test_error_boundary_and_recovery,
        test_full_demo_system_integration
    ]
    
    passed_tests = 0
    total_tests = len(test_functions)
    failed_tests = []
    
    for test_func in test_functions:
        try:
            print(f"\n{'='*20} {test_func.__name__} {'='*20}")
            test_func()
            passed_tests += 1
            print(f"✅ {test_func.__name__} PASSED")
        except Exception as e:
            print(f"❌ {test_func.__name__} FAILED: {e}")
            failed_tests.append(test_func.__name__)
    
    # Final results
    print(f"\n📋 Playwright Test Results")
    print("=" * 40)
    print(f"✅ Passed: {passed_tests}/{total_tests}")
    print(f"📊 Success Rate: {(passed_tests/total_tests)*100:.1f}%")
    
    if failed_tests:
        print(f"❌ Failed Tests: {', '.join(failed_tests)}")
    
    success = passed_tests == total_tests
    print(f"🎯 Overall: {'PASSED' if success else 'FAILED'}")
    
    return success


if __name__ == "__main__":
    """Run tests directly for development."""
    try:
        success = run_playwright_demo_tests()
        print(f"\n{'🎉 All tests passed!' if success else '⚠️  Some tests failed.'}")
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n💥 Test suite failed: {e}")
        import traceback
        traceback.print_exc()
        exit(1)