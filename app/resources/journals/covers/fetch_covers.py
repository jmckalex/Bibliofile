#!/usr/bin/env python3
"""Download cover/thumbnail images for philosophy journals.

Reads ../philosophy.json, for each journal with a homepageUrl:
  fetch HTML -> extract cover image URL (og:image, twitter:image,
  image_src, apple-touch-icon, favicon) -> download -> verify it's an
  image -> thumbnail to <=512px -> save as <issnL|slug>.<ext>.

Writes ./index.json with the successful entries.
Resilient: per-journal failures are logged and skipped, never fatal.
"""
import json
import os
import re
import subprocess
import sys
import time
import html as htmllib
from urllib.parse import urljoin, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(HERE, os.pardir, "philosophy.json")
INDEX_PATH = os.path.join(HERE, "index.json")
LOG_PATH = os.path.join(HERE, "fetch.log")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "BibDesk-Electron/1.0 (journal cover fetcher; +contact jmckalex@gmail.com)")

# Image content types -> extension
EXT_BY_TYPE = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg",
    "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
    "image/bmp": "bmp", "image/tiff": "tif",
}

LOGF = open(LOG_PATH, "w")


def log(msg):
    print(msg)
    LOGF.write(msg + "\n")
    LOGF.flush()


def slugify(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s[:80] or "journal"


def curl_bytes(url, timeout=20):
    """Fetch raw bytes via curl. Returns (status_str, content_type, bytes) or None."""
    # -s silent, -L follow redirects, -w write final info to stderr marker
    try:
        proc = subprocess.run(
            ["curl", "-sL", "--max-time", str(timeout),
             "-A", UA,
             "-H", "Accept: text/html,application/xhtml+xml,image/*,*/*",
             "-D", "-",  # dump headers to stdout before body
             "-o", "-",
             url],
            capture_output=True, timeout=timeout + 10)
    except subprocess.TimeoutExpired:
        return None
    except Exception as e:
        log(f"    curl exception: {e}")
        return None
    raw = proc.stdout
    if not raw:
        return None
    # Separate the last header block from body. With -L there can be multiple
    # header blocks (redirects). Find last occurrence of \r\n\r\n.
    sep = b"\r\n\r\n"
    idx = raw.rfind(sep)
    # But body itself could contain \r\n\r\n; we want the boundary between the
    # final header block and the body. Headers are ASCII lines starting with
    # HTTP/ ... ; safer: split on the LAST header block that begins with HTTP.
    # Strategy: walk through header blocks.
    header_blob = b""
    body = raw
    # Find all header sections (each starts with HTTP/)
    parts = re.split(rb"(?=HTTP/\d)", raw)
    # The last part contains final headers + body
    last = parts[-1] if parts else raw
    if sep in last:
        h, body = last.split(sep, 1)
        header_blob = h
    else:
        # fallback to rfind
        if idx != -1:
            header_blob = raw[:idx]
            body = raw[idx + len(sep):]
    ctype = ""
    for line in header_blob.split(b"\r\n"):
        if line.lower().startswith(b"content-type:"):
            ctype = line.split(b":", 1)[1].strip().decode("latin-1").split(";")[0].strip().lower()
    return ("ok", ctype, body)


def extract_image_url(html_text, base_url):
    """Return (url, kind) for the best cover image candidate, or (None, None)."""
    # Normalize for regex (case-insensitive). Work on original for value extraction.
    candidates = []  # list of (kind, url)

    def find_meta(prop_attr, prop_val):
        # <meta property="og:image" content="...">  (attrs in any order)
        pat = re.compile(
            r"<meta\b[^>]*?" + prop_attr + r"\s*=\s*['\"]" + re.escape(prop_val) +
            r"['\"][^>]*?>", re.I)
        for m in re.finditer(pat, html_text):
            tag = m.group(0)
            cm = re.search(r"content\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
            if cm:
                return cm.group(1)
        # also handle content before property
        pat2 = re.compile(
            r"<meta\b[^>]*?content\s*=\s*['\"]([^'\"]+)['\"][^>]*?" + prop_attr +
            r"\s*=\s*['\"]" + re.escape(prop_val) + r"['\"]", re.I)
        m = re.search(pat2, html_text)
        if m:
            return m.group(1)
        return None

    # 1. og:image (property=)
    u = find_meta("property", "og:image") or find_meta("name", "og:image")
    if u:
        candidates.append(("og:image", u))
    # 2. twitter:image (name= or property=)
    u = find_meta("name", "twitter:image") or find_meta("property", "twitter:image") \
        or find_meta("name", "twitter:image:src")
    if u:
        candidates.append(("twitter:image", u))
    # 3. link rel="image_src"
    m = re.search(r"<link\b[^>]*?rel\s*=\s*['\"]image_src['\"][^>]*?>", html_text, re.I)
    if m:
        hm = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", m.group(0), re.I)
        if hm:
            candidates.append(("image_src", hm.group(1)))
    # 4. apple-touch-icon (prefer the largest if sizes given; just take first)
    apple = []
    for m in re.finditer(r"<link\b[^>]*?rel\s*=\s*['\"]apple-touch-icon[^'\"]*['\"][^>]*?>", html_text, re.I):
        tag = m.group(0)
        hm = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
        sm = re.search(r"sizes\s*=\s*['\"](\d+)", tag, re.I)
        if hm:
            size = int(sm.group(1)) if sm else 0
            apple.append((size, hm.group(1)))
    if apple:
        apple.sort(reverse=True)
        candidates.append(("apple-touch-icon", apple[0][1]))
    # 4b. generic icon link as a fallback for favicon discovery
    icon_href = None
    for m in re.finditer(r"<link\b[^>]*?rel\s*=\s*['\"][^'\"]*icon[^'\"]*['\"][^>]*?>", html_text, re.I):
        tag = m.group(0)
        if "apple-touch" in tag.lower():
            continue
        hm = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
        if hm:
            icon_href = hm.group(1)
            break
    # 5. favicon
    if icon_href:
        candidates.append(("favicon", icon_href))
    else:
        sp = urlsplit(base_url)
        candidates.append(("favicon", f"{sp.scheme}://{sp.netloc}/favicon.ico"))

    # resolve & unescape, return first
    if candidates:
        kind, url = candidates[0], None
    out = []
    for kind, u in candidates:
        u = htmllib.unescape(u.strip())
        if not u or u.startswith("data:"):
            continue
        u = urljoin(base_url, u)
        out.append((kind, u))
    return out  # ordered list of (kind, url)


def is_image_bytes(b, ctype):
    if not b or len(b) < 10:
        return False
    head = b[:32]
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if head[:2] == b"BM":
        return "bmp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "tif"
    if head[:4] == b"\x00\x00\x01\x00":
        return "ico"
    # SVG: text starting with <svg or <?xml ... svg
    sniff = b[:512].lstrip()
    if sniff[:5].lower() == b"<?xml" or sniff[:4].lower() == b"<svg":
        if b"<svg" in b[:2000].lower():
            return "svg"
    # If content-type clearly an image but bytes unknown, trust ext but reject html
    if ctype.startswith("image/") and not sniff[:9].lower().startswith(b"<!doctype") \
       and not sniff[:5].lower() == b"<html":
        return EXT_BY_TYPE.get(ctype, "img")
    return False


def sips_dims(path):
    try:
        out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                             capture_output=True, timeout=30)
        w = re.search(r"pixelWidth:\s*(\d+)", out.stdout.decode("latin-1", "ignore"))
        h = re.search(r"pixelHeight:\s*(\d+)", out.stdout.decode("latin-1", "ignore"))
        if w and h:
            return int(w.group(1)), int(h.group(1))
    except Exception:
        pass
    return None


def main():
    with open(JSON_PATH) as f:
        journals = json.load(f)

    manifest = []
    stats = {
        "total": len(journals),
        "no_homepage": 0,
        "fetch_failed": 0,
        "no_candidate_worked": 0,
        "not_image": 0,
        "saved": 0,
        "by_kind": {},
    }

    processed_with_homepage = 0
    for j in journals:
        name = j.get("name", "")
        home = j.get("homepageUrl")
        issnl = j.get("issnL")
        if not home:
            stats["no_homepage"] += 1
            continue
        processed_with_homepage += 1
        base = name if not issnl else issnl
        log(f"[{processed_with_homepage}] {name}")
        log(f"    homepage: {home}")

        # fetch HTML (1 retry)
        res = None
        for attempt in range(2):
            res = curl_bytes(home, timeout=20)
            if res:
                break
            if attempt == 0:
                log("    retry html fetch")
                time.sleep(0.4)
        if not res:
            log("    FETCH FAILED")
            stats["fetch_failed"] += 1
            time.sleep(0.35)
            continue
        _, ctype, body = res
        # final URL for relative resolution: curl followed redirects; we use home
        # (good enough; og:image are usually absolute anyway)
        try:
            html_text = body.decode("utf-8", "ignore")
        except Exception:
            html_text = body.decode("latin-1", "ignore")

        # If the homepage itself returned an image (rare), handle directly
        candidates = []
        if ctype.startswith("image/"):
            candidates = [("og:image", home)]  # treat as direct
        else:
            candidates = extract_image_url(html_text, home)

        saved = False
        for kind, img_url in candidates:
            log(f"    try {kind}: {img_url}")
            # download (1 retry)
            ires = None
            for attempt in range(2):
                ires = curl_bytes(img_url, timeout=20)
                if ires:
                    break
                if attempt == 0:
                    time.sleep(0.3)
            if not ires:
                log("      download failed")
                time.sleep(0.2)
                continue
            _, ictype, ibytes = ires
            kindext = is_image_bytes(ibytes, ictype)
            if not kindext:
                log(f"      not an image (ctype={ictype}, {len(ibytes)} bytes)")
                time.sleep(0.2)
                continue
            ext = kindext if kindext != "img" else (EXT_BY_TYPE.get(ictype, "jpg"))
            # filename
            stem = issnl if issnl else slugify(name)
            fname = f"{stem}.{ext}"
            fpath = os.path.join(HERE, fname)
            with open(fpath, "wb") as wf:
                wf.write(ibytes)
            # verify with sips for raster formats; skip svg (sips can't always)
            if ext != "svg":
                dims = sips_dims(fpath)
                if not dims:
                    log("      sips can't read -> discard")
                    os.remove(fpath)
                    stats["not_image"] += 1 if kind == candidates[0][0] else 0
                    time.sleep(0.2)
                    continue
                log(f"      image {dims[0]}x{dims[1]} -> {fname}")
                # thumbnail
                if max(dims) > 512:
                    r = subprocess.run(["sips", "-Z", "512", fpath, "--out", fpath],
                                       capture_output=True, timeout=60)
                    if r.returncode != 0:
                        log("      thumbnail failed (keeping original)")
                    else:
                        nd = sips_dims(fpath)
                        log(f"      thumbnailed -> {nd[0]}x{nd[1]}")
            else:
                log(f"      svg saved -> {fname}")
            manifest.append({
                "issnL": issnl,
                "name": name,
                "file": fname,
                "sourceUrl": img_url,
                "kind": kind,
            })
            stats["saved"] += 1
            stats["by_kind"][kind] = stats["by_kind"].get(kind, 0) + 1
            saved = True
            break
        if not saved:
            log("    NO USABLE IMAGE")
            stats["no_candidate_worked"] += 1
        time.sleep(0.35)

    with open(INDEX_PATH, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    log("\n==== SUMMARY ====")
    log(json.dumps(stats, indent=2))
    log(f"manifest entries: {len(manifest)}")
    LOGF.close()


if __name__ == "__main__":
    main()
