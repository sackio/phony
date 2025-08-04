import pytest
from tests.helpers import assert_conversation_relay


@pytest.mark.parametrize("path", ["/start_call", "/receive_call"])
def test_call_endpoints_return_twiml(client, path):
    resp = client.post(path)
    assert resp.status_code == 200
    assert_conversation_relay(resp.text)
