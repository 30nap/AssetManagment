"""Sample WSGI file for PythonAnywhere.

On PythonAnywhere, open the "Web" tab, and in the "Code" section edit the
WSGI configuration file it created for you. Replace its contents with the
lines below, fixing ``PROJECT_DIR`` to match where you uploaded this project
(e.g. ``/home/yourusername/AssetManagment``).
"""

import sys

PROJECT_DIR = "/home/yourusername/AssetManagment"

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

from flask_app import app as application  # noqa: E402
