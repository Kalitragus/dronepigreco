import ast
import json
from pathlib import Path

DEFAULT_DESCRIPTION = "Returns the value of π and related utilities"
ROOT = Path(__file__).parent
MAIN_PATH = ROOT / "main.py"
META_PATH = ROOT / "meta.json"


def extract_pigreco_docstring(source_path: Path) -> str:
    """Return the docstring for pigreco() if present, else default text."""
    try:
        module = ast.parse(source_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return DEFAULT_DESCRIPTION

    for node in module.body:
        if isinstance(node, ast.FunctionDef) and node.name == "pigreco":
            doc = ast.get_docstring(node)
            if doc and doc.strip():
                return doc.strip()
            break
    return DEFAULT_DESCRIPTION


def build_meta():
    description = extract_pigreco_docstring(MAIN_PATH)
    data = {"main_functions": {"pigreco": description}}
    META_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {META_PATH}")


if __name__ == "__main__":
    build_meta()
