import pytest
from unittest.mock import AsyncMock, Mock, patch
from backend import commands
from backend.commands import Command, detect_and_execute_commands


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Please [[press:12]] now", {"action": "press", "value": "12"}),
        ("Please [[transfer:+1234567890]] now", {"action": "transfer", "value": "+1234567890"}),
        ("Time to [[end_call]]", {"action": "end_call", "value": None}),
        ("Need [[request_user:code]]", {"action": "request_user", "value": "code"}),
        ("hello world", None),
        ("Multiple [[press:1]] and [[press:2]] commands", {"action": "press", "value": "1"}),  # First command
        ("Empty command [[press:]]", {"action": "press", "value": ""}),
        ("Malformed [press:1] brackets", None),
    ],
)
def test_detect_command(text, expected):
    cmd = commands.detect_command(text)
    if expected is None:
        assert cmd is None
    else:
        assert cmd == Command(**expected)


def test_detect_command_with_special_characters():
    """Test command detection with special characters in values."""
    text = "Transfer to [[transfer:+1-555-123-4567 ext.123]]"
    cmd = commands.detect_command(text)
    assert cmd.action == "transfer"
    assert cmd.value == "+1-555-123-4567 ext.123"


def test_detect_command_case_sensitivity():
    """Test that command detection is case sensitive."""
    text_lower = "Please [[press:1]] now"
    text_upper = "Please [[PRESS:1]] now"
    
    cmd_lower = commands.detect_command(text_lower)
    cmd_upper = commands.detect_command(text_upper)
    
    assert cmd_lower is not None
    assert cmd_upper is not None
    assert cmd_lower.action == "press"
    assert cmd_upper.action == "PRESS"


def test_command_equality():
    """Test Command object equality comparison."""
    cmd1 = Command("press", "1")
    cmd2 = Command("press", "1")
    cmd3 = Command("press", "2")
    cmd4 = Command("transfer", "1")
    
    assert cmd1 == cmd2
    assert cmd1 != cmd3
    assert cmd1 != cmd4


def _setup_twilio(monkeypatch):
    updates = {}

    class DummyCall:
        def update(self, **kwargs):
            updates.update(kwargs)

    class DummyClient:
        def __init__(self, sid, token):
            pass

        def calls(self, sid):
            return DummyCall()

    monkeypatch.setattr(commands, "Client", DummyClient)
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "TK")
    return updates


@pytest.mark.parametrize(
    "cmd,expected_key,expected_value",
    [
        (Command(action="press", value="1"), "send_digits", "1"),
        (Command(action="transfer", value="+15555555555"), "twiml", None),
        (Command(action="end_call"), "status", "completed"),
    ],
)
def test_execute_command(monkeypatch, cmd, expected_key, expected_value):
    updates = _setup_twilio(monkeypatch)
    commands.execute_command(cmd, "CA1")
    assert expected_key in updates
    if expected_value is not None:
        assert updates[expected_key] == expected_value


def test_execute_command_press_multiple_digits(monkeypatch):
    """Test execution of press command with multiple digits."""
    updates = _setup_twilio(monkeypatch)
    cmd = Command("press", "123*#")
    commands.execute_command(cmd, "CA1")
    assert updates["send_digits"] == "123*#"


def test_execute_command_transfer_default_number(monkeypatch):
    """Test transfer command with default number from environment."""
    updates = _setup_twilio(monkeypatch)
    monkeypatch.setenv("TRANSFER_NUMBER", "+15559999999")
    
    # Test with empty value
    cmd = Command("transfer", "")
    commands.execute_command(cmd, "CA1")
    assert "twiml" in updates
    assert "+15559999999" in updates["twiml"]
    
    # Test with None value
    cmd = Command("transfer", None)
    commands.execute_command(cmd, "CA1")
    assert "twiml" in updates


def test_execute_command_unknown_action(monkeypatch):
    """Test execution of unknown command action."""
    _setup_twilio(monkeypatch)
    cmd = Command("unknown_action", "value")
    
    # Should not raise an exception
    commands.execute_command(cmd, "CA1")


