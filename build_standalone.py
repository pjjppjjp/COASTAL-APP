#!/usr/bin/env python3
"""Build OPEN-COASTAL.html using only the Python standard library.

The resulting file embeds the app, styles, Leaflet, poster and local image assets.
It runs by double click, without a web server, module loader or installed packages.
Map tiles and online place search still require the internet. Browser location
permission and storage policies can differ for file:// pages.

This small bundler supports this project's named imports and named function/const
exports. It intentionally fails on unsupported module forms instead of producing
an incomplete portable app.
"""
from __future__ import annotations

import argparse
import base64
import html
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
NETWORK_NOTE = (
    "Portable copy: this file includes the app, styles, Leaflet and poster. "
    "Planning calculations and CSV/GeoJSON exports run locally. Live map tiles "
    "and online place search need internet. Browsers can restrict location "
    "permission or storage for file:// pages; use coordinate entry and export "
    "a copy when needed."
)
SCRIPT_RE = re.compile(r"<script\b(?P<attrs>[^>]*)>(?P<code>.*?)</script\s*>", re.I | re.S)
LINK_RE = re.compile(r"<link\b[^>]*>", re.I)
IMAGE_RE = re.compile(r"<(?:img|source)\b[^>]*>", re.I)
CSS_URL_RE = re.compile(r"url\(\s*(?P<quote>['\"]?)(?P<url>.*?)(?P=quote)\s*\)", re.I | re.S)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\(\s*)?(?P<quote>['\"])(?P<url>.+?)(?P=quote)\s*\)?\s*(?P<media>[^;]*);",
    re.I,
)
IMPORT_RE = re.compile(
    r"^[ \t]*import\s*\{(?P<names>[^}]+)\}\s*from\s*(?P<quote>['\"])(?P<path>[^'\"]+)(?P=quote)\s*;?[ \t]*(?:\r?\n|$)",
    re.M,
)
EXPORT_RE = re.compile(
    r"^(?P<indent>[ \t]*)export[ \t]+(?P<declaration>(?:async[ \t]+)?function[ \t]+|(?:const|let|var|class)[ \t]+)(?P<name>[A-Za-z_$][\w$]*)",
    re.M,
)
STATIC_ASSET_RE = re.compile(
    r"(?P<quote>['\"])(?P<url>(?:\./)?(?:assets|vendor/images)/[^'\"\r\n]+)(?P=quote)"
)


class BuildError(RuntimeError):
    pass


class Tag(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.name = ""
        self.attrs: list[tuple[str, str | None]] = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.name, self.attrs = tag, attrs

    handle_startendtag = handle_starttag

    def get(self, name: str, default=""):
        return dict(self.attrs).get(name, default)

    def set(self, name: str, value: str):
        self.attrs = [(key, item) for key, item in self.attrs if key != name]
        self.attrs.append((name, value))

    def render(self):
        attrs = " ".join(
            key if value is None else f'{key}="{html.escape(value, quote=True)}"'
            for key, value in self.attrs
        )
        return f"<{self.name}{' ' if attrs else ''}{attrs}>"


def escape_script(source: str) -> str:
    # The HTML parser recognizes closing script tags even inside JS strings.
    return re.sub(r"</script", lambda match: match[0].replace("</", "<\\/", 1), source, flags=re.I)


def escape_style(source: str) -> str:
    return re.sub(r"</style", lambda match: match[0].replace("</", "<\\/", 1), source, flags=re.I)


class Bundler:
    def __init__(self, dist: Path):
        self.dist = dist.resolve()
        self.assets: dict[Path, str] = {}
        self.modules: dict[Path, str] = {}
        self.pending: set[Path] = set()
        self.module_entries = 0

    def local_file(self, url: str, base: Path) -> Path | None:
        parsed = urlsplit(html.unescape(url.strip()))
        if parsed.scheme or parsed.netloc or not parsed.path:
            return None
        path = (base / unquote(parsed.path)).resolve()
        try:
            path.relative_to(self.dist)
        except ValueError as exc:
            raise BuildError(f"Asset escapes dist/: {url}") from exc
        if not path.is_file():
            raise BuildError(f"Required file is missing: {path}")
        return path

    def require_local(self, url: str, base: Path) -> Path:
        path = self.local_file(url, base)
        if path is None:
            raise BuildError(f"A self-contained build requires a local file here: {url}")
        return path

    def data_uri(self, url: str, base: Path) -> str:
        path = self.local_file(url, base)
        if path is None:
            return url
        if path not in self.assets:
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            self.assets[path] = f"data:{mime};base64,{encoded}"
        fragment = urlsplit(url).fragment
        return self.assets[path] + (f"#{fragment}" if fragment else "")

    def css(self, path: Path, seen: tuple[Path, ...] = ()) -> str:
        if path in seen:
            raise BuildError(f"Circular CSS import: {path.name}")
        source = path.read_text(encoding="utf-8-sig")

        def import_css(match):
            child = self.require_local(match["url"], path.parent)
            content = self.css(child, (*seen, path))
            media = match["media"].strip()
            return f"@media {media}{{\n{content}\n}}" if media else content

        source = CSS_IMPORT_RE.sub(import_css, source)

        def inline_url(match):
            url = match["url"].strip()
            if not url or url.startswith(("#", "data:")):
                return match[0]
            embedded = self.data_uri(url, path.parent)
            if embedded == url and urlsplit(url).scheme:
                raise BuildError(f"CSS has a remote dependency that must be bundled first: {url}")
            return f'url("{embedded}")'

        source = CSS_URL_RE.sub(inline_url, source)
        return re.sub(r"/\*[#@]\s*sourceMappingURL=.*?\*/", "", source, flags=re.S)

    def js_assets(self, source: str, base: Path) -> str:
        def replace(match):
            return match["quote"] + self.data_uri(match["url"], base) + match["quote"]
        return STATIC_ASSET_RE.sub(replace, source)

    def imports(self, source: str, path: Path) -> str:
        def replace(match):
            dependency = self.require_local(match["path"], path.parent)
            key = self.module(dependency)
            names = []
            for binding in match["names"].split(","):
                binding = binding.strip()
                if not binding:
                    continue
                parts = re.fullmatch(r"([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?", binding)
                if not parts:
                    raise BuildError(f"Unsupported import binding in {path.name}: {binding}")
                original, alias = parts.groups()
                names.append(f"{original}: {alias}" if alias else original)
            return f"const {{{', '.join(names)}}} = __coastalModules[{json.dumps(key)}];\n"

        result = IMPORT_RE.sub(replace, source)
        if re.search(r"^[ \t]*import\b", result, re.M):
            raise BuildError(f"Unsupported import form in {path.name}; use named imports.")
        return result

    def module(self, path: Path) -> str:
        key = path.relative_to(self.dist).as_posix()
        if path in self.modules:
            return key
        if path in self.pending:
            raise BuildError(f"Circular JS module import: {key}")
        self.pending.add(path)
        source = self.imports(path.read_text(encoding="utf-8-sig"), path)
        exports = []

        def remove_export(match):
            exports.append(match["name"])
            return match["indent"] + match["declaration"] + match["name"]

        source = EXPORT_RE.sub(remove_export, source)
        if re.search(r"^[ \t]*export\b", source, re.M):
            raise BuildError(f"Unsupported export form in {key}; use named declarations.")
        source = self.js_assets(source, path.parent)
        self.modules[path] = (
            f"__coastalModules[{json.dumps(key)}] = (() => {{\n"
            f"{source}\nreturn {{{', '.join(dict.fromkeys(exports))}}};\n}})();"
        )
        self.pending.remove(path)
        return key

    def app(self, path: Path) -> str:
        self.module_entries += 1
        if self.module_entries > 1:
            raise BuildError("This bundler expects one app module entry.")
        source = self.imports(path.read_text(encoding="utf-8-sig"), path)
        source = self.js_assets(source, path.parent)
        modules = "\n\n".join(self.modules.values())
        return (
            "(() => {\n'use strict';\nconst __coastalModules = Object.create(null);\n"
            + modules + "\n\n(() => {\n" + source + "\n})();\n})();\n"
        )

    def leaflet_icons(self) -> str:
        images = {
            "iconRetinaUrl": "vendor/images/marker-icon-2x.png",
            "iconUrl": "vendor/images/marker-icon.png",
            "shadowUrl": "vendor/images/marker-shadow.png",
        }
        values = {key: self.data_uri(value, self.dist) for key, value in images.items()}
        # Leaflet's CSS path detector does not recognize embedded data URLs.
        return (
            "\nif (globalThis.L?.Icon?.Default) {\n"
            "delete L.Icon.Default.prototype._getIconUrl;\n"
            f"L.Icon.Default.mergeOptions({json.dumps(values)});\n"
            "}\n"
        )

    def build(self) -> str:
        index = self.dist / "index.html"
        if not index.is_file():
            raise BuildError(f"Required file is missing: {index}")
        result = index.read_text(encoding="utf-8-sig")

        def link(match):
            tag = Tag(match[0])
            rel = (tag.get("rel") or "").lower().split()
            if "stylesheet" in rel:
                path = self.require_local(tag.get("href"), self.dist)
                media = tag.get("media")
                attr = f' media="{html.escape(media, quote=True)}"' if media else ""
                return f'<style data-bundled="{html.escape(path.name)}"{attr}>\n{escape_style(self.css(path))}\n</style>'
            if "icon" in rel or "apple-touch-icon" in rel:
                tag.set("href", self.data_uri(tag.get("href"), self.dist))
                return tag.render()
            return match[0]

        result = LINK_RE.sub(link, result)

        def image(match):
            tag = Tag(match[0])
            if tag.get("src"):
                tag.set("src", self.data_uri(tag.get("src"), self.dist))
            if tag.get("srcset"):
                raise BuildError("Inline image srcset assets explicitly before bundling.")
            return tag.render()

        result = IMAGE_RE.sub(image, result)

        def script(match):
            tag = Tag("<script" + match["attrs"] + ">")
            src = tag.get("src")
            if not src:
                if tag.get("type") == "module":
                    raise BuildError("Use a local src entry for the app module.")
                return match[0]
            path = self.require_local(src, self.dist)
            if tag.get("type") == "module":
                source = self.app(path)
            else:
                source = path.read_text(encoding="utf-8-sig")
                source = re.sub(r"(?m)^\s*//[#@]\s*sourceMappingURL=.*$", "", source)
                if path.name == "leaflet.js":
                    source += self.leaflet_icons()
            return f'<script data-bundled="{html.escape(path.name)}">\n{escape_script(source)}\n</script>'

        result = SCRIPT_RE.sub(script, result)
        if self.module_entries != 1:
            raise BuildError("No app module entry was found in dist/index.html.")
        # A relative directory link would leave the app when opened via file://.
        result = re.sub(r"\bhref=(['\"])\./\1", 'href="#"', result)
        note_script = (
            "(() => {\n"
            f"const text = {json.dumps(NETWORK_NOTE)};\n"
            "const explain = () => {\n"
            " const content = document.getElementById('modalContent');\n"
            " if (!content || content.querySelector('[data-portable-note]')) return;\n"
            " const note = document.createElement('p'); note.className = 'report-note';\n"
            " note.dataset.portableNote = 'true'; note.textContent = text; content.append(note);\n"
            "};\n"
            "for (const id of ['helpButton', 'scienceNav']) document.getElementById(id)?.addEventListener('click', explain);\n"
            "})();"
        )
        addition = (
            "\n<!-- " + html.escape(NETWORK_NOTE) + " -->\n"
            '<script data-bundled="portable-information">\n' + escape_script(note_script) + "\n</script>\n"
        )
        result = re.sub(r"</body\s*>", lambda _: addition + "</body>", result, count=1, flags=re.I)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "OPEN-COASTAL.html")
    args = parser.parse_args()
    try:
        bundler = Bundler(ROOT / "dist")
        content = bundler.build()
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(output.name + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(output)
    except (BuildError, OSError, UnicodeError) as error:
        print(f"COASTAL build failed: {error}", file=sys.stderr)
        return 1
    print(f"Built {output.name}: {output.stat().st_size:,} bytes; {len(bundler.modules)} modules; {len(bundler.assets)} embedded assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
