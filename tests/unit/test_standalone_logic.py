"""
Standalone unit tests that don't require external dependencies.
These tests focus on pure logic and data validation.
"""

import pytest
import re
from datetime import datetime, timezone
from typing import Dict, Any
import json

# Mark all tests in this module as unit tests
pytestmark = [pytest.mark.unit]


class TestPhoneNumberValidation:
    """Test phone number validation logic."""
    
    @staticmethod
    def validate_phone_number(phone: str) -> bool:
        """Validate phone number format."""
        # Simple phone validation - should match E.164 format
        pattern = r'^\+[1-9]\d{10,14}$'
        return bool(re.match(pattern, phone))
    
    def test_valid_phone_numbers(self):
        """Test valid phone number formats."""
        valid_numbers = [
            '+15551234567',
            '+14155552671',
            '+442071234567',
            '+819012345678'
        ]
        
        for number in valid_numbers:
            assert self.validate_phone_number(number), f"Should be valid: {number}"
    
    def test_invalid_phone_numbers(self):
        """Test invalid phone number formats."""
        invalid_numbers = [
            '5551234567',      # Missing +
            '+0551234567',     # Starts with 0
            '+1555',           # Too short
            '+1555123456789012345',  # Too long
            '+1-555-123-4567', # Contains dashes
            '+1 555 123 4567', # Contains spaces
            'abc',             # Not numeric
            '',                # Empty
            '+1',              # Only country code
        ]
        
        for number in invalid_numbers:
            assert not self.validate_phone_number(number), f"Should be invalid: {number}"


class TestAgentConfiguration:
    """Test agent configuration validation."""
    
    @staticmethod
    def validate_agent_config(config: Dict[str, Any]) -> tuple[bool, str]:
        """Validate agent configuration."""
        required_fields = ['name', 'type', 'system_prompt', 'voice']
        
        # Check required fields
        for field in required_fields:
            if field not in config:
                return False, f"Missing required field: {field}"
            if not config[field]:
                return False, f"Empty value for required field: {field}"
        
        # Validate type
        if config['type'] not in ['inbound', 'outbound']:
            return False, f"Invalid agent type: {config['type']}"
        
        # Validate voice
        valid_voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
        if config['voice'] not in valid_voices:
            return False, f"Invalid voice: {config['voice']}"
        
        # Validate name length
        if len(config['name']) > 100:
            return False, "Agent name too long (max 100 characters)"
        
        # Validate system prompt length
        if len(config['system_prompt']) > 2000:
            return False, "System prompt too long (max 2000 characters)"
        
        return True, "Valid configuration"
    
    def test_valid_agent_config(self):
        """Test valid agent configuration."""
        valid_config = {
            'name': 'Customer Service Agent',
            'type': 'inbound',
            'system_prompt': 'You are a helpful customer service representative.',
            'voice': 'alloy',
            'context_data': {'department': 'support'}
        }
        
        is_valid, message = self.validate_agent_config(valid_config)
        assert is_valid, f"Should be valid: {message}"
    
    def test_missing_required_fields(self):
        """Test missing required fields."""
        configs_with_missing_fields = [
            {},  # Empty config
            {'name': 'Test'},  # Missing other fields
            {'name': 'Test', 'type': 'inbound'},  # Missing system_prompt and voice
            {'name': 'Test', 'type': 'inbound', 'system_prompt': 'Test'},  # Missing voice
        ]
        
        for config in configs_with_missing_fields:
            is_valid, message = self.validate_agent_config(config)
            assert not is_valid, f"Should be invalid: {config}"
            assert "Missing required field" in message
    
    def test_invalid_agent_type(self):
        """Test invalid agent types."""
        config = {
            'name': 'Test Agent',
            'type': 'invalid_type',
            'system_prompt': 'Test prompt',
            'voice': 'alloy'
        }
        
        is_valid, message = self.validate_agent_config(config)
        assert not is_valid
        assert "Invalid agent type" in message
    
    def test_invalid_voice(self):
        """Test invalid voice selection."""
        config = {
            'name': 'Test Agent',
            'type': 'inbound',
            'system_prompt': 'Test prompt',
            'voice': 'invalid_voice'
        }
        
        is_valid, message = self.validate_agent_config(config)
        assert not is_valid
        assert "Invalid voice" in message
    
    def test_empty_required_fields(self):
        """Test empty required fields."""
        configs_with_empty_fields = [
            {'name': '', 'type': 'inbound', 'system_prompt': 'Test', 'voice': 'alloy'},
            {'name': 'Test', 'type': '', 'system_prompt': 'Test', 'voice': 'alloy'},
            {'name': 'Test', 'type': 'inbound', 'system_prompt': '', 'voice': 'alloy'},
            {'name': 'Test', 'type': 'inbound', 'system_prompt': 'Test', 'voice': ''},
        ]
        
        for config in configs_with_empty_fields:
            is_valid, message = self.validate_agent_config(config)
            assert not is_valid, f"Should be invalid: {config}"
            assert "Empty value for required field" in message


