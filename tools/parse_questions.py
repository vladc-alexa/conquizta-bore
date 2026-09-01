#!/usr/bin/env python3
"""Parse ConQuizta game logs into clean questions for the DB.

Handles three log shapes (all seen in cq2.zip):

1. Free-text trivia (history files):
     [20:20:23] Q: Câte cărți conține Tora?
     [20:20:25] AI: 5  [local-ai (qwen2.5)]

2. Multiple-choice trivia (history files):
     [20:21:53] Q: StOne Costel AI limbajul de programare Rust?
     [20:21:53] OPTIONS: Ce companie a creat  |  Apple  |  Mozilla  |  Microsoft  |  Google
     [20:21:55] AI: Mozilla  [local-ai (qwen2.5)]
     (5+ OPTIONS segments -> first segment is the real question)

3. Bare answers (trivia_correct files):
     [09:15:38] CORRECT: 1968

Also handles the user's earlier pasted sample:
     [14:50:50] Q: TheRunner ecountry În ce an ...
     [14:50:50] CORRECT: 09,

Rules:
  - "Răspuns corect:" recap entries (Q + player-name OPTIONS + AI + CORRECT)
    are skipped entirely.
  - Player/mode prefixes before the question (TheRunner, ZUU, StOne, ... they
    vary) are stripped by picking the leftmost suffix that starts with an
    interrogative starter word; if none exists the line is kept whole and
    flagged.
  - AI: answer = chosen correct answer (trailing "[local-ai (...)]" removed).
  - For multiple-choice, the correct option is the one matching the AI answer.
  - CORRECT: lines in history files are player recaps -> ignored; in files
    with no Q lines they surface as orphan answers.

Usage:
  python3 tools/parse_questions.py file1.txt file2.txt ... [-o out.json]
  python3 tools/parse_questions.py /path/to/dir/*.txt -o questions.json
"""

import argparse
import json
import re
import sys
import unicodedata

KNOWN_PREFIXES = {
    "therunner", "runner", "ecountry", "egeo", "eistorie", "esport", "estiinta",
    "st0ne", "stone", "demo", "test", "zuu", "lancelbot", "costel", "ai",
}

# First word of a quiz question is (almost) always an interrogative.
# NOTE: "ai" is deliberately NOT here — it's a frequent player token ("Costel AI").
QUESTION_STARTERS = {
    "în", "in", "a", "cât", "câte", "câta", "câți", "câtă", "de", "care", "ce",
    "cum", "unde", "când", "cine", "al", "ale", "din", "pe", "la", "prin",
    "what", "when", "where", "who", "which", "how", "why", "whose", "whom",
    "the", "an", "at", "in", "on", "by", "for", "with", "limbajul",
}

COMMENT_WORDS = {
    "nașpa", "naspă", "naspa", "lol", "gg", "ok", "ok.", "haha", "hahaha",
    "bun", "bravo", "super", "👍", "😂", "🤣", "🔥", "💀", "👏",
}

AI_SUFFIX_RE = re.compile(r"\s*\[[^\[\]]+\]\s*$", re.I)

def strip_diacritics(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )

def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", strip_diacritics(s).lower()).strip()

def most_common(items: list[str]) -> str | None:
    """Majority vote across occurrences; ties -> first seen."""
    if not items:
        return None
    counts: dict[str, int] = {}
    order: list[str] = []
    for it in items:
        k = normalize(it)
        if k not in counts:
            counts[k] = 0
            order.append(k)
        counts[k] += 1
    best = max(order, key=lambda k: counts[k])
    return next(it for it in items if normalize(it) == best)

def parse_time(line: str) -> str:
    m = re.match(r"\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?", line)
    return m.group(1) if m else ""

def strip_timestamp(raw: str) -> str:
    return re.sub(r"^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*", "", raw.strip())

def clean_question(text: str, prefixes: set, starters: set) -> tuple[str, str]:
    """Strip leading player/mode tokens. Returns (question, stripped)."""
    text = re.sub(r"\s+", " ", text).strip()
    qi = text.rfind("?")
    if qi != -1:
        text = text[: qi + 1]
    words = text.split()
    # leftmost suffix whose first word is a starter (or a known prefix followed by one)
    for i in range(len(words)):
        w = words[i].strip(".,:;").lower()
        if w in starters:
            stripped = " ".join(words[:i])
            return " ".join(words[i:]), stripped
    # fallback: strip known prefixes only
    i = 0
    while i < len(words) and words[i].strip(".,:;").lower() in prefixes:
        i += 1
    if i > 0:
        return " ".join(words[i:]), " ".join(words[:i])
    return text, ""

