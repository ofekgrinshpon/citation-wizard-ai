"""Read court-issued Gazette DOCX files; output locators, never evidence."""
import argparse
import json
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

WO = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
COURT_LINK = re.compile(r'HYPERLINK\s+"https?://hj\.tribunalconstitucional\.es/(?:HJ/)?es/Resolucion/Show/([1-9]\d{0,6})"')
HEADING = re.compile(r"•\s*(?:Pleno|Sala Primera|Sala Segunda|Sección (?:Primera|Segunda|Tercera|Cuarta))\.\s+SENTENCIA ([1-9]\d{0,3})/(\d{4}), de .* de \2")

def records(path):
    with ZipFile(path) as z:
        entry = z.getinfo("word/document.xml")
        if entry.file_size > 24_000_000:
            raise ValueError("Oversized Gazette")
        body = ET.fromstring(z.read(entry)).find(WO+"body")
    if body is None:
        raise ValueError("Missing document body")
    children = list(body)
    for bookmark, p in zip(children, children[1:]):
        if bookmark.tag != WO+"bookmarkStart" or p.tag != WO+"p":
            continue
        key = re.fullmatch(r"SENTENCIA_(\d{4})_([1-9]\d{0,3})", bookmark.get(WO+"name",""))
        if not key:
            continue
        heading = "".join(c.text or "" for c in p.iter(WO+"t"))
        match = HEADING.fullmatch(heading.strip())
        urls = COURT_LINK.findall("".join(c.text or "" for c in p.iter(WO+"instrText")))
        if match is None or match.groups() != key.groups()[::-1] or len(urls) != 1:
            raise ValueError(f"Inconsistent heading for {key[0]}")
        yield f"STC {key[2]}/{key[1]}", urls[0]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("gazettes",nargs="+")
    candidates = {}
    for path in ap.parse_args().gazettes:
        for key, locator in records(path):
            existing = candidates.setdefault(key,locator)
            if existing != locator:
                raise ValueError(f"Ambiguous locator for {key}")
    if not candidates:
        raise ValueError("No locators")
    print(json.dumps(candidates,indent=2,sort_keys=True))
