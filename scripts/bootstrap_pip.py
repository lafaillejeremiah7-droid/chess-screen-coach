"""Install pip into this project's venv when the system Python lacks ensurepip."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.request import urlopen

# Universal wheel published on https://pypi.org/project/pip/25.3/#files
WHEEL = "pip-25.3-py3-none-any.whl"
URL = "https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/" + WHEEL
SHA256 = "9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd"


def main():
    if sys.prefix == sys.base_prefix:
        sys.exit("Run bash start.sh to create the project virtual environment.")
    with tempfile.TemporaryDirectory() as tmp:
        wheel = Path(tmp) / WHEEL
        with urlopen(URL, timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != SHA256:
            sys.exit("Downloaded pip wheel failed checksum verification.")
        wheel.write_bytes(data)
        subprocess.run(
            [sys.executable, "-m", "pip", "--isolated", "install", "--no-index",
             "--ignore-installed", "--no-deps", "--disable-pip-version-check", str(wheel)],
            env={**os.environ, "PYTHONPATH": str(wheel)},
            cwd=tmp, check=True,
        )


if __name__ == "__main__":
    main()
