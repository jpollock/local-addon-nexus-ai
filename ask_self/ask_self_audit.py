"""Preflight repo audit: capture metadata for the ask-self index.

All metrics are approximate and labeled as such. LOC is `wc -l`-style (counts
blanks + comments). Stack detection is heuristic from manifests + extensions.
"""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXT_TO_LANG: dict[str, str] = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".php": "PHP",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".md": "Markdown",
    ".txt": "Text",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".css": "CSS",
    ".scss": "SCSS",
    ".html": "HTML",
    ".sql": "SQL",
}


_ALWAYS_EXCLUDE = re.compile(
    r"(?:^|/)\.git/"
    r"|(?:^|/)node_modules/"
    r"|(?:^|/)\.venv[^/]*/"
    r"|(?:^|/)__pycache__/"
    r"|(?:^|/)\.next/"
    r"|(?:^|/)\.cache/"
    r"|(?:^|/)dist/"
    r"|(?:^|/)build/"
    r"|(?:^|/)coverage/"
    r"|(?:^|/)\.DS_Store$"
    r"|\.lock$"
    r"|(?:^|/)package-lock\.json$"
    r"|(?:^|/)composer\.lock$"
    r"|(?:^|/)yarn\.lock$"
    r"|(?:^|/)pnpm-lock\.yaml$"
)


def _compile(patterns: list[str] | tuple[str, ...] | None) -> list[re.Pattern[str]]:
    if not patterns:
        return []
    return [re.compile(p) for p in patterns]


def _walk_repo(repo_root: Path, exclude: list[re.Pattern[str]]) -> list[Path]:
    """Walk repo files honoring exclude patterns (matches against POSIX rel path).

    `_ALWAYS_EXCLUDE` strips ubiquitous junk dirs (.git, node_modules, .venv*,
    __pycache__, dist/build/coverage, lock files) regardless of harness config —
    a contributor's ad-hoc venv shouldn't pollute repo counts.
    """
    out: list[Path] = []
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(repo_root).as_posix()
        if _ALWAYS_EXCLUDE.search(rel):
            continue
        if any(rx.search(rel) for rx in exclude):
            continue
        out.append(path)
    return out


