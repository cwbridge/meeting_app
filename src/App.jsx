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

// --- Production Configuration Recovery ---
const rawConfig = process.env.REACT_APP_FIREBASE_CONFIG;
const rawAiKey = process.env.REACT_APP_GEMINI_API_KEY;

const getFirebaseConfig = () => {
  if (!rawConfig) return null;
  try {
    if (typeof rawConfig === 'object') return rawConfig;
    let cleaned = rawConfig.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.substring(1, cleaned.length - 1);
    cleaned = cleaned.replace(/\\"/g, '"');
    return JSON.parse(cleaned);
  } catch (e) {
    // Fallback extraction
    try {
      const extract = (key) => {
        const match = String(rawConfig).match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
        return match ? match[1] : null;
      };
      return {
        apiKey: extract("apiKey"),
        authDomain: extract("authDomain"),
        projectId: extract("projectId"),
        storageBucket: extract("storageBucket"),
        messagingSenderId: extract("messagingSenderId"),
        appId: extract("appId")
      };
    } catch (err) { return null; }
  }
};

const firebaseConfig = getFirebaseConfig();
const apiKey = rawAiKey || ""; 
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const appId = "meeting-notes-pro-prod";

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
  const [authError, setAuthError] = useState(null);
  const [speakerMap, setSpeakerMap] = useState({});

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const fileInputRef = useRef(null);

  // Authentication logic
  useEffect(() => {
    if (auth) {
      signInAnonymously(auth).catch(err => {
        if (err.code === 'auth/configuration-not-found') setAuthError(true);
      });
      return onAuthStateChanged(auth, setUser);
    }
  }, []);

  // Fetch data logic
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
      const prompt = `Transcribe meeting JSON: { "title": "", "summary": "", "keyPoints": [], "actionItems": [{"owner": "", "task": ""}], "transcript": "" }`;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: source.type || "audio/mpeg", data: base64 } }] }],
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

  if (!firebaseConfig || !apiKey) return <div className="flex h-screen items-center justify-center bg-slate-50 font-bold text-red-500">Config Missing in Netlify</div>;
  if (authError) return <div className="flex h-screen items-center justify-center bg-slate-50 font-bold text-amber-600 p-8 text-center">Anonymous Auth is disabled in Firebase Console.</div>;
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
                <button onClick={() => { setActiveFolderId('all'); setView('dashboard'); }} className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 ${activeFolderId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><LayoutDashboard size={14}/> All Meetings</button>
                <button onClick={() => { setActiveFolderId(null); setView('dashboard'); }} className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 ${activeFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><Folder size={14}/> Unorganized</button>
            </nav>
            <section>
                <div className="flex items-center justify-between px-3 mb-2">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Folders</h2>
                    <button onClick={() => { const n = prompt("Name:"); if(n) addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'folders'), { name: n, timestamp: Date.now() }); }} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded transition-colors"><Plus size={14} /></button>
                </div>
                <div className="space-y-1">
                    {folders.map(f => (
                        <div key={f.id} className="group relative">
                            <button onClick={() => { setActiveFolderId(f.id); setView('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold ${activeFolderId === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><Folder size={14} className={activeFolderId === f.id ? 'fill-indigo-500' : ''}/><span className="truncate pr-4">{f.name}</span></button>
                            <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'folders', f.id)); }} className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all"><X size={12}/></button>
                        </div>
                    ))}
                </div>
            </section>
        </div>
        <div className="p-4 border-t border-slate-100 flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black">{user?.uid.slice(0,2).toUpperCase()}</div>
            <div className="text-[10px] font-bold text-slate-400">Personal Vault</div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0">
            <div className="flex items-center gap-4 flex-1">
                {view !== 'dashboard' && <button onClick={() => setView('dashboard')} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400"><ArrowLeft size={18}/></button>}
                <div className="relative w-full max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                    <input type="text" placeholder="Search sessions..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 rounded-full py-2 pl-10 pr-4 text-xs outline-none focus:bg-white focus:ring-4 ring-indigo-50 transition-all" />
                </div>
            </div>
            <button onClick={() => setView('record')} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-indigo-700 transition-all">+ New Session</button>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' ? (
                <div className="max-w-6xl mx-auto space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredHistory.map(m => (
                            <div key={m.id} onClick={() => { setCurrentMeeting(m); setEditBuffer(m); setView('detail'); }} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-all group relative">
                                <div className={`w-10 h-10 rounded-xl mb-4 flex items-center justify-center ${m.sourceType === 'upload' ? 'bg-slate-50 text-slate-400' : 'bg-indigo-50 text-indigo-500'}`}>
                                  {m.sourceType === 'upload' ? <FileAudio size={18}/> : <Mic size={18}/>}
                                </div>
                                <h3 className="font-bold text-slate-800 line-clamp-2 mb-2">{m.title}</h3>
                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{new Date(m.timestamp).toLocaleDateString()} • {formatTime(m.duration)}</div>
                                <button onClick={(e) => { e.stopPropagation(); if(confirm("Delete?")) deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'meetings', m.id)); }} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-slate-200 hover:text-red-500 transition-all"><Trash2 size={14}/></button>
                            </div>
                        ))}
                        {filteredHistory.length === 0 && <div className="col-span-full py-20 text-center text-slate-300 italic font-medium">No sessions found in this view.</div>}
                    </div>
                </div>
            ) : view === 'record' ? (
                <div className="max-w-2xl mx-auto py-12 text-center bg-white p-12 rounded-[3rem] shadow-xl">
                    {isRecording ? (
                        <div className="space-y-8">
                            <div className="text-8xl font-black text-slate-800 tabular-nums">{formatTime(recordingDuration)}</div>
                            <canvas ref={canvasRef} width={400} height={80} className="w-full h-20 opacity-30 mx-auto" />
                            <button onClick={() => mediaRecorderRef.current.stop()} className="px-12 py-5 bg-red-500 text-white rounded-3xl font-black text-xl shadow-xl hover:bg-red-600 transition-all">Stop Recording</button>
                        </div>
                    ) : (audioBlob || uploadedFile) ? (
                        <div className="space-y-6">
                            <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={40} /></div>
                            <h2 className="text-3xl font-black text-slate-900">Audio Ready</h2>
                            <button onClick={processInput} disabled={isProcessing} className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-black text-lg shadow-xl hover:bg-indigo-700 flex items-center justify-center gap-3">
                                {isProcessing ? <><Loader2 className="animate-spin" /> Analyzing...</> : <><FileText /> Run AI Analysis</>}
                            </button>
                            <button onClick={() => {setAudioBlob(null); setUploadedFile(null);}} className="text-slate-400 text-xs font-bold hover:text-slate-600 uppercase tracking-widest">Discard</button>
                        </div>
                    ) : (
                        <div className="space-y-12">
                            <div className="space-y-4">
                                <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-[2rem] flex items-center justify-center mx-auto"><Mic size={48} /></div>
                                <h2 className="text-4xl font-black text-slate-900 tracking-tight">New Session</h2>
                                <p className="text-slate-400 max-w-sm mx-auto leading-relaxed text-sm">Transcribe, identify speakers, and summarize instantly.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <button onClick={startRecording} className="p-10 bg-indigo-600 text-white rounded-[2.5rem] shadow-xl hover:scale-[1.02] transition-all text-left">
                                    <h3 className="text-2xl font-black mb-1">Record</h3>
                                    <p className="text-indigo-200 text-xs font-bold uppercase tracking-widest">Live Capture</p>
                                </button>
                                <div onClick={() => fileInputRef.current.click()} className="p-10 bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] hover:border-indigo-400 hover:bg-slate-50 transition-all text-left cursor-pointer group">
                                    <h3 className="text-2xl font-black text-slate-800 mb-1">Upload</h3>
                                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Audio Files</p>
                                    <input type="file" ref={fileInputRef} onChange={e => { setUploadedFile(e.target.files[0]); setAudioBlob(null); }} accept="audio/*" className="hidden" />
                                </div>
                            </div>
                        </div>
                    )}
                    {error && <div className="mt-4 text-red-500 text-xs font-bold uppercase tracking-widest">{error}</div>}
                </div>
            ) : (
                <div className="max-w-5xl mx-auto space-y-8 pb-32">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button onClick={() => setView('dashboard')} className="p-2 hover:bg-white rounded-lg text-slate-300 hover:text-indigo-600 transition-all"><Undo2 size={20}/></button>
                            <h2 className="text-2xl font-black text-slate-900">Session Analysis</h2>
                        </div>
                        <div className="flex gap-2">
                             <select 
                                value={currentMeeting?.folderId || 'unorganized'}
                                onChange={(e) => {
                                  const fid = e.target.value;
                                  updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'meetings', currentMeeting.id), { folderId: fid });
                                  setCurrentMeeting({...currentMeeting, folderId: fid});
                                }}
                                className="bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl outline-none shadow-sm"
                            >
                                <option value="unorganized">Unorganized</option>
                                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            <button onClick={() => setIsEditing(!isEditing)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-50 flex items-center gap-2">
                              {isEditing ? <><Save size={14}/> Save</> : <><Edit3 size={14}/> Edit</>}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-8">
                            <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-slate-100">
                                {isEditing ? (
                                    <input className="text-4xl font-black text-slate-900 mb-6 w-full border-b pb-2 outline-none focus:border-indigo-400" value={editBuffer.title} onChange={e => setEditBuffer({...editBuffer, title: e.target.value})} />
                                ) : (
                                    <h1 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">{currentMeeting?.title}</h1>
                                )}

                                <div className="flex items-center gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-10 pb-6 border-b border-slate-50">
                                    <span className="flex items-center gap-2"><Clock size={12}/> {new Date(currentMeeting?.timestamp).toLocaleDateString()}</span>
                                    <span className="flex items-center gap-2"><Volume2 size={12}/> {formatTime(currentMeeting?.duration)}</span>
                                </div>

                                <section className="mb-12">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-4">Summary</h4>
                                    {isEditing ? (
                                        <textarea className="w-full bg-slate-50 p-6 rounded-2xl text-slate-700 outline-none border border-slate-100" rows={5} value={editBuffer.summary} onChange={e => setEditBuffer({...editBuffer, summary: e.target.value})} />
                                    ) : (
                                        <p className="text-lg text-slate-700 leading-relaxed font-medium">{resolveSpeaker(currentMeeting?.summary)}</p>
                                    )}
                                </section>

                                <section>
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-4">Transcript</h4>
                                    <div className="bg-slate-50 rounded-2xl p-8 text-slate-600 leading-loose text-xs font-mono max-h-[400px] overflow-y-auto border border-slate-100 whitespace-pre-wrap">
                                        {resolveSpeaker(currentMeeting?.transcript)}
                                    </div>
                                </section>
                            </div>
                        </div>

                        <div className="space-y-8">
                            <section className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-6 flex items-center gap-2"><Users size={14} /> Participants</h4>
                                <div className="space-y-4">
                                    {(currentMeeting?.transcript?.match(/Speaker \d+/g) || []).filter((v,i,a) => a.indexOf(v)===i).map(sId => (
                                        <div key={sId} className="space-y-1">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase">{sId}</label>
                                            <input className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-xs font-bold" placeholder="Identify name..." value={speakerMap[sId] || ''} onChange={e => {
                                                const nm = {...speakerMap, [sId]: e.target.value};
                                                setSpeakerMap(nm);
                                                setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile'), { speakerMap: nm });
                                            }} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                            <section className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-6">Action Items</h4>
                                <div className="space-y-3">
                                    {currentMeeting?.actionItems.map((a, i) => (
                                        <div key={i} className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                                            <div className="text-[10px] font-black text-indigo-600 uppercase mb-1">{resolveSpeaker(a.owner)}</div>
                                            <div className="text-xs text-slate-700 font-bold">{a.task}</div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;
