# Repository Overview

This project implements a phone based AI assistant. The code is now organised
into a few key directories:

- **backend** – FastAPI application and supporting modules
- **scripts** – helper scripts such as `make_call.py`
- **dashboard** – static files for the supervisor dashboard

The `backend` package exposes the FastAPI `app` in `main.py`. All other Python
modules use relative imports inside this package. `scripts/make_call.py` can be
run directly to place a call via Twilio.
