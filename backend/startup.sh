#!/bin/bash
# Azure App Service (B1 Linux) startup — set as Startup Command in the portal.
cd /home/site/wwwroot
python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