class TestContextDataProcessing:
    """Test context data processing logic."""
    
    @staticmethod
    def process_context_data(context: Dict[str, Any]) -> Dict[str, Any]:
        """Process and sanitize context data."""
        if not isinstance(context, dict):
            return {}
        
        processed = {}
        for key, value in context.items():
            # Sanitize key
            clean_key = re.sub(r'[^a-zA-Z0-9_]', '_', str(key))
            
            # Process value based on type
            if isinstance(value, str):
                processed[clean_key] = value.strip()[:500]  # Limit string length
            elif isinstance(value, (int, float, bool)):
                processed[clean_key] = value
            elif isinstance(value, (list, dict)):
                # Convert complex types to JSON string
                try:
                    processed[clean_key] = json.dumps(value)[:1000]
                except (TypeError, ValueError):
                    processed[clean_key] = str(value)[:500]
            else:
                processed[clean_key] = str(value)[:500]
        
        return processed
    
    def test_valid_context_processing(self):
        """Test processing of valid context data."""
        context = {
            'customer_name': 'John Doe',
            'priority': 'high',
            'account_id': 12345,
            'is_vip': True,
            'tags': ['support', 'billing'],
            'metadata': {'source': 'phone', 'agent_id': 'agent_1'}
        }
        
        processed = self.process_context_data(context)
        
        assert processed['customer_name'] == 'John Doe'
        assert processed['priority'] == 'high'
        assert processed['account_id'] == 12345
        assert processed['is_vip'] is True
        assert 'support' in processed['tags']
        assert 'source' in processed['metadata']
    
    def test_invalid_context_handling(self):
        """Test handling of invalid context data."""
        invalid_contexts = [
            None,
            'not a dict',
            123,
            []
        ]
        
        for context in invalid_contexts:
            processed = self.process_context_data(context)
            assert processed == {}, f"Should return empty dict for: {context}"
    
    def test_key_sanitization(self):
        """Test sanitization of context keys."""
        context = {
            'customer-name': 'John',
            'account.id': 123,
            'is vip': True,
            'tag#1': 'support'
        }
        
        processed = self.process_context_data(context)
        
        assert 'customer_name' in processed
        assert 'account_id' in processed
        assert 'is_vip' in processed
        assert 'tag_1' in processed
    
    def test_value_length_limits(self):
        """Test value length limitations."""
        long_string = 'a' * 1000
        context = {
            'long_value': long_string,
            'complex_data': {'nested': {'very': {'deep': long_string}}}
        }
        
        processed = self.process_context_data(context)
        
        assert len(processed['long_value']) == 500  # Truncated
        assert len(processed['complex_data']) <= 1000  # JSON truncated


class TestCallSessionLogic:
    """Test call session business logic."""
    
    @staticmethod
    def calculate_call_cost(duration_seconds: int, rate_per_minute: float = 0.013) -> float:
        """Calculate call cost based on duration."""
        if duration_seconds <= 0:
            return 0.0
        
        # Round up to next minute
        minutes = (duration_seconds + 59) // 60
        return round(minutes * rate_per_minute, 4)
    
    @staticmethod
    def determine_call_status(duration_seconds: int, has_transcript: bool) -> str:
        """Determine call status based on duration and transcript."""
        if duration_seconds == 0:
            return 'initiated'
        elif duration_seconds < 5:
            return 'failed'  # Likely failed if less than 5 seconds
        elif not has_transcript:
            return 'no_answer'
        else:
            return 'completed'
    
    def test_call_cost_calculation(self):
        """Test call cost calculation."""
        test_cases = [
            (0, 0.0),      # No duration
            (30, 0.013),   # 30 seconds = 1 minute
            (60, 0.013),   # 60 seconds = 1 minute
            (90, 0.026),   # 90 seconds = 2 minutes
            (120, 0.026),  # 120 seconds = 2 minutes
            (150, 0.039),  # 150 seconds = 3 minutes
        ]
        
        for duration, expected_cost in test_cases:
            cost = self.calculate_call_cost(duration)
            assert cost == expected_cost, f"Duration {duration}s should cost ${expected_cost}"
    
    def test_call_status_determination(self):
        """Test call status determination logic."""
        test_cases = [
            (0, False, 'initiated'),
            (3, False, 'failed'),
            (30, False, 'no_answer'),
            (30, True, 'completed'),
            (300, True, 'completed'),
        ]
        
        for duration, has_transcript, expected_status in test_cases:
            status = self.determine_call_status(duration, has_transcript)
            assert status == expected_status, f"Duration {duration}s, transcript {has_transcript} should be {expected_status}"


