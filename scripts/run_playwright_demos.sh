#!/bin/bash

# Playwright Demo Test Runner
# Runs comprehensive demo tests for the agent deployment system

set -e

echo "🎭 PLAYWRIGHT DEMO TEST EXECUTION"
echo "================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
print_status "Checking prerequisites..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    print_error "Node.js not found. Please install Node.js to run Playwright tests."
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    print_error "npm not found. Please install npm to run Playwright tests."
    exit 1
fi

print_success "Node.js and npm are available"

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ ! -d "node_modules/.bin/playwright" ]; then
    print_status "Installing Node.js dependencies..."
    npm install
    
    print_status "Installing Playwright browsers..."
    npx playwright install
    
    print_success "Dependencies installed"
else
    print_success "Dependencies already installed"
fi

# Ensure frontend dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
    print_status "Installing frontend dependencies..."
    cd frontend
    npm install --legacy-peer-deps
    cd ..
    print_success "Frontend dependencies installed"
fi

# Create results directory
mkdir -p test-results/playwright

print_status "Starting demo test execution..."
echo ""

# Test configuration
BROWSER_CONFIGS=("chromium" "firefox" "webkit")
SELECTED_BROWSER=${1:-"chromium"}

# Validate browser selection
if [[ ! " ${BROWSER_CONFIGS[@]} " =~ " ${SELECTED_BROWSER} " ]]; then
    print_warning "Unknown browser '${SELECTED_BROWSER}'. Using chromium instead."
    SELECTED_BROWSER="chromium"
fi

print_status "Running tests with ${SELECTED_BROWSER} browser..."

# Function to run a specific test suite
run_test_suite() {
    local test_file="$1"
    local description="$2"
    local start_time=$(date +%s)
    
    echo ""
    print_status "🧪 Running ${description}..."
    echo "   Test file: ${test_file}"
    
    # Run the test with detailed output
    if npx playwright test "${test_file}" \
        --project="${SELECTED_BROWSER}" \
        --reporter=list; then
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        print_success "${description} completed in ${duration}s"
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        print_error "${description} failed after ${duration}s"
        return 1
    fi
}

# Demo test suites
TEST_SUITES=(
    "tests/e2e/demo-agent-deployment.spec.ts:Agent Deployment Demo"
    "tests/e2e/integration-demo-calls.spec.ts:Call Handling Integration Demo"
    "tests/e2e/test_agent_workflows.spec.ts:Agent Management Workflows"
)

# Track test results
TOTAL_TESTS=${#TEST_SUITES[@]}
PASSED_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

echo ""
print_status "Executing ${TOTAL_TESTS} demo test suites..."

# Run each test suite
for suite_info in "${TEST_SUITES[@]}"; do
    IFS=':' read -r test_file description <<< "$suite_info"
    
    if run_test_suite "$test_file" "$description"; then
        ((PASSED_TESTS++))
    else
        ((FAILED_TESTS++))
    fi
done

# Calculate total execution time
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo ""
echo "🎯 DEMO TEST EXECUTION SUMMARY"
echo "=============================="
print_status "Browser: ${SELECTED_BROWSER}"
print_status "Total Duration: ${TOTAL_DURATION}s"
print_status "Test Suites: ${TOTAL_TESTS}"
print_success "Passed: ${PASSED_TESTS}"

if [ $FAILED_TESTS -gt 0 ]; then
    print_error "Failed: ${FAILED_TESTS}"
else
    print_success "Failed: ${FAILED_TESTS}"
fi

# Calculate success rate
SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
print_status "Success Rate: ${SUCCESS_RATE}%"

echo ""

# Generate HTML report
if [ -f "playwright-report/index.html" ]; then
    print_success "📊 HTML Report generated: playwright-report/index.html"
    echo ""
    print_status "To view the report, run:"
    echo "   npx playwright show-report"
    echo ""
fi

# Additional demo instructions
echo "🚀 DEMO SCENARIOS COVERED"
echo "========================="
echo ""
echo "✅ Agent Management:"
echo "   - Complete agent creation workflow"
echo "   - Phone number assignment"
echo "   - Multi-agent enterprise setup"
echo "   - Agent performance analytics"
echo ""
echo "✅ Call Handling:"
echo "   - Inbound call lifecycle"
echo "   - Outbound call initiation"
echo "   - Real-time context editing"
echo "   - Supervisor override controls"
echo ""
echo "✅ System Integration:"
echo "   - Multi-channel call management"
echo "   - Real-time analytics dashboard"
echo "   - Performance comparison"
echo "   - Error handling scenarios"
echo ""
echo "✅ User Experience:"
echo "   - Accessibility testing"
echo "   - Keyboard navigation"
echo "   - Large dataset handling"
echo "   - Responsive design"
echo ""

# Demo execution commands
echo "📋 MANUAL DEMO COMMANDS"
echo "======================="
echo ""
echo "Run specific demo scenarios:"
echo ""
echo "# Agent deployment demo"
echo "npx playwright test tests/e2e/demo-agent-deployment.spec.ts --headed"
echo ""
echo "# Call handling integration demo"
echo "npx playwright test tests/e2e/integration-demo-calls.spec.ts --headed"
echo ""
echo "# Complete workflow demo"
echo "npx playwright test tests/e2e/test_agent_workflows.spec.ts --headed"
echo ""
echo "# Debug mode (with browser dev tools)"
echo "npx playwright test --debug"
echo ""

# Exit with appropriate status
if [ $FAILED_TESTS -gt 0 ]; then
    print_error "Demo execution completed with failures"
    exit 1
else
    print_success "All demo tests executed successfully! 🎉"
    exit 0
fi