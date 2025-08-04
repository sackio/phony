from pathlib import Path
import pytest

@pytest.fixture
def index_html() -> str:
    return Path("dashboard/index.html").read_text()


@pytest.fixture
def script_js() -> str:
    return Path("dashboard/script.js").read_text()


def test_index_contains_required_elements(index_html):
    assert 'id="transcript"' in index_html
    assert 'id="speak-form"' in index_html
    assert 'id="keypad"' in index_html


def test_script_defines_keypad_keys(script_js):
    assert "const keys" in script_js
    for k in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]:
        assert f"'{k}'" in script_js


def test_script_uses_override_endpoints(script_js):
    assert "/override/text" in script_js
    assert "/override/dtmf" in script_js
    assert "/override/end" in script_js
    assert "/override/transfer" in script_js
    assert "/override/clarification" in script_js
