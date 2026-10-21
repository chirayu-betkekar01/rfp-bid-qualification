"""Download the public test RFPs into data/test_rfps/.

The PDFs are not committed: they contain real buyer contact details (rule 8).

    python -m eval.fetch_test_rfps
"""
import urllib.request
from pathlib import Path

TEST_RFPS_DIR = Path(__file__).resolve().parent.parent / "data" / "test_rfps"

TEST_RFPS = {
    "tulsa_rfp_26-901.pdf":
        "https://cityoftulsa.org/media/28516/rfp-26-901-constituent-relationship-management-software.pdf",
    "asheville_service_request.pdf":
        "https://evp.nc.gov/_entity/annotation/f722d2ec-4f21-f111-8342-001dd803db57/api",
    "utep_rfp_724-2605.pdf":
        "https://www.utep.edu/purchasing-and-general-services/pgs-departments/purchasing/RFPs/"
        "Plannning-Scheduling-Software---RFP-724-2605-JBT.pdf",
}


def fetch(name: str, url: str) -> Path:
    path = TEST_RFPS_DIR / name
    if path.exists():
        return path
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    if not data.startswith(b"%PDF"):
        raise ValueError(f"{name}: download from {url} is not a PDF")
    path.write_bytes(data)
    return path


def main() -> None:
    for name, url in TEST_RFPS.items():
        try:
            print(f"{fetch(name, url).name}: ok")
        except Exception as exc:  # report every file, then carry on
            print(f"{name}: failed ({exc})")


if __name__ == "__main__":
    main()
