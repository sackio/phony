import xml.etree.ElementTree as ET


def assert_conversation_relay(xml_text: str) -> None:
    """Assert that TwiML contains a Connect with ConversationRelay."""
    root = ET.fromstring(xml_text)
    connect = root.find('Connect')
    assert connect is not None, 'Connect element missing'
    relay = connect.find('ConversationRelay')
    assert relay is not None, 'ConversationRelay element missing'
