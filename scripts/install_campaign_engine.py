"""Install the pinned official Stockfish 17.1 Linux AVX2 build for this campaign."""
import hashlib
from pathlib import Path
import shutil
import tarfile
import urllib.request

URL = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-ubuntu-x86-64-avx2.tar'
SHA256 = '09e953222dbe80aaea5c33dab265413b295cb8376418445c877708c61e31987d'
MEMBER = 'stockfish/stockfish-ubuntu-x86-64-avx2'


def main():
    target = Path('.campaign-engine')
    target.mkdir(exist_ok=True)
    archive = target / 'stockfish.tar'
    urllib.request.urlretrieve(URL, archive)
    if hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != SHA256:
        raise RuntimeError('Official engine archive checksum mismatch')
    # Extract only the known executable; no archive-controlled output paths.
    with tarfile.open(archive) as bundle:
        with bundle.extractfile(MEMBER) as source, (target/'stockfish').open('wb') as dest:
            shutil.copyfileobj(source,dest)
    (target/'stockfish').chmod(0o755)
    archive.unlink()
    print(target/'stockfish')


if __name__ == '__main__':
    main()