class TestDataSerialization:
    """Test data serialization and deserialization."""
    
    @staticmethod
    def serialize_datetime(dt: datetime) -> str:
        """Serialize datetime to ISO format."""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    
    @staticmethod
    def deserialize_datetime(dt_string: str) -> datetime:
        """Deserialize datetime from ISO format."""
        return datetime.fromisoformat(dt_string.replace('Z', '+00:00'))
    
    def test_datetime_serialization(self):
        """Test datetime serialization."""
        test_datetime = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        serialized = self.serialize_datetime(test_datetime)
        
        assert isinstance(serialized, str)
        assert '2024-01-01T12:00:00' in serialized
        assert '+00:00' in serialized or 'Z' in serialized
    
    def test_datetime_deserialization(self):
        """Test datetime deserialization."""
        test_cases = [
            '2024-01-01T12:00:00+00:00',
            '2024-01-01T12:00:00Z',
            '2024-01-01T12:00:00.123456+00:00',
        ]
        
        for dt_string in test_cases:
            deserialized = self.deserialize_datetime(dt_string)
            assert isinstance(deserialized, datetime)
            assert deserialized.year == 2024
            assert deserialized.month == 1
            assert deserialized.day == 1
    
    def test_datetime_roundtrip(self):
        """Test datetime serialization round-trip."""
        original = datetime(2024, 1, 1, 12, 30, 45, 123456, tzinfo=timezone.utc)
        serialized = self.serialize_datetime(original)
        deserialized = self.deserialize_datetime(serialized)
        
        # Should be very close (microseconds might be truncated)
        assert abs((deserialized - original).total_seconds()) < 1


class TestUtilityFunctions:
    """Test utility functions."""
    
    @staticmethod
    def format_duration(seconds: int) -> str:
        """Format duration in human-readable format."""
        if seconds < 60:
            return f"{seconds}s"
        elif seconds < 3600:
            minutes = seconds // 60
            remaining_seconds = seconds % 60
            if remaining_seconds == 0:
                return f"{minutes}m"
            return f"{minutes}m {remaining_seconds}s"
        else:
            hours = seconds // 3600
            remaining_seconds = seconds % 3600
            minutes = remaining_seconds // 60
            remaining_seconds = remaining_seconds % 60
            
            if minutes == 0 and remaining_seconds == 0:
                return f"{hours}h"
            elif remaining_seconds == 0:
                return f"{hours}h {minutes}m"
            elif minutes == 0:
                return f"{hours}h {remaining_seconds}s"
            else:
                return f"{hours}h {minutes}m {remaining_seconds}s"
    
    @staticmethod
    def sanitize_filename(filename: str) -> str:
        """Sanitize filename for safe filesystem usage."""
        # Replace invalid characters
        sanitized = re.sub(r'[<>:"/\\|?*]', '_', filename)
        # Remove leading/trailing whitespace and dots
        sanitized = sanitized.strip(' .')
        # Limit length
        return sanitized[:255]
    
    def test_duration_formatting(self):
        """Test duration formatting."""
        test_cases = [
            (30, '30s'),
            (60, '1m'),
            (90, '1m 30s'),
            (3600, '1h'),
            (3660, '1h 1m'),
            (7230, '2h 30s'),  # 7230 = 2*3600 + 30 = 2 hours 30 seconds
        ]
        
        for seconds, expected in test_cases:
            formatted = self.format_duration(seconds)
            assert formatted == expected, f"{seconds} seconds should format as '{expected}'"
    
    def test_filename_sanitization(self):
        """Test filename sanitization."""
        test_cases = [
            ('normal_file.txt', 'normal_file.txt'),
            ('file with spaces.txt', 'file with spaces.txt'),
            ('file<with>bad:chars.txt', 'file_with_bad_chars.txt'),
            ('file/with\\slashes.txt', 'file_with_slashes.txt'),
            ('  .file_with_dots.  ', 'file_with_dots'),
            ('a' * 300, 'a' * 255),  # Length limit
        ]
        
        for original, expected in test_cases:
            sanitized = self.sanitize_filename(original)
            assert sanitized == expected, f"'{original}' should sanitize to '{expected}'"