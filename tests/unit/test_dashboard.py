from pathlib import Path


def test_index_contains_required_elements():
    html = Path('dashboard/index.html').read_text()
    assert 'id="transcript"' in html
    assert 'id="speak-form"' in html
    assert 'id="keypad"' in html


def test_script_defines_keypad_keys():
    js = Path('dashboard/script.js').read_text()
    assert "const keys" in js
    for k in ['1','2','3','4','5','6','7','8','9','*','0','#']:
        assert f"'{k}'" in js


def test_script_uses_override_endpoints():
    js = Path('dashboard/script.js').read_text()
    assert '/override/text' in js
    assert '/override/dtmf' in js
    assert '/override/end' in js
    assert '/override/transfer' in js
    assert '/override/clarification' in js
