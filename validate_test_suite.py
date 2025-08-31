#!/usr/bin/env python3
"""
Validate the test suite structure and syntax.
This ensures all test files are properly written and follow best practices.
"""
import os
import sys
import ast
import re
from pathlib import Path

def validate_python_syntax(file_path):
    """Validate Python syntax for a file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        ast.parse(content)
        return True, None
    except SyntaxError as e:
        return False, f"Syntax error: {e}"
    except Exception as e:
        return False, f"Error parsing file: {e}"

def analyze_test_file(file_path):
    """Analyze a test file for best practices."""
    issues = []
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check for test function naming
    test_functions = re.findall(r'^def (test_\w+)', content, re.MULTILINE)
    async_test_functions = re.findall(r'^async def (test_\w+)', content, re.MULTILINE)
    
    if not test_functions and not async_test_functions:
        issues.append("No test functions found (should start with 'test_')")
    
    # Check for docstrings
    functions_with_docstrings = re.findall(r'def test_\w+.*?:\s*""".*?"""', content, re.DOTALL)
    async_functions_with_docstrings = re.findall(r'async def test_\w+.*?:\s*""".*?"""', content, re.DOTALL)
    
    total_test_functions = len(test_functions) + len(async_test_functions)
    total_with_docstrings = len(functions_with_docstrings) + len(async_functions_with_docstrings)
    
    if total_test_functions > 0 and total_with_docstrings / total_test_functions < 0.8:
        issues.append(f"Only {total_with_docstrings}/{total_test_functions} test functions have docstrings")
    
    # Check for proper imports
    if 'import pytest' in content and 'from unittest.mock import' not in content:
        if 'Mock' in content or 'patch' in content or 'AsyncMock' in content:
            issues.append("Uses mocking but doesn't import from unittest.mock")
    
    # Check for async test marking
    if async_test_functions and '@pytest.mark.asyncio' not in content:
        issues.append("Has async test functions but no @pytest.mark.asyncio decorator")
    
    return issues

def validate_test_structure():
    """Validate overall test directory structure."""
    print("Validating test suite structure...")
    
    test_dir = Path('tests')
    if not test_dir.exists():
        print("✗ tests/ directory not found")
        return False
    
    # Check for required directories
    required_dirs = ['unit', 'integration', 'system']
    for dir_name in required_dirs:
        dir_path = test_dir / dir_name
        if not dir_path.exists():
            print(f"✗ {dir_name}/ directory missing")
            return False
        
        # Check for test files in directory
        test_files = list(dir_path.glob('test_*.py'))
        if not test_files:
            print(f"✗ No test files found in {dir_name}/")
            return False
        
        print(f"✓ {dir_name}/ contains {len(test_files)} test files")
    
    # Check for conftest.py
    if not (test_dir / 'conftest.py').exists():
        print("✗ conftest.py not found")
        return False
    
    print("✓ conftest.py found")
    
    # Check for __init__.py
    if not (test_dir / '__init__.py').exists():
        print("✗ __init__.py not found")
        return False
    
    print("✓ __init__.py found")
    
    return True

def main():
    """Main validation function."""
    print("🔍 Validating Test Suite for Phony Voice AI Agent\n")
    
    # Validate structure
    if not validate_test_structure():
        print("\n❌ Test structure validation failed")
        return 1
    
    print("\n🔎 Validating individual test files...\n")
    
    # Find all test files
    test_files = []
    for root, dirs, files in os.walk('tests'):
        for file in files:
            if file.endswith('.py') and (file.startswith('test_') or file in ['conftest.py', '__init__.py']):
                test_files.append(os.path.join(root, file))
    
    syntax_errors = 0
    analysis_issues = 0
    
    for test_file in sorted(test_files):
        print(f"Checking {test_file}...")
        
        # Validate syntax
        syntax_ok, syntax_error = validate_python_syntax(test_file)
        if not syntax_ok:
            print(f"  ✗ Syntax error: {syntax_error}")
            syntax_errors += 1
            continue
        else:
            print(f"  ✓ Syntax OK")
        
        # Analyze test patterns (only for actual test files)
        if os.path.basename(test_file).startswith('test_'):
            issues = analyze_test_file(test_file)
            if issues:
                for issue in issues:
                    print(f"  ⚠ {issue}")
                analysis_issues += len(issues)
            else:
                print(f"  ✓ Test patterns OK")
        
        print()
    
    # Count test functions
    total_test_functions = 0
    for test_file in test_files:
        if os.path.basename(test_file).startswith('test_'):
            with open(test_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            test_funcs = len(re.findall(r'^def test_\w+', content, re.MULTILINE))
            async_test_funcs = len(re.findall(r'^async def test_\w+', content, re.MULTILINE))
            total_test_functions += test_funcs + async_test_funcs
    
    print("📊 Test Suite Validation Summary:")
    print(f"📁 Test files found: {len([f for f in test_files if os.path.basename(f).startswith('test_')])}")
    print(f"🧪 Total test functions: {total_test_functions}")
    print(f"✗ Syntax errors: {syntax_errors}")
    print(f"⚠ Analysis issues: {analysis_issues}")
    
    if syntax_errors == 0:
        print("\n🎉 All test files have valid Python syntax!")
    else:
        print(f"\n❌ {syntax_errors} files have syntax errors")
    
    if analysis_issues == 0:
        print("✅ All test files follow best practices!")
    else:
        print(f"⚠️  {analysis_issues} potential issues found (non-critical)")
    
    print(f"\n📈 Test Suite Quality Score: {((len(test_files) - syntax_errors) / len(test_files) * 100):.1f}%")
    
    if syntax_errors == 0:
        print("\n🚀 Test suite is ready for execution with pytest!")
        print("\nTo run tests (once dependencies are installed):")
        print("  pytest tests/unit/           # Run unit tests")
        print("  pytest tests/integration/    # Run integration tests") 
        print("  pytest tests/system/         # Run system tests")
        print("  pytest tests/                # Run all tests")
        return 0
    else:
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)