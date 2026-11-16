"""Installer unit tests: checksum, path safety and version validation."""
import hashlib
import io
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import install_stockfish19 as installer


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "test.tar.gz"
        self.destination = self.root / "bin" / "stockfish"

    def archive_with(self, name, contents):
        with tarfile.open(self.archive, "w:gz") as out:
            info = tarfile.TarInfo(name)
            info.mode = 0o755
            info.size = len(contents)
            out.addfile(info, io.BytesIO(contents))
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def test_install_verified_single_file(self):
        script = b"#!/bin/sh\nprintf 'id name Stockfish 19\\nuciok\\n'\n"
        digest = self.archive_with("release/stockfish-linux-x86-64", script)
        installed = installer.install_verified_archive(
            self.archive, digest, self.destination)
        self.assertEqual(installed, self.destination)
        self.assertTrue(installer.is_stockfish19(installed))
        self.assertTrue(os.access(installed, os.X_OK))

    def test_reject_wrong_digest_without_overwriting_engine(self):
        self.destination.parent.mkdir()
        self.destination.write_text("old")
        self.archive_with("stockfish-linux-x86-64", b"not trusted")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            installer.install_verified_archive(
                self.archive, "0" * 64, self.destination)
        self.assertEqual(self.destination.read_text(), "old")

    def test_reject_wrong_version(self):
        digest = self.archive_with(
            "release/stockfish-linux-x86-64",
            b"#!/bin/sh\nprintf 'id name Stockfish 18\\nuciok\\n'\n")
        with self.assertRaisesRegex(ValueError, "identify"):
            installer.install_verified_archive(
                self.archive, digest, self.destination)
        self.assertFalse(self.destination.exists())

    def test_reject_ambiguous_archive(self):
        with tarfile.open(self.archive, "w:gz") as out:
            for name in ("a/stockfish", "b/stockfish"):
                contents = b"binary"
                info = tarfile.TarInfo(name)
                info.size = len(contents)
                out.addfile(info, io.BytesIO(contents))
        digest = installer.sha256_file(self.archive)
        with self.assertRaisesRegex(ValueError, "Expected one"):
            installer.install_verified_archive(self.archive, digest, self.destination)

    def test_arch_mapping(self):
        with patch.object(installer.platform, "system", return_value="Linux"), \
             patch.object(installer.platform, "machine", return_value="arm64"):
            self.assertEqual(installer.architecture(), "aarch64")


if __name__ == "__main__":
    unittest.main()
