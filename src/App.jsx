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
const getFirebaseConfig = () => {
  try {
    const config = process.env.REACT_APP_FIREBASE_CONFIG;
    return config ? JSON.parse(config) : null;
  } catch (e) {
    console.error("Failed to parse Firebase Config:", e);
    return null;
  }
};

const firebaseConfig = getFirebaseConfig();
const apiKey = process.env.REACT_APP_GEMINI_API_KEY || ""; 
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const appId = "meeting-notes-pro-v5";

// Initialize services only if config exists
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

  // Error Guard for missing Environment Variables
  if (!firebaseConfig || !firebaseConfig.apiKey || !apiKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md">
          <AlertCircle className="text-red-500 w-16 h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Configuration Missing</h1>
          <p className="text-slate-500 mb-6">
            The application is missing its API keys. Please ensure you have added 
            <code className="bg-slate-100 px-1 rounded">REACT_APP_FIREBASE_CONFIG</code> and 
            <code className="bg-slate-100 px-1 rounded">REACT_APP_GEMINI_API_KEY</code> to your Vercel Environment Variables.
          </p>
          <a 
            href="https://vercel.com" 
            target="_blank" 
            className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold shadow-lg"
          >
            Go to Vercel Settings
          </a>
        </div>
      </div>
    );
  }

  useEffect(() => {
    signInAnonymously(auth).catch(err => {
        console.error("Auth Error:", err);
        setError("Failed to connect to the cloud. Check your Firebase settings.");
    });
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
      setBookmarks([]);
      setUploadedFile(null);
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
        const meetingData = { 
          ...data, 
          timestamp: Date.now(), 
          duration: uploadedFile ? 0 : recordingDuration, 
          folderId: 'unorganized', 
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
    if (activeFolderId !== 'all') base = base.filter(m => activeFolderId ? m.folderId === activeFolderId : (m.folderId === 'unorganized' || !m.folderId));
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      base = base.filter(m => m.title.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q));
    }
    return base;
  }, [history, activeFolderId, searchTerm]);

  const formatTime = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
  const resolveSpeaker = (t) => {
    let r = t;
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
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <nav className="space-y-1">
                <button onClick={() => { setActiveFolderId('all'); setView('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all ${activeFolderId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><LayoutDashboard size={16} /> All Meetings</button>
                <button onClick={() => { setActiveFolderId(null); setView('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all ${activeFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><Folder size={16} /> Unorganized</button>
            </nav>
            <section>
                <div className="flex items-center justify-between px-3 mb-2">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Folders</h2>
                    <button onClick={() => { const n = prompt("Name:"); if(n) addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'folders'), { name: n, timestamp: Date.now() }); }} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded transition-colors"><Plus size={14} /></button>
                </div>
                <div className="space-y-1">
                    {folders.map(f => (
                        <div key={f.id} className="group relative">
                            <button onClick={() => { setActiveFolderId(f.id); setView('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all ${activeFolderId === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><Folder size={16} className={activeFolderId === f.id ? 'fill-indigo-500' : ''} /><span className="truncate pr-4">{f.name}</span></button>
                            <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'folders', f.id)); }} className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all"><X size={12}/></button>
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
                {view === 'dashboard' ? (
                  <div className="relative w-full max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-full py-2 pl-10 pr-4 text-xs outline-none" />
                  </div>
                ) : <h2 className="text-sm font-bold text-slate-700">{currentMeeting?.title || 'Processing...'}</h2>}
            </div>
            <button onClick={() => setView('record')} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md">+ New Session</button>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredHistory.map(m => (
                        <div key={m.id} onClick={() => { setCurrentMeeting(m); setEditBuffer(m); setView('detail'); }} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-all">
                            <h3 className="font-bold text-slate-800 line-clamp-1">{m.title}</h3>
                            <div className="text-[10px] text-slate-400 mt-2 font-bold uppercase">{new Date(m.timestamp).toLocaleDateString()} • {formatTime(m.duration)}</div>
                        </div>
                    ))}
                    {filteredHistory.length === 0 && <div className="col-span-full py-20 text-center text-slate-400 italic">No meetings found. Start a new session to begin.</div>}
                </div>
            ) : view === 'record' ? (
                <div className="max-w-xl mx-auto py-12 text-center bg-white p-12 rounded-[3rem] shadow-xl">
                    {isRecording ? (
                        <div className="space-y-8">
                            <div className="text-6xl font-black tabular-nums">{formatTime(recordingDuration)}</div>
                            <canvas ref={canvasRef} width={400} height={80} className="w-full h-20 opacity-30" />
                            <button onClick={() => mediaRecorderRef.current.stop()} className="px-12 py-4 bg-red-500 text-white rounded-full font-bold">Stop</button>
                        </div>
                    ) : (audioBlob || uploadedFile) ? (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-black">Audio Captured</h2>
                            <button onClick={processInput} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold">{isProcessing ? "Analyzing..." : "Analyze Audio"}</button>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <button onClick={startRecording} className="w-full py-8 bg-indigo-600 text-white rounded-[2rem] font-bold text-xl">Start Recording</button>
                            <input type="file" ref={fileInputRef} onChange={e => { setUploadedFile(e.target.files[0]); setAudioBlob(null); }} className="hidden" />
                            <button onClick={() => fileInputRef.current.click()} className="w-full py-8 bg-slate-100 text-slate-600 rounded-[2rem] font-bold text-xl border-2 border-dashed border-slate-200">Upload File</button>
                        </div>
                    )}
                    {error && <div className="mt-4 text-red-500 text-sm font-bold">{error}</div>}
                </div>
            ) : (
                <div className="max-w-4xl mx-auto bg-white p-10 rounded-[2.5rem] shadow-sm">
                    <h1 className="text-3xl font-black mb-6">{currentMeeting?.title}</h1>
                    <p className="text-slate-600 leading-relaxed mb-8">{resolveSpeaker(currentMeeting?.summary)}</p>
                    <div className="bg-slate-50 p-6 rounded-2xl font-mono text-xs whitespace-pre-wrap max-h-96 overflow-y-auto">{resolveSpeaker(currentMeeting?.transcript)}</div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;
