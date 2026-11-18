"""Install the official, checksum-pinned Stockfish 19 Linux release.

Downloads a binary from official-stockfish/Stockfish and verifies GitHub's published
SHA-256 digest before extracting a single executable. Never extracts archive paths.
The binary lives in .stockfish/bin/stockfish and is not committed to Git.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / ".stockfish" / "bin" / "stockfish"
TAG = "sf_19"
# Digests from https://api.github.com/repos/official-stockfish/Stockfish/releases/tags/sf_19
ASSETS = {
    "x86_64": ("stockfish-linux-x86-64-universal.tar.gz", "9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f"),
    "aarch64": ("stockfish-linux-arm64-universal.tar.gz", "fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01"),
    "riscv64": ("stockfish-linux-riscv64-universal.tar.gz", "d4b4d118c003bc669a939d9fb208e3ef6b367730fd79a70dbc278b18475df3d1"),
}


def architecture() -> str:
    if platform.system() != "Linux":
        raise RuntimeError("This installer supports Chromebook Linux / Linux only.")
    arch = platform.machine().lower()
    arch = {"amd64": "x86_64", "arm64": "aarch64"}.get(arch, arch)
    if arch not in ASSETS:
        raise RuntimeError(f"Unsupported Linux CPU architecture: {arch}")
    return arch


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_stockfish19(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        result = subprocess.run([str(path)], input="uci\nquit\n", text=True,
                                capture_output=True, timeout=15, check=True)
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        return False
    return bool(re.search(r"(?m)^id name Stockfish 19(?:\s|$)", result.stdout))


def choose_engine(members: list[tarfile.TarInfo]) -> tarfile.TarInfo:
    candidates = []
    for member in members:
        basename = PurePosixPath(member.name).name
        if member.isfile() and re.fullmatch(r"stockfish(?:-linux-[a-z0-9-]+)?", basename):
            candidates.append(member)
    if len(candidates) != 1:
        raise ValueError(f"Expected one Stockfish executable in archive; found {len(candidates)}")
    return candidates[0]


def install_verified_archive(archive: Path, expected_digest: str,
                             destination: Path = DESTINATION) -> Path:
    if sha256_file(archive) != expected_digest:
        raise ValueError("Stockfish archive SHA-256 does not match the official release")
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_name = None
    try:
        with tarfile.open(archive, mode="r:gz") as tar:
            member = choose_engine(tar.getmembers())
            source = tar.extractfile(member)
            if source is None:
                raise ValueError("No executable payload in Stockfish archive")
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as target:
                tmp_name = target.name
                with source:
                    shutil.copyfileobj(source, target)
        os.chmod(tmp_name, 0o755)
        if not is_stockfish19(Path(tmp_name)):
            raise ValueError("Downloaded binary did not identify itself as Stockfish 19")
        os.replace(tmp_name, destination)
        return destination
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.unlink(tmp_name)


def install(force: bool = False, destination: Path = DESTINATION) -> Path:
    if not force and is_stockfish19(destination):
        print(f"Stockfish 19 is already installed: {destination}")
        return destination
    filename, digest = ASSETS[architecture()]
    url = f"https://github.com/official-stockfish/Stockfish/releases/download/{TAG}/{filename}"
    print(f"Downloading pinned Stockfish 19: {filename}", flush=True)
    with tempfile.TemporaryDirectory(prefix="stockfish19-") as folder:
        archive = Path(folder) / filename
        with urllib.request.urlopen(url, timeout=90) as source, archive.open("wb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
        result = install_verified_archive(archive, digest, destination)
    print(f"Verified and installed: {result}", flush=True)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Reinstall even if Stockfish 19 is present")
    args = parser.parse_args()
    install(force=args.force)
