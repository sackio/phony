# Phony Dashboard

A lightweight web dashboard for monitoring active calls in real time and sending supervisor overrides.

## Setup

No build step is required. Serve the files in this directory with any static web server.

```bash
python3 -m http.server 3000
```

Then open `http://localhost:3000/index.html?callSid=<CALL_SID>` in your browser. Replace `<CALL_SID>` with the active call's identifier.

## Configuration

- The dashboard establishes a WebSocket connection to `/events/ws?callSid=...` on the same host to receive real-time events.
- Override actions are sent to the backend via POST requests:
  - `/override/text` – `{"callSid": "CA...", "text": "hello"}`
  - `/override/dtmf` – `{"callSid": "CA...", "digit": "1"}`
  - `/override/end` – `{"callSid": "CA..."}`
  - `/override/transfer` – `{"callSid": "CA...", "number": "+15551234567"}`

## UI Components

- **Transcript View** – Scrollable log of caller transcripts, assistant replies, commands and supervisor actions with timestamps.
- **Manual Speak Input** – Text box to send a typed message to the caller.
- **DTMF Pad** – Buttons 0-9, `*`, `#` for sending DTMF digits.
- **Call Control Buttons** – `End Call` and `Transfer` buttons for ending or transferring the call.

Supervisor actions are appended to the transcript area immediately when triggered.
