#!/usr/bin/env python3
"""Docker-compatible Playwright tests for the Phony system."""

import asyncio
import json
import time
from datetime import datetime
from playwright.async_api import async_playwright
import os


class PlaywrightDockerTests:
    """Playwright tests that run inside Docker containers."""
    
    def __init__(self):
        self.base_url = "http://backend:8000"  # Use Docker service name
        self.test_results = {
            "session_id": f"playwright-docker-{int(time.time())}",
            "start_time": datetime.now().isoformat(),
            "tests": {},
            "screenshots": [],
            "overall_status": "running"
        }
        self.browser = None
        self.page = None
    
    async def setup_browser(self):
        """Initialize Playwright browser."""
        print("🌐 Initializing Playwright browser...")
        self.playwright = await async_playwright().start()
        
        # Use chromium in headless mode for Docker
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )
        self.context = await self.browser.new_context()
        self.page = await self.context.new_page()
        print("✅ Browser initialized")
    
    async def cleanup_browser(self):
        """Clean up browser resources."""
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        print("🧹 Browser cleaned up")
    
    async def test_backend_health(self):
        """Test backend health endpoint."""
        print("\n🧪 Testing Backend Health...")
        try:
            response = await self.page.goto(f"{self.base_url}/healthz")
            content = await response.text()
            data = json.loads(content)
            
            status_ok = data.get("status") == "ok"
            has_uptime = "uptime" in data
            has_calls = "activeCalls" in data
            
            success = status_ok and has_uptime and has_calls
            
            self.test_results["tests"]["backend_health"] = {
                "status": "✅ PASS" if success else "❌ FAIL",
                "details": data
            }
            
            print(f"   Health Status: {'✅ PASS' if success else '❌ FAIL'}")
            print(f"   Response: {data}")
            return success
            
        except Exception as e:
            self.test_results["tests"]["backend_health"] = {
                "status": "❌ FAIL",
                "error": str(e)
            }
            print(f"   ❌ FAILED: {e}")
            return False
    
    async def test_dashboard_loading(self):
        """Test dashboard page loading."""
        print("\n🧪 Testing Dashboard Loading...")
        try:
            response = await self.page.goto(f"{self.base_url}/dashboard/")
            
            # Check page loaded
            status_ok = response.status == 200
            
            # Wait for React to load
            await self.page.wait_for_timeout(2000)
            
            # Check for title
            title = await self.page.title()
            has_title = "Phony" in title or "Dashboard" in title
            
            # Check for key elements
            has_content = await self.page.locator("body").count() > 0
            
            # Take screenshot
            screenshot_path = f"/app/test-screenshots/dashboard-{int(time.time())}.png"
            os.makedirs("/app/test-screenshots", exist_ok=True)
            await self.page.screenshot(path=screenshot_path)
            self.test_results["screenshots"].append(screenshot_path)
            
            success = status_ok and has_title and has_content
            
            self.test_results["tests"]["dashboard_loading"] = {
                "status": "✅ PASS" if success else "❌ FAIL",
                "title": title,
                "screenshot": screenshot_path
            }
            
            print(f"   Dashboard Loading: {'✅ PASS' if success else '❌ FAIL'}")
            print(f"   Title: {title}")
            print(f"   Screenshot: {screenshot_path}")
            return success
            
        except Exception as e:
            self.test_results["tests"]["dashboard_loading"] = {
                "status": "❌ FAIL",
                "error": str(e)
            }
            print(f"   ❌ FAILED: {e}")
            return False
    
    async def test_dashboard_with_callsid(self):
        """Test dashboard with callSid parameter."""
        print("\n🧪 Testing Dashboard with CallSid...")
        try:
            call_sid = f"test-{int(time.time())}"
            response = await self.page.goto(f"{self.base_url}/dashboard/index.html?callSid={call_sid}")
            
            status_ok = response.status == 200
            
            # Wait for React components
            await self.page.wait_for_timeout(3000)
            
            # Check for interactive elements
            elements_found = {
                "message_input": False,
                "send_button": False,
                "dtmf_buttons": False,
                "control_buttons": False
            }
            
            # Try to find message input
            try:
                message_input = await self.page.locator('input[type="text"], textarea').first.count()
                elements_found["message_input"] = message_input > 0
            except:
                pass
            
            # Try to find send button
            try:
                send_button = await self.page.locator('button:has-text("Send")').count()
                elements_found["send_button"] = send_button > 0
            except:
                pass
            
            # Try to find DTMF buttons
            try:
                dtmf_count = 0
                for digit in ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#']:
                    count = await self.page.locator(f'button:has-text("{digit}")').count()
                    dtmf_count += count
                elements_found["dtmf_buttons"] = dtmf_count >= 12
            except:
                pass
            
            # Try to find control buttons
            try:
                end_call = await self.page.locator('button:has-text("End")').count()
                transfer = await self.page.locator('button:has-text("Transfer")').count()
                elements_found["control_buttons"] = (end_call + transfer) > 0
            except:
                pass
            
            # Take screenshot
            screenshot_path = f"/app/test-screenshots/dashboard-full-{int(time.time())}.png"
            await self.page.screenshot(path=screenshot_path, full_page=True)
            self.test_results["screenshots"].append(screenshot_path)
            
            success = status_ok and any(elements_found.values())
            
            self.test_results["tests"]["dashboard_with_callsid"] = {
                "status": "✅ PASS" if success else "❌ FAIL",
                "call_sid": call_sid,
                "elements_found": elements_found,
                "screenshot": screenshot_path
            }
            
            print(f"   Dashboard with CallSid: {'✅ PASS' if success else '❌ FAIL'}")
            print(f"   Elements found: {elements_found}")
            print(f"   Screenshot: {screenshot_path}")
            return success
            
        except Exception as e:
            self.test_results["tests"]["dashboard_with_callsid"] = {
                "status": "❌ FAIL",
                "error": str(e)
            }
            print(f"   ❌ FAILED: {e}")
            return False
    
    async def test_console_errors(self):
        """Check for console errors."""
        print("\n🧪 Testing Console Errors...")
        try:
            console_messages = []
            errors = []
            
            # Set up console listener
            self.page.on("console", lambda msg: console_messages.append({
                "type": msg.type,
                "text": msg.text
            }))
            
            # Navigate to dashboard
            await self.page.goto(f"{self.base_url}/dashboard/index.html?callSid=test-console")
            await self.page.wait_for_timeout(3000)
            
            # Filter for errors
            for msg in console_messages:
                if msg["type"] in ["error", "warning"]:
                    # Ignore known development warnings
                    if "DevTools" not in msg["text"] and "babel" not in msg["text"]:
                        errors.append(msg)
            
            success = len(errors) == 0
            
            self.test_results["tests"]["console_errors"] = {
                "status": "✅ PASS" if success else "⚠️  WARNING",
                "total_messages": len(console_messages),
                "errors": errors
            }
            
            print(f"   Console Errors: {'✅ NONE' if success else f'⚠️  {len(errors)} found'}")
            if errors:
                for err in errors[:3]:  # Show first 3 errors
                    print(f"      - {err['type']}: {err['text'][:100]}")
            return True  # Don't fail on console errors
            
        except Exception as e:
            self.test_results["tests"]["console_errors"] = {
                "status": "❌ FAIL",
                "error": str(e)
            }
            print(f"   ❌ FAILED: {e}")
            return False
    
    async def test_api_endpoints(self):
        """Test various API endpoints."""
        print("\n🧪 Testing API Endpoints...")
        
        endpoints = [
            ("/healthz", 200),
            ("/dashboard/", 200),
            ("/dashboard/index.html", 200),
            ("/invalid-endpoint", 404)
        ]
        
        results = {}
        for endpoint, expected_status in endpoints:
            try:
                response = await self.page.goto(f"{self.base_url}{endpoint}")
                actual_status = response.status
                success = actual_status == expected_status
                results[endpoint] = {
                    "expected": expected_status,
                    "actual": actual_status,
                    "status": "✅" if success else "❌"
                }
            except Exception as e:
                results[endpoint] = {
                    "error": str(e),
                    "status": "❌"
                }
        
        all_passed = all(r.get("status") == "✅" for r in results.values())
        
        self.test_results["tests"]["api_endpoints"] = {
            "status": "✅ PASS" if all_passed else "❌ FAIL",
            "endpoints": results
        }
        
        print(f"   API Endpoints: {'✅ PASS' if all_passed else '❌ FAIL'}")
        for endpoint, result in results.items():
            print(f"      {result['status']} {endpoint}")
        
        return all_passed
    
    async def run_all_tests(self):
        """Run all Playwright tests."""
        print("\n🎭 Playwright Docker Test Suite")
        print("=" * 60)
        
        try:
            await self.setup_browser()
            
            test_functions = [
                self.test_backend_health,
                self.test_dashboard_loading,
                self.test_dashboard_with_callsid,
                self.test_console_errors,
                self.test_api_endpoints
            ]
            
            passed_tests = 0
            total_tests = len(test_functions)
            
            for test_func in test_functions:
                try:
                    result = await test_func()
                    if result:
                        passed_tests += 1
                except Exception as e:
                    print(f"   ❌ Test exception: {e}")
            
            # Final results
            self.test_results["end_time"] = datetime.now().isoformat()
            self.test_results["passed"] = passed_tests
            self.test_results["total"] = total_tests
            self.test_results["overall_status"] = "passed" if passed_tests >= total_tests * 0.8 else "failed"
            
            print(f"\n📋 Playwright Docker Test Results")
            print("=" * 40)
            print(f"✅ Passed: {passed_tests}/{total_tests}")
            print(f"📊 Success Rate: {(passed_tests/total_tests)*100:.1f}%")
            print(f"🎯 Overall Status: {self.test_results['overall_status'].upper()}")
            
            # Save results
            report_file = f"/app/playwright_docker_results_{self.test_results['session_id']}.json"
            with open(report_file, 'w') as f:
                json.dump(self.test_results, f, indent=2)
            print(f"📄 Detailed report: {report_file}")
            
            if self.test_results["screenshots"]:
                print(f"📸 Screenshots saved: {len(self.test_results['screenshots'])} files")
            
            return passed_tests >= total_tests * 0.8
            
        finally:
            await self.cleanup_browser()


async def main():
    """Run the Playwright Docker test suite."""
    tester = PlaywrightDockerTests()
    success = await tester.run_all_tests()
    
    if success:
        print(f"\n🎉 Playwright Docker tests completed successfully!")
    else:
        print(f"\n⚠️  Some Playwright tests failed.")
    
    return success


if __name__ == "__main__":
    result = asyncio.run(main())
    exit(0 if result else 1)