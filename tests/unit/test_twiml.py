from backend.twiml import conversation_relay_response
from tests.helpers import assert_conversation_relay


def test_conversation_relay_response_builds_twiml():
    resp = conversation_relay_response()
    assert resp.media_type == 'application/xml'
    assert_conversation_relay(resp.body.decode())
