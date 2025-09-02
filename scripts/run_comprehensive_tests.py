#!/usr/bin/env python3
"""
Comprehensive test runner for the Phony Voice AI Agent system.
Runs all test suites including unit, integration, system, and E2E tests.
"""

import os
import sys
import json
import subprocess
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any

class TestRunner:
    """Main test runner class."""
    
    def __init__(self):
        self.project_root = Path(__file__).parent.parent
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "total_duration": 0,
            "test_suites": {},
            "summary": {
                "total_tests": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "errors": 0
            }
        }
        
    def log(self, message: str, level: str = "INFO") -> None:
        """Log a message with timestamp."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def run_command(self, command: str, cwd: str = None) -> Dict[str, Any]:
        """Run a shell command and capture output."""
        self.log(f"Running: {command}")
        
        start_time = time.time()
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd or self.project_root,
                capture_output=True,
                text=True,
                timeout=300  # 5 minutes timeout
            )
            
            duration = time.time() - start_time
            
            return {
                "command": command,
                "duration": duration,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "success": result.returncode == 0
            }
        except subprocess.TimeoutExpired:
            return {
                "command": command,
                "duration": time.time() - start_time,
                "returncode": -1,
                "stdout": "",
                "stderr": "Command timed out",
                "success": False
            }
        except Exception as e:
            return {
                "command": command,
                "duration": time.time() - start_time,
                "returncode": -1,
                "stdout": "",
                "stderr": str(e),
                "success": False
            }
    
    def check_environment(self) -> bool:
        """Check if the test environment is properly set up."""
        self.log("🔍 Checking test environment...")
        
        # Check Python version
        python_version = sys.version_info
        if python_version.major != 3 or python_version.minor < 8:
            self.log(f"❌ Python 3.8+ required, found {python_version.major}.{python_version.minor}", "ERROR")
            return False
        self.log(f"✅ Python {python_version.major}.{python_version.minor}.{python_version.micro}")
        
        # Check required directories
        required_dirs = ['backend', 'tests', 'frontend']
        for dir_name in required_dirs:
            if not (self.project_root / dir_name).exists():
                self.log(f"❌ Required directory not found: {dir_name}", "ERROR")
                return False
        self.log(f"✅ Required directories found: {', '.join(required_dirs)}")
        
        # Check if pytest is available
        result = self.run_command("python -m pytest --version")
        if not result["success"]:
            self.log("❌ pytest not available", "ERROR")
            return False
        self.log("✅ pytest available")
        
        return True
    
    def run_syntax_validation(self) -> Dict[str, Any]:
        """Validate Python syntax in all source files."""
        self.log("🔍 Running syntax validation...")
        
        # Find all Python files
        python_files = []
        for pattern in ['backend/**/*.py', 'tests/**/*.py', 'scripts/**/*.py']:
            python_files.extend(self.project_root.glob(pattern))
        
        syntax_errors = []
        for py_file in python_files:
            try:
                with open(py_file, 'r') as f:
                    compile(f.read(), str(py_file), 'exec')
            except SyntaxError as e:
                syntax_errors.append(f"{py_file}: {e}")
        
        if syntax_errors:
            self.log(f"❌ Syntax errors found: {len(syntax_errors)}", "ERROR")
            for error in syntax_errors:
                self.log(f"  {error}", "ERROR")
            return {"success": False, "errors": syntax_errors}
        else:
            self.log(f"✅ Syntax validation passed for {len(python_files)} files")
            return {"success": True, "files_checked": len(python_files)}
    
    def run_unit_tests(self) -> Dict[str, Any]:
        """Run unit tests with pytest."""
        self.log("🧪 Running unit tests...")
        
        command = "python -m pytest tests/unit/ -v --tb=short -x --json-report --json-report-file=test-results/unit-results.json"
        result = self.run_command(command)
        
        # Parse JSON results if available
        json_file = self.project_root / "test-results" / "unit-results.json"
        if json_file.exists():
            try:
                with open(json_file, 'r') as f:
                    test_data = json.load(f)
                result["test_summary"] = test_data.get("summary", {})
            except Exception as e:
                self.log(f"Failed to parse unit test results: {e}", "WARNING")
        
        if result["success"]:
            self.log("✅ Unit tests passed")
        else:
            self.log("❌ Unit tests failed", "ERROR")
            
        return result
    
    def run_integration_tests(self) -> Dict[str, Any]:
        """Run integration tests with pytest."""
        self.log("🔗 Running integration tests...")
        
        command = "python -m pytest tests/integration/ -v --tb=short -x --json-report --json-report-file=test-results/integration-results.json"
        result = self.run_command(command)
        
        # Parse JSON results if available
        json_file = self.project_root / "test-results" / "integration-results.json"
        if json_file.exists():
            try:
                with open(json_file, 'r') as f:
                    test_data = json.load(f)
                result["test_summary"] = test_data.get("summary", {})
            except Exception as e:
                self.log(f"Failed to parse integration test results: {e}", "WARNING")
        
        if result["success"]:
            self.log("✅ Integration tests passed")
        else:
            self.log("⚠️ Integration tests failed (may be expected due to external dependencies)", "WARNING")
            
        return result
    
    def run_system_tests(self) -> Dict[str, Any]:
        """Run system tests with pytest."""
        self.log("🏗️ Running system tests...")
        
        command = "python -m pytest tests/system/ -v --tb=short -x --json-report --json-report-file=test-results/system-results.json"
        result = self.run_command(command)
        
        # Parse JSON results if available
        json_file = self.project_root / "test-results" / "system-results.json"
        if json_file.exists():
            try:
                with open(json_file, 'r') as f:
                    test_data = json.load(f)
                result["test_summary"] = test_data.get("summary", {})
            except Exception as e:
                self.log(f"Failed to parse system test results: {e}", "WARNING")
        
        if result["success"]:
            self.log("✅ System tests passed")
        else:
            self.log("⚠️ System tests failed (may be expected due to external dependencies)", "WARNING")
            
        return result
    
    def run_react_tests(self) -> Dict[str, Any]:
        """Run React component tests."""
        self.log("⚛️ Running React component tests...")
        
        frontend_dir = self.project_root / "frontend"
        if not frontend_dir.exists():
            self.log("❌ Frontend directory not found", "ERROR")
            return {"success": False, "error": "Frontend directory not found"}
        
        # Check if npm is available
        npm_check = self.run_command("npm --version")
        if not npm_check["success"]:
            self.log("❌ npm not available, skipping React tests", "WARNING")
            return {"success": False, "error": "npm not available"}
        
        # Install dependencies if needed
        if not (frontend_dir / "node_modules").exists():
            self.log("Installing npm dependencies...")
            install_result = self.run_command("npm install", cwd=str(frontend_dir))
            if not install_result["success"]:
                self.log("❌ Failed to install npm dependencies", "ERROR")
                return {"success": False, "error": "npm install failed"}
        
        # Run tests
        command = "npm test -- --coverage --json --outputFile=../test-results/react-results.json --watchAll=false"
        result = self.run_command(command, cwd=str(frontend_dir))
        
        if result["success"]:
            self.log("✅ React tests passed")
        else:
            self.log("⚠️ React tests failed", "WARNING")
            
        return result
    
    def run_e2e_tests(self) -> Dict[str, Any]:
        """Run end-to-end tests with Playwright."""
        self.log("🎭 Running E2E tests...")
        
        # Check if playwright is available
        playwright_check = self.run_command("npx playwright --version")
        if not playwright_check["success"]:
            self.log("❌ Playwright not available, skipping E2E tests", "WARNING")
            return {"success": False, "error": "Playwright not available"}
        
        # Install browsers if needed
        self.log("Installing Playwright browsers...")
        install_result = self.run_command("npx playwright install")
        if not install_result["success"]:
            self.log("⚠️ Failed to install Playwright browsers", "WARNING")
        
        # Run E2E tests
        command = "npx playwright test --reporter=json --output-dir=test-results/e2e-results"
        result = self.run_command(command)
        
        if result["success"]:
            self.log("✅ E2E tests passed")
        else:
            self.log("⚠️ E2E tests failed (may be expected without running servers)", "WARNING")
            
        return result
    
    def run_legacy_tests(self) -> Dict[str, Any]:
        """Run existing legacy test scripts."""
        self.log("🔄 Running legacy test scripts...")
        
        legacy_tests = [
            "scripts/test_human_demo_suite.py",
            "scripts/test_edge_cases.py"
        ]
        
        results = {}
        for test_script in legacy_tests:
            if (self.project_root / test_script).exists():
                self.log(f"Running {test_script}...")
                result = self.run_command(f"python {test_script}")
                results[test_script] = result
                
                if result["success"]:
                    self.log(f"✅ {test_script} passed")
                else:
                    self.log(f"⚠️ {test_script} failed", "WARNING")
            else:
                self.log(f"❌ {test_script} not found", "WARNING")
        
        return {"tests": results, "success": any(r["success"] for r in results.values())}
    
    def generate_coverage_report(self) -> Dict[str, Any]:
        """Generate a coverage report for the backend."""
        self.log("📊 Generating coverage report...")
        
        command = "python -m pytest tests/ --cov=backend --cov-report=json --cov-report=term --cov-report=html:test-results/coverage-html"
        result = self.run_command(command)
        
        # Parse coverage JSON if available
        coverage_file = self.project_root / "coverage.json"
        if coverage_file.exists():
            try:
                with open(coverage_file, 'r') as f:
                    coverage_data = json.load(f)
                result["coverage_summary"] = coverage_data.get("totals", {})
                self.log(f"📊 Coverage: {coverage_data.get('totals', {}).get('percent_covered', 'N/A')}%")
            except Exception as e:
                self.log(f"Failed to parse coverage report: {e}", "WARNING")
        
        return result
    
    def save_results(self) -> None:
        """Save test results to file."""
        results_file = self.project_root / "test-results" / "comprehensive-results.json"
        results_file.parent.mkdir(exist_ok=True)
        
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        self.log(f"📄 Results saved to {results_file}")
    
    def print_summary(self) -> None:
        """Print a summary of all test results."""
        self.log("=" * 60)
        self.log("🎯 TEST EXECUTION SUMMARY")
        self.log("=" * 60)
        
        summary = self.results["summary"]
        total_tests = summary["total_tests"]
        passed = summary["passed"]
        failed = summary["failed"]
        skipped = summary["skipped"]
        
        self.log(f"📊 Total Tests: {total_tests}")
        self.log(f"✅ Passed: {passed}")
        self.log(f"❌ Failed: {failed}")
        self.log(f"⏭️ Skipped: {skipped}")
        self.log(f"⏱️ Total Duration: {self.results['total_duration']:.2f} seconds")
        
        success_rate = (passed / total_tests * 100) if total_tests > 0 else 0
        self.log(f"📈 Success Rate: {success_rate:.1f}%")
        
        # Show test suite results
        for suite_name, suite_result in self.results["test_suites"].items():
            status = "✅" if suite_result.get("success", False) else "❌"
            duration = suite_result.get("duration", 0)
            self.log(f"{status} {suite_name}: {duration:.2f}s")
    
    def run_all_tests(self) -> None:
        """Run all test suites."""
        start_time = time.time()
        
        self.log("🚀 Starting comprehensive test execution...")
        self.log("=" * 60)
        
        # Create results directory
        results_dir = self.project_root / "test-results"
        results_dir.mkdir(exist_ok=True)
        
        # Check environment
        if not self.check_environment():
            self.log("❌ Environment check failed, aborting tests", "ERROR")
            return
        
        # Run all test suites
        test_suites = [
            ("syntax_validation", self.run_syntax_validation),
            ("unit_tests", self.run_unit_tests),
            ("integration_tests", self.run_integration_tests),
            ("system_tests", self.run_system_tests),
            ("react_tests", self.run_react_tests),
            ("e2e_tests", self.run_e2e_tests),
            ("legacy_tests", self.run_legacy_tests),
            ("coverage_report", self.generate_coverage_report)
        ]
        
        for suite_name, suite_func in test_suites:
            self.log("-" * 60)
            try:
                result = suite_func()
                self.results["test_suites"][suite_name] = result
                
                # Update summary statistics
                if "test_summary" in result:
                    test_summary = result["test_summary"]
                    self.results["summary"]["total_tests"] += test_summary.get("total", 0)
                    self.results["summary"]["passed"] += test_summary.get("passed", 0)
                    self.results["summary"]["failed"] += test_summary.get("failed", 0)
                    self.results["summary"]["skipped"] += test_summary.get("skipped", 0)
                    
            except Exception as e:
                self.log(f"❌ Error running {suite_name}: {e}", "ERROR")
                self.results["test_suites"][suite_name] = {
                    "success": False,
                    "error": str(e),
                    "duration": 0
                }
        
        # Calculate total duration
        self.results["total_duration"] = time.time() - start_time
        
        # Save results and print summary
        self.save_results()
        self.print_summary()
        
        self.log("🏁 Comprehensive test execution completed!")


def main():
    """Main entry point."""
    runner = TestRunner()
    
    try:
        runner.run_all_tests()
    except KeyboardInterrupt:
        runner.log("⚠️ Test execution interrupted by user", "WARNING")
        sys.exit(1)
    except Exception as e:
        runner.log(f"❌ Unexpected error: {e}", "ERROR")
        sys.exit(1)


if __name__ == "__main__":
    main()