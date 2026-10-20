#!/usr/bin/env python3
"""Print tools/resume/resume.html to resume/resume_<m>-<d>-<yy>.pdf with headless Chrome (standard library only).

    python tools/resume/build.py              uses today's date in the file name
    python tools/resume/build.py 10-16-26     uses the date you give

After building, point resume/index.html at the new file name (the page's links and the date in its note).
"""
import datetime as dt
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools" / "resume" / "resume.html"
CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "chromium", "chrome",
]


def find_chrome():
    for c in CANDIDATES:
        if Path(c).exists() or shutil.which(c):
            return c
    sys.exit("Chrome was not found; install it or add its path to CANDIDATES in this script.")


def main():
    if len(sys.argv) > 1:
        stamp = sys.argv[1]
    else:
        d = dt.date.today()
        stamp = f"{d.month}-{d.day}-{d.strftime('%y')}"
    out = ROOT / "resume" / f"resume_{stamp}.pdf"
    subprocess.run([find_chrome(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", SOURCE.as_uri()], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
