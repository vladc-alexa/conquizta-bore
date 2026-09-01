#!/usr/bin/env python3
"""Sanitize ConQuizta chat/game log lines into clean questions for the DB.

Log line formats seen in the wild:
  [14:50:50] Q: TheRunner ecountry În ce an Clujul a ajuns sub coroana maghiară prin Dictatul de la Viena?
  [14:50:50] CORRECT: 09,
  [14:50:53] CORRECT: oana maghiara
  [14:51:09] CORRECT: 5   Nașpa
  [17:19:42] CORRECT: 1845

Rules applied:
  - Q lines: drop leading mode/category/username tokens (KNOWN_PREFIXES),
    keep the text up to the last '?'.
  - CORRECT lines: keep the answer, cut at the first comment word (Nașpa etc.),
    strip trailing punctuation (", 09," -> "09").
  - Group answers by normalized question; prefer the first non-empty answer.
  - Flag questions with no usable answer for manual review.

Usage:
  python3 tools/parse_questions.py <logfile> [-o out.json] [--prefixes A B]
  cat log.txt | python3 tools/parse_questions.py -
"""

import argparse
import json
import re
import sys
import unicodedata

KNOWN_PREFIXES = {
    "therunner", "runner", "ecountry", "egeo", "eistorie", "esport", "estiinta",
    "st0ne", "stone", "demo", "test",
}

# First word of a quiz question is (almost) always an interrogative —
# strip leading player/mode tokens until we hit one of these.
QUESTION_STARTERS = {
    "în", "in", "a", "cât", "câte", "câta", "câți", "câtă", "de", "care", "ce",
    "cum", "unde", "când", "cine", "al", "ai", "ale", "din", "pe", "la", "prin",
    "what", "when", "where", "who", "which", "how", "why", "whose", "whom",
    "the", "an", "at", "in", "on", "by", "for", "with",
}

COMMENT_WORDS = {
    "nașpa", "naspă", "naspa", "lol", "gg", "ok", "ok.", "haha", "hahaha",
    "bun", "bravo", "super", "👍", "😂", "🤣", "🔥", "💀", "👏",
}

def strip_diacritics(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )

def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", strip_diacritics(s).lower()).strip()

def parse_time(line: str) -> str:
    m = re.match(r"\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?", line)
    return m.group(1) if m else ""

def strip_timestamp(raw: str) -> str:
    return re.sub(r"^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*", "", raw.strip())

def parse_question(raw: str, prefixes: set, starters: set) -> tuple[str | None, str]:
    """Return (question, stripped_prefix). question is None for non-Q lines."""
    m = re.match(r"Q:\s*(.*)$", strip_timestamp(raw), re.I)
    if not m:
        return None, ""
    text = m.group(1).strip()
    qi = text.rfind("?")
    if qi != -1:
        text = text[: qi + 1]
    # strip leading tokens (player/mode/category names — they vary) until we
    # reach a question starter (interrogative word); also drop KNOWN_PREFIXES.
    stripped = ""
    parts = text.split(None, 2)
    while parts and (
        parts[0].strip(".,:;").lower() in prefixes
        or parts[0].strip(".,:;").lower() not in starters
    ):
        stripped += parts[0] + " "
        text = text[len(parts[0]) :].lstrip()
        parts = text.split(None, 2)
        if not parts:
            break
    text = re.sub(r"\s+", " ", text).strip()
    return (text or None), stripped.strip()

def parse_answer(raw: str) -> tuple[str | None, str]:
    """Return (answer, comment). answer=None when only a comment was logged."""
    m = re.match(r"CORRECT:\s*(.*)$", strip_timestamp(raw), re.I)
    if not m:
        return None, ""
    s = m.group(1).strip()
    answer_parts: list[str] = []
    for w in s.split():
        if w.strip(".,;:!?").lower() in COMMENT_WORDS:
            break
        answer_parts.append(w)
    answer = " ".join(answer_parts).strip().rstrip(",;:")
    comment = s[len(" ".join(answer_parts)) :].strip() if answer_parts else s
    return (answer or None), comment

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("logfiles", nargs="+", help="path(s) to log file(s), or '-' for stdin")
    ap.add_argument("-o", "--out", help="write JSON here (default: stdout)")
    ap.add_argument("--prefixes", nargs="*", default=[], help="extra known prefix tokens to strip")
    ap.add_argument("--starters", nargs="*", default=[], help="extra question starter words")
    args = ap.parse_args()

    prefixes = KNOWN_PREFIXES | {p.lower() for p in args.prefixes}
    starters = QUESTION_STARTERS | {s.lower() for s in args.starters}

    questions: dict[str, dict] = {}  # normalized -> record
    order: list[str] = []
    current_q_norm = None

    for path in args.logfiles:
        src = sys.stdin if path == "-" else open(path, encoding="utf-8", errors="replace")
        for line in src:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            t = parse_time(line)
            q, stripped_prefix = parse_question(line, prefixes, starters)
            if q:
                norm = normalize(q)
                if norm not in questions:
                    questions[norm] = {
                        "question": q,
                        "answers": [],
                        "times": [],
                        "prefix_hits": [],
                        "note": "",
                    }
                    order.append(norm)
                current_q_norm = norm
                # record which leading tokens were stripped, for review
                if stripped_prefix:
                    questions[norm]["prefix_hits"].append(stripped_prefix)
                questions[norm]["times"].append(t)
                continue
            a, comment = parse_answer(line)
            if a is not None:
                if current_q_norm and current_q_norm in questions:
                    questions[current_q_norm]["answers"].append(a)
                else:
                    # answer without a preceding question in this file
                    key = f"__orphan:{len(order)}"
                    questions[key] = {"question": None, "answers": [a], "times": [t], "prefix_hits": [], "note": "answer fără întrebare în acest fișier"}
                    order.append(key)
        if path != "-":
            src.close()

    out = []
    for norm in order:
        rec = questions[norm]
        answers = rec.pop("answers")
        rec["all_answers"] = answers
        if not answers:
            rec["note"] = (rec["note"] + "; " if rec["note"] else "") + "fără răspuns (doar comentariu)"
            rec["answer"] = None
        else:
            # prefer a numeric answer; else first
            numeric = [a for a in answers if re.fullmatch(r"-?\d[\d\s,.]*", a)]
            rec["answer"] = (numeric or answers)[0]
        out.append(rec)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
