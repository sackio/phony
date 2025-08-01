import logging
from backend.logging import CallLogger

class DummyHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []
    def emit(self, record):
        self.records.append(record)


def test_log_transcript():
    handler = DummyHandler()
    logger = logging.getLogger('phony-test')
    logger.addHandler(handler)
    call_logger = CallLogger(None)
    call_logger.logger = logger

    call_logger.log_transcript('CA1', 'caller', 'hi')
    assert handler.records
    record = handler.records[0]
    assert 'transcript' in record.getMessage()
