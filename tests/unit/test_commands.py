import pytest
from backend import commands
from backend.commands import Command


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Please [[press:12]] now", {"action": "press", "value": "12"}),
        ("Please [[transfer:+1234567890]] now", {"action": "transfer", "value": "+1234567890"}),
        ("Time to [[end_call]]", {"action": "end_call", "value": None}),
        ("Need [[request_user:code]]", {"action": "request_user", "value": "code"}),
        ("hello world", None),
    ],
)
def test_detect_command(text, expected):
    cmd = commands.detect_command(text)
    if expected is None:
        assert cmd is None
    else:
        assert cmd == Command(**expected)


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
