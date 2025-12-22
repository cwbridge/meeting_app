import React, { useState, useRef, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, query, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { 
  Mic, Square, FileText, Download, Loader2, CheckCircle2, 
  AlertCircle, Clock, Volume2, Trash2, Edit3, Save, 
  Plus, X, Undo2, History, Star, Search, ChevronRight,
  User, LayoutDashboard, Settings, Users, Share2, Upload, 
  FileAudio, Folder, FolderPlus, MoreVertical, FolderOpen,
  ArrowLeft, Move, Filter
} from 'lucide-react';

// --- Configuration Recovery ---
// Safety helper to avoid "process is not defined" ReferenceErrors
const getSafeEnv = (key) => {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch (e) {
    // Fallback if process access is restricted
  }
  return undefined;
};

const rawConfig = getSafeEnv('REACT_APP_FIREBASE_CONFIG');
const rawAiKey = getSafeEnv('REACT_APP_GEMINI_API_KEY');

const getFirebaseConfig = () => {
  if (!rawConfig) return null;
  
  // CASE 1: Build tool injected it as an Object Literal
  if (typeof rawConfig === 'object' && rawConfig !== null) {
    return rawConfig;
  }

  // CASE 2: Build tool injected it as a String (Standard JSON)
  if (typeof rawConfig === 'string') {
    try {
      let cleaned = rawConfig.trim();
      
      // Remove surrounding double-quotes if the build tool wrapped the JSON in quotes
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      
      // Handle escaped quotes
      cleaned = cleaned.replace(/\\"/g, '"');
      
      return JSON.parse(cleaned);
    } catch (e) {
      // Emergency Manual Extraction if JSON.parse fails
      try {
        const extract = (key) => {
          const match = rawConfig.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
          return match ? match[1] : null;
        };
        const fallback = {
          apiKey: extract("apiKey"),
          authDomain: extract("authDomain"),
          projectId: extract("projectId"),
          storageBucket: extract("storageBucket"),
          messagingSenderId: extract("messagingSenderId"),
          appId: extract("appId")
        };
        if (fallback.apiKey && fallback.projectId) return fallback;
      } catch (err) {
        return null;
      }
    }
  }
  return null;
};

const firebaseConfig = getFirebaseConfig();
const apiKey = rawAiKey || ""; 
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const appId = "meeting-notes-pro-v5";

// Initialize services only if config exists
let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.error("Firebase Initialization Error:", e);
  }
}

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard'); 
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [history, setHistory] = useState([]);
  const [folders, setFolders] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Input State
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [bookmarks, setBookmarks] = useState([]);
  
  // AI/Edit State
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [editBuffer, setEditBuffer] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);
  const [speakerMap, setSpeakerMap] = useState({});

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const fileInputRef = useRef(null);

  // Debug Logs
  useEffect(() => {
    console.log("--- Meeting Pro Debug Status ---");
    console.log("Raw Config Type:", typeof rawConfig);
    console.log("Firebase Config Object Valid:", !!firebaseConfig);
    console.log("Gemini API Key Detected:", !!rawAiKey);
  }, []);

  // Error Guard for missing Environment Variables
  if (!firebaseConfig || !firebaseConfig.apiKey || !apiKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-red-50 max-w-xl w-full">
          <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={40} />
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">Configuration Error</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">
            The app is connected to Vercel, but the security keys are still not being parsed correctly.
          </p>
          
          <div className="grid grid-cols-1 gap-3 mb-8 text-left">
             <div className={`p-4 rounded-2xl border flex flex-col gap-1 ${rawConfig ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest font-mono">Firebase Config</span>
                    {firebaseConfig ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertCircle size={18}/>}
                </div>
                {!firebaseConfig && rawConfig && (
                    <div className="mt-2 p-2 bg-white/50 rounded text-[10px] font-mono break-all border border-amber-200">
                      Format: {typeof rawConfig} | Start: {String(rawConfig).substring(0, 15)}...
                    </div>
                )}
             </div>
             <div className={`p-4 rounded-2xl border flex items-center justify-between ${rawAiKey ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <span className="text-xs font-bold uppercase tracking-widest font-mono">Gemini API Key</span>
                {rawAiKey ? <CheckCircle2 size={18}/> : <X size={18}/>}
             </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 text-left text-xs text-indigo-800 mb-8">
            <p className="font-bold mb-2">Final Attempt Strategy:</p>
            <ol className="list-decimal ml-4 space-y-2">
                <li>Delete <strong>REACT_APP_FIREBASE_CONFIG</strong> from Vercel.</li>
                <li>Add it again using <strong>exactly</strong> the single-line string provided previously.</li>
                <li>Ensure there are <strong>NO spaces</strong> at the very end of the line.</li>
                <li><strong>Redeploy</strong> in Vercel with <strong>Build Cache DISABLED</strong>.</li>
            </ol>
          </div>

          <a href="https://vercel.com" target="_blank" rel="noreferrer" className="w-full inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-2xl font-black shadow-lg shadow-indigo-100 transition-all">
            Open Vercel Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Auth & Cloud Sync
  useEffect(() => {
    if (auth) {
        signInAnonymously(auth).catch(err => {
            console.error("Auth Error:", err);
            setError("Firebase connection failed.");
        });
        return onAuthStateChanged(auth, setUser);
    }
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const qM = collection(db, 'artifacts', appId, 'users', user.uid, 'meetings');
    const unsubM = onSnapshot(qM, (s) => setHistory(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.timestamp - a.timestamp)));
    const qF = collection(db, 'artifacts', appId, 'users', user.uid, 'folders');
    const unsubF = onSnapshot(qF, (s) => setFolders(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name))));
    const sRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile');
    const unsubS = onSnapshot(sRef, (d) => d.exists() && setSpeakerMap(d.data().speakerMap || {}));
    return () => { unsubM(); unsubF(); unsubS(); };
  }, [user]);

  // Recording Logic
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      setBookmarks([]);
      setUploadedFile(null);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyserRef.current = audioCtx.createAnalyser();
      source.connect(analyserRef.current);
      drawVisualizer();
      mediaRecorderRef.current.ondataavailable = e => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        setAudioBlob(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setError(null);
    } catch (err) { setError("Mic access denied."); }
  };

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);
      analyserRef.current.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.fillStyle = '#6366f1';
      for(let i=0; i<60; i++) {
        const h = (data[i] / 255) * canvasRef.current.height;
        ctx.fillRect(i * 6, canvasRef.current.height - h, 4, h);
      }
    };
    render();
  };

  const processInput = async () => {
    const source = audioBlob || uploadedFile;
    if (!source) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.readAsDataURL(source);
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1];
      const mimeType = source.type || "audio/mpeg";
      const prompt = `Transcribe meeting JSON: { "title": "", "summary": "", "keyPoints": [], "actionItems": [{"owner": "", "task": ""}], "transcript": "" }`;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });
        const result = await res.json();
        const data = JSON.parse(result.candidates[0].content.parts[0].text);
        const meetingData = { 
            ...data, 
            timestamp: Date.now(), 
            duration: uploadedFile ? 0 : recordingDuration, 
            folderId: activeFolderId === 'all' ? 'unorganized' : (activeFolderId || 'unorganized'),
            sourceType: uploadedFile ? 'upload' : 'record'
        };
        const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'meetings'), meetingData);
        setCurrentMeeting({ id: docRef.id, ...meetingData });
        setEditBuffer({ ...meetingData });
        setView('detail');
      } catch (err) { setError("AI Analysis failed."); }
      setIsProcessing(false);
    };
  };

  const filteredHistory = useMemo(() => {
    let base = history;
    if (activeFolderId !== 'all') {
      base = history.filter(m => activeFolderId ? m.folderId === activeFolderId : (m.folderId === 'unorganized' || !m.folderId));
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      base = base.filter(m => m.title.toLowerCase().includes(q) || m.summary?.toLowerCase().includes(q));
    }
    return base;
  }, [history, activeFolderId, searchTerm]);

  const formatTime = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
  const resolveSpeaker = (text) => {
    if (!text) return text;
    let r = text;
    Object.entries(speakerMap).forEach(([id, name]) => { if(name) r = r.replace(new RegExp(id, 'gi'), name); });
    return r;
  };

  if (!user) return <div className="flex h-screen items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-indigo-600" /></div>;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-sm"><LayoutDashboard size={18} /></div>
            <h1 className="font-bold text-lg tracking-tight">Meeting Pro</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs font-bold">
            <nav className="space-y-1">
                <button onClick={() => { setActiveFolderId('all'); setView('dashboard'); }} className={`w-full text-left px-3 py-2 rounded-lg ${activeFolderId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>All Meetings</button>
                <button onClick={() => { setActiveFolderId(null); setView('dashboard'); }} className={`w-full text-left px-3 py-2 rounded-lg ${activeFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>Unorganized</button>
            </nav>
            <section>
                <div className="flex items-center justify-between px-3 mb-2">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Folders</h2>
                    <button onClick={() => { const n = prompt("Name:"); if(n) addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'folders'), { name: n, timestamp: Date.now() }); }} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded transition-colors"><Plus size={14} /></button>
                </div>
                <div className="space-y-1">
                    {folders.map(f => (
                        <div key={f.id} className="group relative">
                            <button onClick={() => { setActiveFolderId(f.id); setView('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg ${activeFolderId === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><Folder size={14}/><span className="truncate pr-4">{f.name}</span></button>
                            <button onClick={(e) => { e.stopPropagation(); if(confirm("Delete folder?")) deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'folders', f.id)); }} className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all"><X size={12}/></button>
                        </div>
                    ))}
                </div>
            </section>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0">
            <div className="flex items-center gap-4 flex-1">
                {view !== 'dashboard' && <button onClick={() => setView('dashboard')} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400"><ArrowLeft size={18}/></button>}
                <div className="relative w-full max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 rounded-full py-2 pl-10 pr-4 text-xs outline-none" />
                </div>
            </div>
            <button onClick={() => setView('record')} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md">+ New</button>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredHistory.map(m => (
                        <div key={m.id} onClick={() => { setCurrentMeeting(m); setEditBuffer(m); setView('detail'); }} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-all">
                            <h3 className="font-bold text-slate-800 line-clamp-1">{m.title}</h3>
                            <div className="text-[10px] text-slate-400 mt-2 font-bold uppercase">{new Date(m.timestamp).toLocaleDateString()} • {formatTime(m.duration)}</div>
                        </div>
                    ))}
                    {filteredHistory.length === 0 && <div className="col-span-full py-20 text-center text-slate-300 italic text-sm font-medium">No meetings found.</div>}
                </div>
            ) : view === 'record' ? (
                <div className="max-w-xl mx-auto py-12 text-center bg-white p-12 rounded-[3rem] shadow-xl">
                    {isRecording ? (
                        <div className="space-y-8">
                            <div className="text-8xl font-black text-slate-800 tabular-nums">{formatTime(recordingDuration)}</div>
                            <canvas ref={canvasRef} width={400} height={80} className="w-full h-20 opacity-30 mx-auto" />
                            <button onClick={() => mediaRecorderRef.current.stop()} className="px-12 py-5 bg-red-500 text-white rounded-3xl font-black text-xl shadow-xl">Stop</button>
                        </div>
                    ) : (audioBlob || uploadedFile) ? (
                        <div className="space-y-6">
                            <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={40} /></div>
                            <h2 className="text-3xl font-black text-slate-900">Audio Ready</h2>
                            <button onClick={processInput} disabled={isProcessing} className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-black text-lg shadow-xl">{isProcessing ? "Analyzing..." : "Analyze Audio"}</button>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <button onClick={startRecording} className="w-full py-8 bg-indigo-600 text-white rounded-[2rem] font-bold text-xl">Start Recording</button>
                            <input type="file" ref={fileInputRef} onChange={e => { setUploadedFile(e.target.files[0]); setAudioBlob(null); }} className="hidden" />
                            <button onClick={() => fileInputRef.current.click()} className="w-full py-8 bg-slate-100 text-slate-600 rounded-[2rem] font-bold text-xl border-2 border-dashed border-slate-200">Upload File</button>
                        </div>
                    )}
                    {error && <div className="mt-4 text-red-500 text-xs font-bold uppercase tracking-widest">{error}</div>}
                </div>
            ) : (
                <div className="max-w-4xl mx-auto bg-white p-12 rounded-[3rem] shadow-sm border border-slate-100">
                    <h1 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">{currentMeeting?.title}</h1>
                    <p className="text-xl text-slate-700 leading-relaxed font-medium mb-10">{resolveSpeaker(currentMeeting?.summary)}</p>
                    <div className="bg-slate-50 p-8 rounded-[2rem] text-slate-600 leading-loose text-sm font-mono max-h-[500px] overflow-y-auto border border-slate-100 whitespace-pre-wrap">{resolveSpeaker(currentMeeting?.transcript)}</div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;