def count_files_and_loc(
    repo_root: Path,
    exclude_patterns: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Count files and line counts grouped by language."""
    exclude = _compile(exclude_patterns)
    files = _walk_repo(repo_root, exclude)

    by_lang: dict[str, dict[str, int]] = {}
    total_files = 0
    total_loc = 0
    total_bytes = 0

    for f in files:
        ext = f.suffix.lower()
        lang = EXT_TO_LANG.get(ext, "Other")
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeError):
            continue
        loc = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
        size = len(text.encode("utf-8", errors="replace"))

        bucket = by_lang.setdefault(lang, {"files": 0, "loc": 0, "bytes": 0})
        bucket["files"] += 1
        bucket["loc"] += loc
        bucket["bytes"] += size
        total_files += 1
        total_loc += loc
        total_bytes += size

    sorted_langs = dict(
        sorted(by_lang.items(), key=lambda kv: kv[1]["loc"], reverse=True)
    )
    return {
        "total_files": total_files,
        "total_loc": total_loc,
        "total_bytes": total_bytes,
        "by_language": sorted_langs,
        "_estimated": True,
        "_note": "LOC includes blank lines and comments; counts respect harness excludes",
    }


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return None


def detect_stack(repo_root: Path) -> dict[str, Any]:
    """Heuristic stack detection from manifests and well-known files."""
    stack: dict[str, Any] = {
        "languages": [],
        "frameworks": [],
        "build_tools": [],
        "test_frameworks": [],
        "package_managers": [],
        "_estimated": True,
    }

    pkg = _read_json(repo_root / "package.json")
    if pkg:
        stack["package_managers"].append("npm")
        stack["languages"].append("JavaScript")
        deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
        if "typescript" in deps or (repo_root / "tsconfig.json").is_file():
            stack["languages"].append("TypeScript")
            stack["build_tools"].append("tsc")
        for name, label in (
            ("react", "React"),
            ("next", "Next.js"),
            ("vue", "Vue"),
            ("@angular/core", "Angular"),
            ("electron", "Electron"),
            ("express", "Express"),
            ("fastify", "Fastify"),
            ("@anthropic-ai/sdk", "Anthropic SDK"),
            ("openai", "OpenAI SDK"),
            ("better-sqlite3", "better-sqlite3"),
            ("@lancedb/lancedb", "LanceDB"),
        ):
            if name in deps:
                stack["frameworks"].append(label)
        for name, label in (
            ("jest", "Jest"),
            ("vitest", "Vitest"),
            ("mocha", "Mocha"),
            ("@playwright/test", "Playwright"),
            ("cypress", "Cypress"),
        ):
            if name in deps:
                stack["test_frameworks"].append(label)
        if "webpack" in deps:
            stack["build_tools"].append("Webpack")
        if "vite" in deps:
            stack["build_tools"].append("Vite")
        if "esbuild" in deps:
            stack["build_tools"].append("esbuild")
        stack["package"] = {
            "name": pkg.get("name"),
            "version": pkg.get("version"),
            "description": pkg.get("description"),
            "main": pkg.get("main"),
            "license": pkg.get("license"),
            "scripts": list((pkg.get("scripts") or {}).keys()),
            "top_dependencies": list(deps.keys())[:25],
        }

    composer = _read_json(repo_root / "composer.json")
    if composer:
        stack["package_managers"].append("composer")
        stack["languages"].append("PHP")
        stack["composer"] = {
            "name": composer.get("name"),
            "description": composer.get("description"),
            "require": list((composer.get("require") or {}).keys()),
        }

    if (repo_root / "pyproject.toml").is_file() or (repo_root / "requirements.txt").is_file():
        stack["package_managers"].append("pip")
        stack["languages"].append("Python")

    if any((repo_root / name).is_file() for name in ("Cargo.toml",)):
        stack["package_managers"].append("cargo")
        stack["languages"].append("Rust")

    if any((repo_root / name).is_file() for name in ("go.mod",)):
        stack["package_managers"].append("go modules")
        stack["languages"].append("Go")

    for k in ("languages", "frameworks", "build_tools", "test_frameworks", "package_managers"):
        seen: set[str] = set()
        stack[k] = [x for x in stack[k] if not (x in seen or seen.add(x))]

    return stack


def _run_git(repo_root: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def git_state(repo_root: Path) -> dict[str, Any]:
    """Capture git branch/commit/remote state. Empty dict if not a git repo."""
    if not (repo_root / ".git").exists():
        return {"is_git": False}

    branch = _run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    head_sha = _run_git(repo_root, "rev-parse", "HEAD")
    last_commit_at = _run_git(repo_root, "log", "-1", "--format=%cI")
    last_commit_msg = _run_git(repo_root, "log", "-1", "--format=%s")
    last_commit_author = _run_git(repo_root, "log", "-1", "--format=%an")
    remote_url = _run_git(repo_root, "config", "--get", "remote.origin.url")
    status = _run_git(repo_root, "status", "--porcelain")
    dirty_count = len([ln for ln in (status or "").splitlines() if ln.strip()])
    commit_count_30d = _run_git(repo_root, "rev-list", "--count", "--since=30.days", "HEAD")

    return {
        "is_git": True,
        "branch": branch,
        "head_sha": head_sha,
        "head_sha_short": head_sha[:7] if head_sha else None,
        "last_commit_at": last_commit_at,
        "last_commit_message": last_commit_msg,
        "last_commit_author": last_commit_author,
        "remote_url": remote_url,
        "working_tree_clean": dirty_count == 0,
        "dirty_file_count": dirty_count,
        "commits_last_30_days": int(commit_count_30d) if commit_count_30d and commit_count_30d.isdigit() else None,
    }


def top_level_layout(repo_root: Path, exclude_patterns: list[str] | tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    """Return top-level directories with rough file counts."""
    exclude = _compile(exclude_patterns)
    out: list[dict[str, Any]] = []
    for entry in sorted(repo_root.iterdir()):
        if not entry.is_dir():
            continue
        rel = entry.name + "/"
        if _ALWAYS_EXCLUDE.search(rel):
            continue
        if any(rx.search(rel) for rx in exclude):
            continue
        if entry.name.startswith("."):
            continue
        try:
            file_count = sum(
                1 for f in entry.rglob("*")
                if f.is_file() and not _ALWAYS_EXCLUDE.search(f.relative_to(repo_root).as_posix())
            )
        except OSError:
            file_count = 0
        out.append({"name": entry.name, "approx_file_count": file_count})
    return out


def read_readme_excerpt(repo_root: Path, max_chars: int = 600) -> str | None:
    for name in ("README.md", "README.rst", "README.txt", "README"):
        path = repo_root / name
        if path.is_file():
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            return text[:max_chars].strip() or None
    return None


def audit_repo(
    repo_root: Path,
    *,
    harness_config: dict[str, Any] | None = None,
    excludes: list[str] | None = None,
) -> dict[str, Any]:
    """Run the full audit. Returns a JSON-serializable dict."""
    if excludes is None and harness_config is not None:
        docs = harness_config.get("docs") or {}
        source = harness_config.get("source") or {}
        merged: list[str] = []
        for section in (docs, source):
            for p in (section.get("exclude_patterns") or []):
                if p not in merged:
                    merged.append(p)
        excludes = merged

    counts = count_files_and_loc(repo_root, exclude_patterns=excludes)
    stack = detect_stack(repo_root)
    git = git_state(repo_root)
    layout = top_level_layout(repo_root, exclude_patterns=excludes)
    readme = read_readme_excerpt(repo_root)

    return {
        "audited_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "repo_root": str(repo_root),
        "counts": counts,
        "stack": stack,
        "git": git,
        "top_level_layout": layout,
        "readme_excerpt": readme,
    }


def build_overview_text(
    audit: dict[str, Any],
    *,
    repo_label: str,
    embed_model: str,
    embed_dim: int,
    total_chunks: int | None = None,
    by_source: dict[str, int] | None = None,
) -> str:
    """Build the synthetic overview chunk that gets embedded for retrieval."""
    counts = audit.get("counts") or {}
    stack = audit.get("stack") or {}
    git = audit.get("git") or {}
    layout = audit.get("top_level_layout") or []
    pkg = stack.get("package") or {}

    lines: list[str] = []
    lines.append(f"# {repo_label} — Repo Overview (estimated)")
    lines.append("")
    if pkg.get("description"):
        lines.append(pkg["description"])
        lines.append("")
    if audit.get("readme_excerpt"):
        lines.append("## README excerpt")
        lines.append(audit["readme_excerpt"])
        lines.append("")

    lines.append("## Scale (approximate)")
    lines.append(f"- Files indexed in repo: ~{counts.get('total_files', 0):,}")
    lines.append(f"- Total lines of code: ~{counts.get('total_loc', 0):,}")
    by_lang = counts.get("by_language") or {}
    if by_lang:
        lines.append("- By language:")
        for lang, info in list(by_lang.items())[:8]:
            lines.append(
                f"  - {lang}: {info.get('files', 0):,} files, "
                f"{info.get('loc', 0):,} LOC"
            )
    lines.append("")

    lines.append("## Stack (heuristic)")
    if stack.get("languages"):
        lines.append(f"- Languages: {', '.join(stack['languages'])}")
    if stack.get("frameworks"):
        lines.append(f"- Frameworks: {', '.join(stack['frameworks'])}")
    if stack.get("test_frameworks"):
        lines.append(f"- Test: {', '.join(stack['test_frameworks'])}")
    if stack.get("build_tools"):
        lines.append(f"- Build: {', '.join(stack['build_tools'])}")
    if pkg.get("name"):
        lines.append(f"- Package: {pkg['name']} v{pkg.get('version', '?')}")
    if pkg.get("scripts"):
        lines.append(f"- npm scripts: {', '.join(pkg['scripts'][:10])}")
    lines.append("")

    if git.get("is_git"):
        lines.append("## Git state at ingestion")
        lines.append(f"- Branch: {git.get('branch')}")
        lines.append(f"- HEAD: {git.get('head_sha_short')} ({git.get('last_commit_at')})")
        if git.get("last_commit_message"):
            lines.append(f"- Last commit: {git['last_commit_message']}")
        wt = "clean" if git.get("working_tree_clean") else f"dirty ({git.get('dirty_file_count', 0)} files)"
        lines.append(f"- Working tree: {wt}")
        if git.get("commits_last_30_days") is not None:
            lines.append(f"- Commits last 30 days: {git['commits_last_30_days']}")
        lines.append("")

    if layout:
        lines.append("## Top-level layout")
        for entry in layout[:20]:
            lines.append(f"- {entry['name']}/ (~{entry['approx_file_count']} files)")
        lines.append("")

    lines.append("## Index meta")
    lines.append(f"- Audited at: {audit.get('audited_at')}")
    lines.append(f"- Embed model: {embed_model} (dim={embed_dim})")
    if total_chunks is not None:
        lines.append(f"- Total indexed chunks: {total_chunks}")
    if by_source:
        breakdown = ", ".join(f"{k}={v}" for k, v in sorted(by_source.items(), key=lambda x: -x[1]))
        lines.append(f"- Chunks by source: {breakdown}")
    lines.append("")
    lines.append("_All counts are approximate. LOC includes blank/comment lines; stack is inferred from manifests + file extensions._")

    return "\n".join(lines)
