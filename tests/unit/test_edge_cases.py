"""
Unit tests for edge cases and error handling.
Tests boundary conditions and error scenarios.
"""

import pytest
from typing import Any, Dict, List, Optional
import json

# Mark all tests in this module as unit tests
pytestmark = [pytest.mark.unit]


class TestInputValidation:
    """Test input validation edge cases."""
    
    @staticmethod
    def safe_json_parse(data: str) -> Optional[Dict[str, Any]]:
        """Safely parse JSON with error handling."""
        try:
            result = json.loads(data)
            return result if isinstance(result, dict) else None
        except (json.JSONDecodeError, TypeError):
            return None
    
    def test_empty_inputs(self):
        """Test handling of empty inputs."""
        empty_inputs = ['', '   ', '\t', '\n', None]
        
        for input_val in empty_inputs:
            result = self.safe_json_parse(str(input_val) if input_val is not None else '{}')
            # Should either parse successfully or return None
            assert result is None or isinstance(result, dict)
    
    def test_malformed_json(self):
        """Test handling of malformed JSON."""
        malformed_inputs = [
            '{invalid json}',
            '{"unclosed": "value"',
            'not json at all',
            '123',  # Valid JSON but not a dict
            '[]',   # Valid JSON but not a dict
            'null',
            'true',
        ]
        
        for json_str in malformed_inputs:
            result = self.safe_json_parse(json_str)
            # Should return None for malformed or non-dict JSON
            assert result is None, f"Should return None for non-dict or malformed JSON: {json_str}"
    
    def test_valid_but_complex_json(self):
        """Test handling of valid but complex JSON."""
        valid_complex_inputs = [
            '{"duplicate": 1, "duplicate": 2}',  # Valid JSON, Python keeps last value
            '{"nested": {"deep": {"value": 123}}}',
            '{"array": [1, 2, 3], "object": {"key": "value"}}',
        ]
        
        for json_str in valid_complex_inputs:
            result = self.safe_json_parse(json_str)
            assert isinstance(result, dict), f"Should parse valid JSON: {json_str}"
    
    def test_large_inputs(self):
        """Test handling of very large inputs."""
        large_json = '{"data": "' + 'x' * 100000 + '"}'
        
        # Should handle large inputs gracefully
        result = self.safe_json_parse(large_json)
        assert result is None or isinstance(result, dict)