def parse_answer_value(raw: str) -> str | None:
    """Extract the value from an 'AI:' or 'CORRECT:' line (sans comments/suffix)."""
    m = re.match(r"(?:AI|CORRECT):\s*(.*)$", strip_timestamp(raw), re.I)
    if not m:
        return None
    s = AI_SUFFIX_RE.sub("", m.group(1)).strip()
    # cut at the first comment word
    parts = []
    for w in s.split():
        if w.strip(".,;:!?").lower() in COMMENT_WORDS:
            break
        parts.append(w)
    val = " ".join(parts).strip().rstrip(",;:")
    return val or None

def parse_options(raw: str) -> list[str] | None:
    m = re.match(r"OPTIONS:\s*(.*)$", strip_timestamp(raw), re.I)
    if not m:
        return None
    segs = [s.strip() for s in m.group(1).split("|")]
    return [s for s in segs if s]

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("logfiles", nargs="+", help="log file path(s), or '-' for stdin")
    ap.add_argument("-o", "--out", help="write JSON here (default: stdout)")
    ap.add_argument("--prefixes", nargs="*", default=[], help="extra prefix tokens")
    ap.add_argument("--starters", nargs="*", default=[], help="extra question starter words")
    ap.add_argument("--include-orphans", action="store_true", help="include bare CORRECT answers")
    args = ap.parse_args()

    prefixes = KNOWN_PREFIXES | {p.lower() for p in args.prefixes}
    starters = QUESTION_STARTERS | {s.lower() for s in args.starters}

    questions: dict[str, dict] = {}
    order: list[str] = []
    orphans: list[dict] = []

    cur_norm = None
    cur_source = ""
    in_recap = False

    def finalize_current():
        nonlocal cur_norm
        if cur_norm is not None and cur_norm in questions:
            rec = questions[cur_norm]
            if rec.get("options"):
                ans = most_common(rec.get("all_answers") or [])
                idx = next((i for i, o in enumerate(rec["options"]) if normalize(o) == normalize(ans or "")), None)
                rec["correct_index"] = idx
                rec["answer"] = ans
            else:
                rec["answer"] = most_common(rec.get("all_answers") or [])
        cur_norm = None

    for path in args.logfiles:
        cur_norm = None
        in_recap = False
        src = sys.stdin if path == "-" else open(path, encoding="utf-8", errors="replace")
        for line in src:
            line = line.rstrip("\r\n")
            if not line.strip():
                continue
            t = parse_time(line)
            body = strip_timestamp(line)

            if re.match(r"Q:\s*Răspuns corect", body, re.I):
                # recap block (player names as options) — skip this and the
                # OPTIONS/AI/CORRECT lines until the next Q
                finalize_current()
                in_recap = True
                continue
            qm = re.match(r"Q:\s*(.*)$", body, re.I)
            if qm:
                finalize_current()
                in_recap = False
                raw_q = qm.group(1)
                q, stripped = clean_question(raw_q, prefixes, starters)
                if not q:
                    continue
                norm = normalize(q)
                if norm not in questions:
                    questions[norm] = {
                        "question": q,
                        "all_answers": [],
                        "options": None,
                        "correct_index": None,
                        "source": path,
                        "times": [],
                        "prefix_hits": [],
                        "note": "",
                    }
                    order.append(norm)
                cur_norm = norm
                cur_source = path
                if stripped:
                    questions[norm]["prefix_hits"].append(stripped)
                questions[norm]["times"].append(t)
                continue

            opts = parse_options(body)
            if opts is not None:
                # reject segments that are comments or answers, not options
                clean_opts = [s for s in opts if not any(w.strip(".,;:!?").lower() in COMMENT_WORDS for w in s.split())]
                if len(clean_opts) != len(opts):
                    opts = []
                if opts and len(opts) >= 5 and cur_norm and cur_norm in questions and not in_recap:
                    q = opts[0]
                    questions[cur_norm]["question"] = q
                    questions[cur_norm]["note"] = (questions[cur_norm]["note"] + "; " if questions[cur_norm]["note"] else "") + "întrebarea din linia OPTIONS"
                    opts = opts[1:]
                if opts and cur_norm and cur_norm in questions and not in_recap and len(opts) >= 3:
                    questions[cur_norm]["options"] = opts[:4]
                continue

            a = parse_answer_value(body)
            if a is not None and not in_recap:
                if re.match(r"(?:AI|CORRECT):", body, re.I):
                    if cur_norm and cur_norm in questions and questions[cur_norm]["times"]:
                        # answer belongs to the current question
                        rec = questions[cur_norm]
                        if a not in rec["all_answers"]:
                            rec["all_answers"].append(a)
                    else:
                        orphans.append({"answer": a, "time": t, "source": path})
        if path != "-":
            src.close()

    finalize_current()

    out = []
    for norm in order:
        rec = questions[norm]
        if not rec["all_answers"]:
            rec["note"] = (rec["note"] + "; " if rec["note"] else "") + "fără răspuns"
            rec["answer"] = None
        else:
            rec["answer"] = rec["all_answers"][0]
        out.append(rec)

    result = {"questions": out, "orphan_answers": orphans if args.include_orphans else []}
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
