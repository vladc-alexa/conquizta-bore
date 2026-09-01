"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

const NUMBER_SET = [1, 2, 1990, 6500, 100, 8848, 1959, 2500, 10, 1000000];
const TOP_KEY = 'conquizta_bore_top';
const MY_NAME_KEY = 'conquizta_bore_myname';
const TOP_MAX = 200;

interface Question {
  q: string;
  a: number;
}

interface ScoreEntry {
  correct: number;
  total: number;
  time: number;
  name: string;
}

export default function Home() {
  const [gameStarted, setGameStarted] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [totalTime, setTotalTime] = useState(0);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'correct' | 'wrong' | null, elapsed: number, val: number | null }>({ type: null, elapsed: 0, val: null });
  const [rank, setRank] = useState<number | null>(null);
  const [topList, setTopList] = useState<ScoreEntry[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<'current' | 'random'>('current');

  const timerStart = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const generateBoreName = () => 'Bore' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');

  const loadTop = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(TOP_KEY) || '[]');
    } catch {
      return [];
    }
  }, []);

  const compareEntries = (a: ScoreEntry, b: ScoreEntry) => {
    const aRate = a.correct / a.total;
    const bRate = b.correct / b.total;
    if (bRate !== aRate) return bRate - aRate;
    return (a.time / a.total) - (b.time / b.total);
  };

  const updateTopList = useCallback((highlightRank?: number | null) => {
    const top = loadTop().slice(0, 30);
    setTopList(top);
  }, [loadTop]);

  useEffect(() => {
    updateTopList();
    const savedName = localStorage.getItem(MY_NAME_KEY) || '';
    setNameInput(savedName);
  }, [updateTopList]);

  const startQuiz = () => {
    const qs: Question[] = [];
    for (let i = 0; i < count; i++) {
      const x = mode === 'random'
        ? Math.floor(Math.random() * 10000)
        : NUMBER_SET[i % NUMBER_SET.length];
      qs.push({ q: `Scrie repede numărul ${x}`, a: x });
    }
    setQuestions(qs);
    setCurrent(0);
    setCorrect(0);
    setWrong(0);
    setTotalTime(0);
    setAnswered(false);
    setQuizFinished(false);
    setGameStarted(true);
    setScoreSubmitted(false);
    setRank(null);
    setFeedback({ type: null, elapsed: 0, val: null });
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
    timerStart.current = performance.now();
  };

  const submitAnswer = () => {
    if (answered || !gameStarted || quizFinished) return;
    const val = parseInt(inputValue.trim(), 10);
    if (isNaN(val) || val < -1000000 || val > 1000000) return;

    const elapsed = (performance.now() - timerStart.current) / 1000;
    setTotalTime(prev => prev + elapsed);
    setAnswered(true);

    const isCorrect = val === questions[current].a;
    if (isCorrect) {
      setCorrect(prev => prev + 1);
      setFeedback({ type: 'correct', elapsed, val });
    } else {
      setWrong(prev => prev + 1);
      setFeedback({ type: 'wrong', elapsed, val });
    }

    if (current + 1 === questions.length) {
      setTimeout(() => {
        setQuizFinished(true);
        setGameStarted(false);
      }, 600);
    }
  };

  const nextQuestion = () => {
    setCurrent(prev => prev + 1);
    setAnswered(false);
    setFeedback({ type: null, elapsed: 0, val: null });
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
    timerStart.current = performance.now();
  };

  const handleScoreSubmit = (autoName?: string) => {
    if (scoreSubmitted) return;
    let name = '';
    if (autoName) {
      name = autoName;
    } else {
      const inputVal = nameInput.trim().toUpperCase().slice(0, 5);
      const savedName = localStorage.getItem(MY_NAME_KEY) || '';
      if (inputVal === '') {
        name = generateBoreName();
      } else {
        if (inputVal !== savedName) {
          const top = loadTop();
          if (top.some((e: ScoreEntry) => e.name?.toUpperCase() === inputVal)) {
            setNameError('Numele există deja în top! Alege altul.');
            return;
          }
        }
        name = inputVal;
        localStorage.setItem(MY_NAME_KEY, name);
      }
    }

    const top = loadTop();
    const entry = { correct, total: questions.length, time: totalTime, name };
    top.push(entry);
    top.sort(compareEntries);
    const newRank = top.indexOf(entry) + 1;
    const trimmed = top.slice(0, TOP_MAX);
    localStorage.setItem(TOP_KEY, JSON.stringify(trimmed));

    setScoreSubmitted(true);
    setRank(newRank <= TOP_MAX ? newRank : null);
    updateTopList(newRank);
  };

  return (
    <div className="flex flex-wrap gap-2.5 items-start justify-center">
      <div id="card" className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-[520px] p-7 flex flex-col gap-[18px]">
        
        {/* Progress */}
        {(gameStarted || quizFinished) && (
          <div className="flex items-center gap-2.5 text-[0.8rem] color-[#c8a070]">
            <span className="min-w-[40px] text-[#c8a070]">{current + (answered || quizFinished ? 1 : 0)} / {questions.length}</span>
            <div className="flex-1 h-1.5 bg-[#1a0e05] rounded-[3px] overflow-hidden border border-[#7a4e2240]">
              <div className="h-full bg-gradient-to-r from-[#c87030] to-[#f5c97a] transition-all duration-400" 
                   style={{ width: `${((current + (answered || quizFinished ? 1 : 0)) / questions.length) * 100}%` }}></div>
            </div>
          </div>
        )}

        {/* Score Bar */}
        {(gameStarted || quizFinished) && (
          <div className="flex justify-between text-[0.8rem] text-[#a07848] px-1">
            <div>Corecte: <span className="text-[#f5c97a] font-bold">{correct}</span></div>
            <div>Greșite: <span className="text-[#f5c97a] font-bold">{wrong}</span></div>
            <div>Total: <span className="text-[#f5c97a] font-bold">{questions.length}</span></div>
          </div>
        )}

        {!gameStarted && !quizFinished && (
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2 items-center">
              <label htmlFor="count-select">Întrebări:</label>
              <select id="count-select" className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-1 px-2.5 outline-none cursor-pointer"
                      value={count} onChange={e => setCount(parseInt(e.target.value))}>
                <option value="10">10</option>
                <option value="20">20</option>
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <label>Set întrebări:</label>
              <label className="flex items-center gap-1"><input type="radio" name="mode" value="current" checked={mode === 'current'} onChange={() => setMode('current')} /> Curent</label>
              <label className="flex items-center gap-1"><input type="radio" name="mode" value="random" checked={mode === 'random'} onChange={() => setMode('random')} /> Aleator</label>
            </div>
            <button onClick={startQuiz} className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-2.5 cursor-pointer">Start</button>
          </div>
        )}

        {gameStarted && (
          <div className="w-full max-w-[420px] mx-auto flex flex-col gap-4">
            <p className="font-cinzel text-[1.1rem] text-center min-h-[60px]">{questions[current]?.q}</p>
            
            {answered && (
              <div className="flex justify-center items-center gap-3 text-[0.85rem] text-[#c8a070]">
                <span>Răspuns corect:</span>
                <div className="border-2 border-[#f5c97a] rounded-lg py-1.5 px-5 font-cinzel text-[1.2rem] text-[#f5c97a]">{questions[current]?.a}</div>
              </div>
            )}

            <div className="flex gap-2">
              <input ref={inputRef} type="number" value={inputValue} onChange={e => setInputValue(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && !answered && submitAnswer()}
                     disabled={answered} placeholder="Răspuns…" 
                     className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] text-[1.3rem] text-center p-2.5 outline-none focus:border-[#c87030] disabled:opacity-50" />
              <button onClick={submitAnswer} disabled={answered || !inputValue.trim()}
                      className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel px-[18px] hover:brightness-110 active:translate-y-px disabled:opacity-40">
                Trimite
              </button>
            </div>

            {feedback.type && (
              <div className={`rounded-xl p-3.5 flex flex-col gap-2 text-center border-2 ${feedback.type === 'correct' ? 'bg-green-900/25 border-green-500/40' : 'bg-red-900/25 border-red-500/40'}`}>
                <div className="text-2xl">{feedback.type === 'correct' ? '✔' : '✖'}</div>
                <div className="font-cinzel">{feedback.type === 'correct' ? 'Corect!' : 'Greșit!'}</div>
                <div className="text-[0.85rem] text-[#d0b888]">
                  {feedback.type === 'wrong' && `Răspunsul tău: ${feedback.val} · `}
                  Timp: {feedback.elapsed.toFixed(2).replace('.', ',')} sec
                </div>
              </div>
            )}

            {answered && current + 1 < questions.length && (
              <button onClick={nextQuestion} className="bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-125">
                Următoarea întrebare ›
              </button>
            )}
          </div>
        )}

        {quizFinished && (
          <div className="flex flex-col gap-4 text-center">
            <h2 className="font-cinzel text-[#f5c97a] text-[1.4rem]">🏆 Terminat!</h2>
            <div className="text-[0.95rem] leading-[1.8] text-[#d0c090]">
              Răspunsuri corecte: <strong>{correct} / {questions.length}</strong> ({Math.round((correct / questions.length) * 100)}%)<br/>
              Răspunsuri greșite: <strong>{wrong}</strong><br/>
              Timp total: <strong>{totalTime.toFixed(2).replace('.', ',')} sec</strong><br/>
              Timp mediu / întrebare: <strong>{(totalTime / questions.length).toFixed(2).replace('.', ',')} sec</strong>
            </div>

            {!scoreSubmitted && (
              <div className="flex flex-col gap-2 text-left">
                <div className="text-[0.82rem] text-[#c8a070]">Adaugă-ți numele în top (opțional, max 5 caractere):</div>
                <div className="flex gap-2">
                  <input type="text" maxLength={5} placeholder="Nume…" value={nameInput} onChange={e => setNameInput(e.target.value.toUpperCase())}
                         className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] font-cinzel p-1 px-2 w-[76px] outline-none uppercase tracking-widest focus:border-[#c87030]" />
                  <button onClick={() => handleScoreSubmit()} className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel px-3.5 hover:brightness-110">OK</button>
                </div>
                {nameError && <div className="text-red-500 text-[0.78rem]">{nameError}</div>}
              </div>
            )}

            {rank && (
              <div className="font-cinzel text-[1.05rem] text-[#f5c97a] bg-[#c8703026] border border-[#c87030a0] rounded-lg p-2.5 px-3.5">
                Ești pe poziția {rank} în top 200! ({localStorage.getItem(MY_NAME_KEY)})
              </div>
            )}

            <button onClick={() => { setQuizFinished(false); if(!scoreSubmitted) handleScoreSubmit(generateBoreName()); }} 
                    className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-125">
              Reîncepe
            </button>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-[210px] p-4 flex flex-col gap-1.5">
        <h3 className="font-cinzel text-[#f5c97a] text-[0.85rem] text-center tracking-widest pb-1.5 border-b border-[#7a4e2260] mb-0.5">Top 30</h3>
        <div className="flex flex-col">
          {topList.length === 0 ? (
            <div className="text-[#a07848] text-[0.75rem] text-center p-2">Niciun rezultat</div>
          ) : (
            topList.map((entry, i) => (
              <div key={i} className="grid grid-cols-[18px_1fr_auto_auto] gap-1 text-[0.72rem] p-1 px-1 rounded text-[#d0c090] items-center odd:bg-white/5">
                <span className="text-[#a07848] text-[0.68rem]">{i + 1}</span>
                <span className="font-cinzel tracking-tighter truncate">{entry.name}</span>
                <span className="text-[#f5c97a] font-bold">{entry.correct}/{entry.total}</span>
                <span className="text-[#c8a070] text-right">{(entry.time / entry.total).toFixed(1)}s</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
