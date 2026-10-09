import os
from urllib.request import urlopen


def main():
    with urlopen(f"http://127.0.0.1:{os.environ.get('PORT', '10000')}/healthz", timeout=4) as response:
        if response.status != 200:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
