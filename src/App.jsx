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

// --- Production Configuration ---
const rawConfig = process.env.REACT_APP_FIREBASE_CONFIG;
const apiKey = process.env.REACT_APP_GEMINI_API_KEY || ""; 
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const appId = "meeting-notes-pro-prod";

const getFirebaseConfig = () => {
  if (!rawConfig) return null;
  try {
    if (typeof rawConfig === 'object') return rawConfig;
    let cleaned = rawConfig.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.substring(1, cleaned.length - 1);
    return JSON.parse(cleaned);
  } catch (e) {
    return null;
  }
};

const firebaseConfig = getFirebaseConfig();

// Initialize services
let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard'); 
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [history, setHistory] = useState([]);
  const [folders, setFolders] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [bookmarks, setBookmarks] = useState([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [editBuffer, setEditBuffer] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);
  const [speakerMap, setSpeakerMap] = useState({});

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const fileInputRef = useRef(null);

  // Configuration Check UI
  if (!firebaseConfig || !apiKey) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md text-center">
          <AlertCircle className="text-red-500 w-12 h-12 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Configuration Missing</h1>
          <p className="text-slate-500 text-sm mb-6">Environment variables are not detected. Check your Netlify Site Settings.</p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    return onAuthStateChanged(auth, setUser);
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
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyserRef.current = audioCtx.createAnalyser();
      source.connect(analyserRef.current);
      
      const draw = () => {
        animationFrameRef.current = requestAnimationFrame(draw);
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const ctx = canvasRef.current?.getContext('2d');
        if(!ctx) return;
        ctx.clearRect(0,0,400,80);
        ctx.fillStyle = '#6366f1';
        for(let i=0; i<60; i++) ctx.fillRect(i*6, 80 - (data[i]/255)*80, 4, (data[i]/255)*80);
      };
      draw();

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

  const processInput = async () => {
    const src = audioBlob || uploadedFile;
    if (!src) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.readAsDataURL(src);
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1];
      const prompt = `Transcribe meeting JSON: { "title": "", "summary": "", "keyPoints": [], "actionItems": [{"owner": "", "task": ""}], "transcript": "" }`;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: src.type || "audio/mpeg", data: base64 } }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });
        const result = await res.json();
        const data = JSON.parse(result.candidates[0].content.parts[0].text);
        const meetingData = { ...data, timestamp: Date.now(), duration: uploadedFile ? 0 : recordingDuration, folderId: 'unorganized', sourceType: uploadedFile ? 'upload' : 'record' };
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
    if (activeFolderId !== 'all') base = base.filter(m => activeFolderId ? m.folderId === activeFolderId : (m.folderId === 'unorganized' || !m.folderId));
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      base = base.filter(m => m.title.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q));
    }
    return base;
  }, [history, activeFolderId, searchTerm]);

  const formatTime = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;

  if (!user) return <div className="flex h-screen items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-indigo-600" /></div>;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden text-sm">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
            <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-sm"><LayoutDashboard size={16} /></div>
            <h1 className="font-bold text-base tracking-tight text-slate-800">Meeting Pro</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-bold text-slate-500">
            <nav className="space-y-1">
                <button onClick={() => { setActiveFolderId('all'); setView('dashboard'); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${activeFolderId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}><LayoutDashboard size={14} /> All</button>
                <button onClick={() => { setActiveFolderId(null); setView('dashboard'); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${activeFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}><Folder size={14} /> Unsorted</button>
            </nav>
            <div className="space-y-1">
                <div className="px-3 text-[10px] uppercase text-slate-400">Folders</div>
                {folders.map(f => (
                    <button key={f.id} onClick={() => { setActiveFolderId(f.id); setView('dashboard'); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg truncate ${activeFolderId === f.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}><Folder size={14} /> {f.name}</button>
                ))}
            </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0">
            <div className="flex items-center gap-4 flex-1">
                {view !== 'dashboard' && <button onClick={() => setView('dashboard')} className="p-2 hover:bg-slate-50 rounded-lg"><ArrowLeft size={16}/></button>}
                {view === 'dashboard' && <div className="relative w-full max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} /><input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border-none rounded-full py-1.5 pl-10 pr-4 text-xs outline-none" /></div>}
            </div>
            <button onClick={() => setView('record')} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md">+ New</button>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredHistory.map(m => (
                        <div key={m.id} onClick={() => { setCurrentMeeting(m); setEditBuffer(m); setView('detail'); }} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-all">
                            <h3 className="font-bold text-slate-800 line-clamp-1">{m.title}</h3>
                            <div className="text-[10px] text-slate-400 mt-2 font-bold">{new Date(m.timestamp).toLocaleDateString()} • {formatTime(m.duration)}</div>
                        </div>
                    ))}
                </div>
            ) : view === 'record' ? (
                <div className="max-w-md mx-auto py-12 text-center bg-white p-10 rounded-[2.5rem] shadow-xl border border-slate-50">
                    {isRecording ? (
                        <div className="space-y-6">
                            <div className="text-6xl font-black text-slate-800">{formatTime(recordingDuration)}</div>
                            <canvas ref={canvasRef} width={400} height={80} className="w-full h-20 opacity-30" />
                            <button onClick={() => mediaRecorderRef.current.stop()} className="px-12 py-3 bg-red-500 text-white rounded-full font-bold">Stop</button>
                        </div>
                    ) : (audioBlob || uploadedFile) ? (
                        <div className="space-y-4">
                            <h2 className="text-xl font-bold">Audio Captured</h2>
                            <button onClick={processInput} disabled={isProcessing} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg">{isProcessing ? "Analyzing..." : "Run AI Analysis"}</button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <button onClick={startRecording} className="w-full py-10 bg-indigo-600 text-white rounded-[2rem] font-bold text-xl">Record Live</button>
                            <button onClick={() => fileInputRef.current.click()} className="w-full py-10 bg-slate-50 text-slate-500 rounded-[2rem] font-bold text-xl border-2 border-dashed border-slate-200">Upload File</button>
                            <input type="file" ref={fileInputRef} onChange={e => { setUploadedFile(e.target.files[0]); setAudioBlob(null); }} className="hidden" />
                        </div>
                    )}
                    {error && <div className="mt-4 text-red-500 text-xs font-bold uppercase">{error}</div>}
                </div>
            ) : (
                <div className="max-w-4xl mx-auto bg-white p-10 rounded-[2.5rem] border border-slate-50 shadow-sm">
                    <h1 className="text-3xl font-black text-slate-900 mb-6">{currentMeeting?.title}</h1>
                    <p className="text-lg text-slate-600 leading-relaxed mb-8">{currentMeeting?.summary}</p>
                    <div className="bg-slate-50 p-6 rounded-2xl font-mono text-xs whitespace-pre-wrap leading-loose max-h-96 overflow-y-auto">{currentMeeting?.transcript}</div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;
