#!/usr/bin/env python3
"""End-to-end test runner that orchestrates the full demo test suite.

This script coordinates:
1. Starting the backend services in Docker
2. Running the enhanced LLM demo
3. Executing Playwright tests against the live demo
4. Generating comprehensive test reports
"""

import asyncio
import subprocess
import time
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any


class E2ETestRunner:
    """Orchestrates end-to-end testing of the live demo."""
    
    def __init__(self):
        self.test_session_id = f"e2e-{int(time.time())}"
        self.results = {
            "session_id": self.test_session_id,
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "services": {},
            "tests": {},
            "demo_results": {},
            "overall_status": "running"
        }
        self.services = []
        
    async def start_services(self) -> bool:
        """Start required Docker services."""
        print("🚀 Starting Docker services...")
        
        services_to_start = ["redis", "backend"]
        
        for service in services_to_start:
            print(f"   Starting {service}...")
            result = subprocess.run([
                "docker-compose", "up", "-d", service
            ], capture_output=True, text=True)
            
            if result.returncode == 0:
                self.results["services"][service] = "started"
                self.services.append(service)
                print(f"   ✅ {service} started")
            else:
                print(f"   ❌ Failed to start {service}: {result.stderr}")
                self.results["services"][service] = f"failed: {result.stderr}"
                return False
        
        # Wait for services to be ready
        print("⏳ Waiting for services to be ready...")
        await asyncio.sleep(10)
        
        # Test backend health
        health_check = await self.check_backend_health()
        if not health_check:
            print("❌ Backend health check failed")
            return False
        
        print("✅ All services ready")
        return True
    
    async def check_backend_health(self) -> bool:
        """Check if backend is healthy."""
        try:
            result = subprocess.run([
                "curl", "-f", "http://localhost:24187/healthz"
            ], capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                self.results["services"]["backend_health"] = "healthy"
                return True
            else:
                self.results["services"]["backend_health"] = "unhealthy"
                return False
        except subprocess.TimeoutExpired:
            self.results["services"]["backend_health"] = "timeout"
            return False
        except Exception as e:
            self.results["services"]["backend_health"] = f"error: {e}"
            return False
    
    async def run_demo_background(self) -> Dict[str, Any]:
        """Start the enhanced LLM demo in background."""
        print("🤖 Starting enhanced LLM demo...")
        
        # Create demo script that runs in background
        demo_script = """
import asyncio
import sys
sys.path.append('/app')
from scripts.enhanced_llm_demo import EnhancedDemo

async def run_background_demo():
    demo = EnhancedDemo()
    try:
        # Demo will run its own server internally
        await demo.run_llm_to_llm_demo("Hello, I'd like to test the system today.")
    except Exception as e:
        print(f"Demo error: {e}")
        return False
    return True

if __name__ == "__main__":
    result = asyncio.run(run_background_demo())
    sys.exit(0 if result else 1)
"""
        
        # Write temporary demo script
        demo_script_path = Path("/tmp/background_demo.py")
        with open(demo_script_path, 'w') as f:
            f.write(demo_script)
        
        # Start demo in background
        demo_process = subprocess.Popen([
            "docker-compose", "run", "--rm", "-d", "demo",
            "python3", "/tmp/background_demo.py"
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        # Give demo time to start
        await asyncio.sleep(5)
        
        demo_info = {
            "process_id": demo_process.pid,
            "status": "running",
            "call_sids": [
                f"demo-caller-{self.test_session_id}",
                f"demo-receiver-{self.test_session_id}"
            ]
        }
        
        self.results["demo_results"] = demo_info
        print("✅ Demo started in background")
        return demo_info
    
    async def run_playwright_tests(self) -> Dict[str, Any]:
        """Run the Playwright test suite."""
        print("🎭 Running Playwright test suite...")
        
        # Import and run our Playwright tests
        test_results = {
            "total_tests": 0,
            "passed": 0,
            "failed": 0,
            "errors": [],
            "test_details": {}
        }
        
        # List of test functions from our test file
        test_functions = [
            "test_demo_dashboard_loads",
            "test_demo_health_endpoint", 
            "test_llm_demo_monitoring",
            "test_real_time_event_simulation",
            "test_dashboard_form_interactions",
            "test_error_handling_and_recovery",
            "test_console_logs_and_errors",
            "test_network_requests",
            "test_full_demo_integration"
        ]
        
        # Run tests by importing and executing the test module
        try:
            import sys
            sys.path.append('/app')
            import tests.e2e.test_live_demo_playwright as playwright_tests
            
            for test_name in test_functions:
                test_results["total_tests"] += 1
                print(f"   Running {test_name}...")
                
                try:
                    # Get the test function and run it
                    test_func = getattr(playwright_tests, test_name, None)
                    if test_func:
                        test_func()
                        test_results["passed"] += 1
                        test_results["test_details"][test_name] = "passed"
                        print(f"   ✅ {test_name} passed")
                    else:
                        raise Exception(f"Test function {test_name} not found")
                        
                except Exception as e:
                    test_results["failed"] += 1
                    test_results["errors"].append(f"{test_name}: {e}")
                    test_results["test_details"][test_name] = f"failed: {e}"
                    print(f"   ❌ {test_name} failed: {e}")
        
        except ImportError as e:
            print(f"❌ Failed to import test module: {e}")
            test_results["errors"].append(f"Import error: {e}")
            test_results["failed"] = len(test_functions)
            test_results["total_tests"] = len(test_functions)
        
        self.results["tests"] = test_results
        
        # Summary
        if test_results["failed"] == 0:
            print(f"✅ All {test_results['passed']} Playwright tests passed")
        else:
            print(f"❌ {test_results['failed']} of {test_results['total_tests']} tests failed")
        
        return test_results
    
    async def cleanup_services(self) -> None:
        """Clean up Docker services."""
        print("🧹 Cleaning up services...")
        
        # Stop services
        if self.services:
            result = subprocess.run([
                "docker-compose", "down"
            ], capture_output=True, text=True)
            
            if result.returncode == 0:
                print("✅ Services stopped")
            else:
                print(f"⚠️  Service cleanup warning: {result.stderr}")
    
    async def generate_report(self) -> None:
        """Generate comprehensive test report."""
        self.results["end_time"] = datetime.now().isoformat()
        
        # Calculate overall status
        if self.results["tests"].get("failed", 0) == 0:
            self.results["overall_status"] = "passed"
        else:
            self.results["overall_status"] = "failed"
        
        # Save detailed report
        report_file = Path(f"e2e_test_report_{self.test_session_id}.json")
        with open(report_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        # Print summary report
        print("\n📋 E2E Test Report")
        print("=" * 50)
        print(f"Session ID: {self.test_session_id}")
        print(f"Status: {self.results['overall_status'].upper()}")
        
        if self.results["tests"]:
            tests = self.results["tests"]
            print(f"Tests: {tests['passed']}/{tests['total_tests']} passed")
            
            if tests.get("errors"):
                print("\n❌ Test Errors:")
                for error in tests["errors"][:3]:  # Show first 3 errors
                    print(f"   - {error}")
        
        print(f"\n📄 Detailed report: {report_file}")
    
    async def run_full_e2e_test(self) -> bool:
        """Run the complete end-to-end test suite."""
        print("🎪 Phony E2E Test Suite")
        print("=" * 60)
        
        try:
            # Step 1: Start services
            if not await self.start_services():
                return False
            
            # Step 2: Start demo
            demo_info = await self.run_demo_background()
            
            # Step 3: Run tests
            test_results = await self.run_playwright_tests()
            
            # Step 4: Generate report
            await self.generate_report()
            
            # Success if no test failures
            return test_results.get("failed", 1) == 0
            
        except Exception as e:
            print(f"💥 E2E test suite failed: {e}")
            import traceback
            traceback.print_exc()
            self.results["overall_status"] = f"error: {e}"
            return False
            
        finally:
            # Always cleanup
            await self.cleanup_services()


async def main():
    """Main entry point for E2E test runner."""
    runner = E2ETestRunner()
    
    success = await runner.run_full_e2e_test()
    
    if success:
        print("\n🎉 E2E test suite completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ E2E test suite failed!")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n❌ E2E tests cancelled by user")
        sys.exit(1)