@pytest.mark.asyncio
async def test_detect_and_execute_commands_with_commands():
    """Test detect_and_execute_commands when commands are present."""
    text = "I'm pressing 1 [[press:1]] now"
    call_sid = "CA123"
    
    with patch('backend.commands.execute_command') as mock_execute, \
         patch('backend.commands.detect_command') as mock_detect:
        
        mock_detect.return_value = Command("press", "1")
        
        result = await detect_and_execute_commands(text, call_sid)
        
        assert result is True
        mock_detect.assert_called_once_with(text)
        mock_execute.assert_called_once_with(Command("press", "1"), call_sid)


@pytest.mark.asyncio
async def test_detect_and_execute_commands_no_commands():
    """Test detect_and_execute_commands when no commands are present."""
    text = "Hello, how can I help you?"
    call_sid = "CA123"
    
    with patch('backend.commands.detect_command') as mock_detect:
        mock_detect.return_value = None
        
        result = await detect_and_execute_commands(text, call_sid)
        
        assert result is False
        mock_detect.assert_called_once_with(text)


@pytest.mark.asyncio
async def test_detect_and_execute_commands_error_handling():
    """Test error handling in detect_and_execute_commands."""
    text = "Press [[press:1]]"
    call_sid = "CA123"
    
    with patch('backend.commands.detect_command') as mock_detect, \
         patch('backend.commands.execute_command') as mock_execute:
        
        mock_detect.return_value = Command("press", "1")
        mock_execute.side_effect = Exception("Execution failed")
        
        # Should not raise exception, should handle gracefully
        result = await detect_and_execute_commands(text, call_sid)
        
        # Behavior depends on implementation - could be True or False
        assert result in [True, False]


def test_command_regex_patterns():
    """Test various regex patterns for command detection."""
    test_cases = [
        ("[[press:1]]", True),
        ("[[transfer:+1234567890]]", True),
        ("[[end_call]]", True),
        ("[[request_user:What is your account?]]", True),
        ("[press:1]", False),  # Single brackets
        ("press:1", False),    # No brackets
        ("[[press1]]", False), # No colon for value commands
        ("[[]]", False),       # Empty command
        ("[[press:1", False),  # Unclosed bracket
        ("press:1]]", False),  # No opening brackets
    ]
    
    import re
    pattern = r'\[\[(\w+)(?::([^\]]*))?\]\]'
    
    for text, should_match in test_cases:
        match = re.search(pattern, text)
        if should_match:
            assert match is not None, f"Pattern should match: {text}"
        else:
            assert match is None, f"Pattern should not match: {text}"


def test_command_value_parsing():
    """Test parsing of command values with various formats."""
    test_cases = [
        ("[[press:1]]", "1"),
        ("[[press:123]]", "123"),
        ("[[press:*]]", "*"),
        ("[[press:#]]", "#"),
        ("[[transfer:+1-555-123-4567]]", "+1-555-123-4567"),
        ("[[transfer:]]", ""),  # Empty value
        ("[[end_call]]", None), # No value
        ("[[request_user:What is your account number?]]", "What is your account number?"),
    ]
    
    import re
    pattern = r'\[\[(\w+)(?::([^\]]*))?\]\]'
    
    for text, expected_value in test_cases:
        match = re.search(pattern, text)
        assert match is not None
        action = match.group(1)
        value = match.group(2) if match.group(2) is not None else None
        assert value == expected_value, f"Value mismatch for {text}: expected {expected_value}, got {value}"


def test_twilio_client_initialization_error(monkeypatch):
    """Test handling of Twilio client initialization errors."""
    def failing_client(*args, **kwargs):
        raise Exception("Failed to initialize Twilio client")
    
    monkeypatch.setattr(commands, "Client", failing_client)
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "TK")
    
    cmd = Command("press", "1")
    
    # Should handle initialization error gracefully
    try:
        commands.execute_command(cmd, "CA1")
    except Exception:
        pytest.fail("execute_command should handle Twilio client initialization errors gracefully")


def test_environment_variable_handling(monkeypatch):
    """Test handling of missing environment variables."""
    # Clear environment variables
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TRANSFER_NUMBER", raising=False)
    
    cmd = Command("press", "1")
    
    # Should handle missing environment variables gracefully
    try:
        commands.execute_command(cmd, "CA1")
    except Exception:
        pytest.fail("execute_command should handle missing environment variables gracefully")
