import os
from backend import commands
from backend.commands import Command


def test_detect_command_parses_press():
    cmd = commands.detect_command('Please [[press:12]] now')
    assert cmd == Command(action='press', value='12')


def test_detect_command_none_for_plain_text():
    assert commands.detect_command('hello world') is None


def test_execute_command_press(monkeypatch):
    updates = {}

    class DummyCall:
        def update(self, **kwargs):
            updates.update(kwargs)

    class DummyClient:
        def __init__(self, sid, token):
            pass
        def calls(self, sid):
            return DummyCall()

    monkeypatch.setattr(commands, 'Client', DummyClient)
    monkeypatch.setenv('TWILIO_ACCOUNT_SID', 'AC')
    monkeypatch.setenv('TWILIO_AUTH_TOKEN', 'TK')

    cmd = Command(action='press', value='1')
    commands.execute_command(cmd, 'CA1')
    assert updates.get('send_digits') == '1'