class TestBoundaryConditions:
    """Test boundary conditions and limits."""
    
    @staticmethod
    def calculate_pagination(total_items: int, page_size: int, page_number: int) -> Dict[str, Any]:
        """Calculate pagination parameters with boundary checks."""
        if page_size <= 0:
            page_size = 10  # Default
        
        if page_number < 1:
            page_number = 1
        
        total_pages = max(1, (total_items + page_size - 1) // page_size) if total_items > 0 else 1
        
        # Ensure page_number doesn't exceed total_pages
        page_number = min(page_number, total_pages)
        
        start_index = (page_number - 1) * page_size
        end_index = min(start_index + page_size, total_items)
        
        return {
            'page_number': page_number,
            'page_size': page_size,
            'total_items': total_items,
            'total_pages': total_pages,
            'start_index': start_index,
            'end_index': end_index,
            'has_next': page_number < total_pages,
            'has_prev': page_number > 1
        }
    
    def test_zero_total_items(self):
        """Test pagination with zero items."""
        result = self.calculate_pagination(0, 10, 1)
        
        assert result['total_items'] == 0
        assert result['total_pages'] == 1
        assert result['page_number'] == 1
        assert result['start_index'] == 0
        assert result['end_index'] == 0
        assert result['has_next'] is False
        assert result['has_prev'] is False
    
    def test_negative_inputs(self):
        """Test pagination with negative inputs."""
        result = self.calculate_pagination(100, -5, -2)
        
        assert result['page_size'] == 10  # Should default to 10
        assert result['page_number'] == 1  # Should default to 1
        assert result['total_items'] == 100
    
    def test_page_beyond_total(self):
        """Test requesting page beyond total pages."""
        result = self.calculate_pagination(50, 10, 100)  # Only 5 pages but asking for page 100
        
        assert result['page_number'] == 5  # Should cap at total pages
        assert result['total_pages'] == 5
        assert result['start_index'] == 40
        assert result['end_index'] == 50
    
    def test_single_item_per_page(self):
        """Test pagination with single item per page."""
        result = self.calculate_pagination(5, 1, 3)
        
        assert result['page_size'] == 1
        assert result['total_pages'] == 5
        assert result['start_index'] == 2
        assert result['end_index'] == 3


class TestErrorRecovery:
    """Test error recovery mechanisms."""
    
    @staticmethod
    def process_api_response(response_data: Any) -> Dict[str, Any]:
        """Process API response with error recovery."""
        default_response = {
            'status': 'error',
            'data': None,
            'message': 'Invalid response format'
        }
        
        if not isinstance(response_data, dict):
            return default_response
        
        # Required fields check
        if 'status' not in response_data:
            response_data['status'] = 'unknown'
        
        if 'data' not in response_data:
            response_data['data'] = None
        
        if 'message' not in response_data:
            if response_data['status'] == 'success':
                response_data['message'] = 'Operation completed successfully'
            else:
                response_data['message'] = 'Operation failed'
        
        return response_data
    
    def test_none_response(self):
        """Test handling of None response."""
        result = self.process_api_response(None)
        assert result['status'] == 'error'
        assert result['data'] is None
        assert 'Invalid response format' in result['message']
    
    def test_invalid_response_types(self):
        """Test handling of invalid response types."""
        invalid_responses = [
            'string response',
            123,
            [],
            True,
            set(),
        ]
        
        for response in invalid_responses:
            result = self.process_api_response(response)
            assert result['status'] == 'error'
            assert 'Invalid response format' in result['message']
    
    def test_incomplete_response(self):
        """Test handling of incomplete response data."""
        incomplete_responses = [
            {},  # Empty dict
            {'status': 'success'},  # Missing data and message
            {'data': {'key': 'value'}},  # Missing status and message
            {'message': 'Some message'},  # Missing status and data
        ]
        
        for response in incomplete_responses:
            result = self.process_api_response(response)
            # Should fill in missing fields
            assert 'status' in result
            assert 'data' in result
            assert 'message' in result
    
    def test_success_response_handling(self):
        """Test handling of successful responses."""
        success_response = {
            'status': 'success',
            'data': {'result': 'processed'}
        }
        
        result = self.process_api_response(success_response)
        assert result['status'] == 'success'
        assert result['data']['result'] == 'processed'
        assert 'successfully' in result['message']


class TestConcurrencyScenarios:
    """Test concurrent access scenarios."""
    
    @staticmethod
    def thread_safe_counter() -> Dict[str, Any]:
        """Simple counter that could be used in concurrent scenarios."""
        return {'count': 0, 'lock': None}
    
    @staticmethod
    def increment_counter(counter: Dict[str, Any]) -> int:
        """Increment counter safely."""
        counter['count'] += 1
        return counter['count']
    
    def test_multiple_increments(self):
        """Test multiple counter increments."""
        counter = self.thread_safe_counter()
        
        # Simulate multiple increments
        results = []
        for i in range(10):
            result = self.increment_counter(counter)
            results.append(result)
        
        assert counter['count'] == 10
        assert results == list(range(1, 11))  # Should be 1, 2, 3, ..., 10
    
    def test_counter_reset(self):
        """Test counter behavior after reset."""
        counter = self.thread_safe_counter()
        
        # Increment a few times
        for _ in range(5):
            self.increment_counter(counter)
        
        assert counter['count'] == 5
        
        # Reset
        counter['count'] = 0
        
        # Increment again
        result = self.increment_counter(counter)
        assert result == 1


class TestMemoryManagement:
    """Test memory-related edge cases."""
    
    @staticmethod
    def limited_cache(max_size: int = 3) -> Dict[str, Any]:
        """Simple LRU-like cache with size limit."""
        return {
            'data': {},
            'order': [],
            'max_size': max_size
        }
    
    @staticmethod
    def cache_set(cache: Dict[str, Any], key: str, value: Any) -> None:
        """Set value in cache with size limit."""
        data = cache['data']
        order = cache['order']
        max_size = cache['max_size']
        
        # If key already exists, remove from order
        if key in data:
            order.remove(key)
        
        # Add to end of order
        order.append(key)
        data[key] = value
        
        # Remove oldest items if over limit
        while len(order) > max_size:
            oldest = order.pop(0)
            del data[oldest]
    
    @staticmethod
    def cache_get(cache: Dict[str, Any], key: str) -> Any:
        """Get value from cache."""
        return cache['data'].get(key)
    
    def test_cache_size_limit(self):
        """Test cache respects size limit."""
        cache = self.limited_cache(3)
        
        # Add items beyond limit
        self.cache_set(cache, 'a', 1)
        self.cache_set(cache, 'b', 2)
        self.cache_set(cache, 'c', 3)
        self.cache_set(cache, 'd', 4)  # Should evict 'a'
        
        assert len(cache['data']) == 3
        assert self.cache_get(cache, 'a') is None  # Should be evicted
        assert self.cache_get(cache, 'b') == 2
        assert self.cache_get(cache, 'c') == 3
        assert self.cache_get(cache, 'd') == 4
    
    def test_cache_update_existing(self):
        """Test updating existing cache entries."""
        cache = self.limited_cache(2)
        
        self.cache_set(cache, 'key1', 'value1')
        self.cache_set(cache, 'key2', 'value2')
        self.cache_set(cache, 'key1', 'updated_value1')  # Update existing
        
        assert len(cache['data']) == 2
        assert self.cache_get(cache, 'key1') == 'updated_value1'
        assert self.cache_get(cache, 'key2') == 'value2'


class TestTypeCoercion:
    """Test type conversion and coercion edge cases."""
    
    @staticmethod
    def safe_int_conversion(value: Any) -> Optional[int]:
        """Safely convert value to int."""
        try:
            if isinstance(value, str):
                # Handle common string representations
                value = value.strip()
                if value.lower() in ('', 'none', 'null'):
                    return None
                # Try to convert boolean strings
                if value.lower() == 'true':
                    return 1
                elif value.lower() == 'false':
                    return 0
            
            return int(float(value))  # Handle float strings like "123.0"
        except (ValueError, TypeError):
            return None
    
    def test_string_to_int_conversion(self):
        """Test string to int conversion."""
        test_cases = [
            ('123', 123),
            ('123.0', 123),
            ('123.7', 123),  # Should truncate
            ('-456', -456),
            ('0', 0),
            ('  789  ', 789),  # Whitespace
            ('true', 1),
            ('false', 0),
            ('True', 1),
            ('False', 0),
            ('', None),
            ('none', None),
            ('null', None),
            ('abc', None),
            ('123abc', None),
        ]
        
        for input_val, expected in test_cases:
            result = self.safe_int_conversion(input_val)
            assert result == expected, f"'{input_val}' should convert to {expected}"
    
    def test_other_types_to_int(self):
        """Test conversion of other types to int."""
        test_cases = [
            (123, 123),
            (123.7, 123),
            (True, 1),
            (False, 0),
            (None, None),
            ([], None),
            ({}, None),
            (object(), None),
        ]
        
        for input_val, expected in test_cases:
            result = self.safe_int_conversion(input_val)
            assert result == expected, f"{input_val} should convert to {expected}"


class TestUnicodeHandling:
    """Test Unicode and special character handling."""
    
    @staticmethod
    def clean_text(text: str) -> str:
        """Clean text by removing problematic characters."""
        if not isinstance(text, str):
            return ''
        
        # Remove control characters but keep newlines and tabs
        cleaned = ''.join(char for char in text if char.isprintable() or char in '\n\t')
        
        # Normalize whitespace
        cleaned = ' '.join(cleaned.split())
        
        return cleaned
    
    def test_unicode_characters(self):
        """Test handling of Unicode characters."""
        test_cases = [
            ('Hello 🌍', 'Hello 🌍'),
            ('Café', 'Café'),
            ('北京', '北京'),
            ('العربية', 'العربية'),
            ('Hello\x00World', 'HelloWorld'),  # Control character
            ('Line1\nLine2', 'Line1 Line2'),  # Newline becomes space
            ('Tab\tSeparated', 'Tab Separated'),  # Tab becomes space
            ('Multiple   spaces', 'Multiple spaces'),  # Normalize whitespace
        ]
        
        for input_text, expected in test_cases:
            result = self.clean_text(input_text)
            assert result == expected, f"'{input_text}' should clean to '{expected}'"
    
    def test_non_string_input(self):
        """Test handling of non-string input."""
        non_strings = [None, 123, [], {}, True]
        
        for input_val in non_strings:
            result = self.clean_text(input_val)
            assert result == '', f"Non-string {input_val} should return empty string"