import React, { useState, useRef, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  updateDoc 
} from 'firebase/firestore';
import { 
  Mic, FileText, Loader2, CheckCircle2, 
  AlertCircle, Clock, Volume2, Trash2, Edit3, Save, 
  Plus, X, Undo2, History, Star, Search,
  LayoutDashboard, Folder, ArrowLeft, Users, FileAudio
} from 'lucide-react';

/**
 * PRODUCTION CONFIGURATION
 * These values must be set in your Netlify Environment Variables.
 */
const getFirebaseConfig = () => {
  const raw = process.env.REACT_APP_FIREBASE_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse Firebase Config env variable");
    return null;
  }
};

const firebaseConfig = getFirebaseConfig();
const apiKey = process.env.REACT_APP_GEMINI_API_KEY || "";
const appId = process.env.REACT_APP_ID || "meeting-notes-pro-prod";
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";

// Initialize Firebase only if config exists
let app, auth, db;
if (firebaseConfig) {
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
  const [error, setError] = useState(null);
  
  // AI/Edit State
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [editBuffer, setEditBuffer] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [speakerMap, setSpeakerMap] = useState({});

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);

  // Auth Initialization
  useEffect(() => {
    if (!auth) return;
    signInAnonymously(auth).catch(err => console.error("Auth failed:", err));
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Data Sync
  useEffect(() => {
    if (!user || !db) return;

    const meetingsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'meetings');
    const unsubM = onSnapshot(meetingsRef, (s) => {
      const data = s.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistory(data.sort((a,b) => b.timestamp - a.timestamp));
    });

    const foldersRef = collection(db, 'artifacts', appId, 'users', user.uid, 'folders');
    const unsubF = onSnapshot(foldersRef, (s) => {
      const data = s.docs.map(d => ({ id: d.id, ...d.data() }));
      setFolders(data.sort((a,b) => a.name.localeCompare(b.name)));
    });

    const sRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile');
    const unsubS = onSnapshot(sRef, (d) => {
      if (d.exists()) setSpeakerMap(d.data().speakerMap || {});
    });

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
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      setUploadedFile(null);
      setAudioBlob(null);
      setError(null);
      
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyserRef.current = audioCtx.createAnalyser();
      source.connect(analyserRef.current);
      drawVisualizer();

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Create the final blob
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        
        // Critical: Update state so UI switches out of recording mode
        setIsRecording(false);
        
        // Stop all hardware tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
    } catch (err) { 
      setError("Microphone access denied."); 
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
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
    if (!source || !user || !apiKey) {
      setError("System missing API Key or Auth. Check Netlify settings.");
      return;
    }
    
    setIsProcessing(true);
    const reader = new FileReader();
    reader.readAsDataURL(source);
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1];
      const prompt = `Transcribe meeting JSON: { "title": "", "summary": "", "keyPoints": [], "actionItems": [{"owner": "", "task": ""}], "transcript": "" }`;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

  if (!firebaseConfig) return <div className="p-10 text-red-500 font-bold">Error: REACT_APP_FIREBASE_CONFIG missing in Netlify settings.</div>;
  if (!user) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white"><LayoutDashboard size={18} /></div>
            <h1 className="font-bold text-lg">Meeting Pro</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <nav className="space-y-1">
                <button onClick={() => { setActiveFolderId('all'); setView('dashboard'); }} className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 text-sm font-semibold ${activeFolderId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><LayoutDashboard size={16}/> All Sessions</button>
            </nav>
            <section>
                <div className="flex items-center justify-between px-3 mb-2">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Folders</h2>
                    <button onClick={() => { const n = prompt("Name:"); if(n) addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'folders'), { name: n, timestamp: Date.now() }); }} className="text-indigo-600 p-1"><Plus size={14} /></button>
                </div>
                {folders.map(f => (
                    <button key={f.id} onClick={() => { setActiveFolderId(f.id); setView('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold ${activeFolderId === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}><Folder size={16}/> {f.name}</button>
                ))}
            </section>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8">
            <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-50 rounded-full py-2 pl-10 pr-4 text-sm outline-none" />
            </div>
            <button onClick={() => setView('record')} className="bg-indigo-600 text-white px-5 py-2 rounded-xl text-sm font-bold">+ New</button>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {filteredHistory.map(m => (
                        <div key={m.id} onClick={() => { setCurrentMeeting(m); setEditBuffer(m); setView('detail'); }} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-all group relative">
                            <div className="w-10 h-10 rounded-xl mb-4 flex items-center justify-center bg-indigo-50 text-indigo-500">
                              {m.sourceType === 'upload' ? <FileAudio size={18}/> : <Mic size={18}/>}
                            </div>
                            <h3 className="font-bold text-slate-800 line-clamp-2">{m.title}</h3>
                            <div className="text-[10px] text-slate-400 font-bold uppercase mt-2">{new Date(m.timestamp).toLocaleDateString()} • {formatTime(m.duration)}</div>
                            <button onClick={(e) => { e.stopPropagation(); if(confirm("Delete?")) deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'meetings', m.id)); }} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-slate-200 hover:text-red-500"><Trash2 size={14}/></button>
                        </div>
                    ))}
                </div>
            ) : view === 'record' ? (
                <div className="max-w-2xl mx-auto py-12 text-center bg-white p-12 rounded-[3rem] shadow-xl">
                    {isRecording ? (
                        <div className="space-y-8">
                            <div className="text-8xl font-black text-slate-800 tabular-nums">{formatTime(recordingDuration)}</div>
                            <canvas ref={canvasRef} width={400} height={80} className="w-full h-20 opacity-30 mx-auto" />
                            <button onClick={stopRecording} className="px-12 py-5 bg-red-500 text-white rounded-3xl font-black text-xl hover:bg-red-600 transition-colors">Stop Recording</button>
                        </div>
                    ) : (audioBlob || uploadedFile) ? (
                        <div className="space-y-6">
                            <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 size={40} /></div>
                            <h2 className="text-3xl font-black">Audio Ready</h2>
                            <p className="text-slate-500 text-sm">Length: {formatTime(recordingDuration)}</p>
                            <button onClick={processInput} disabled={isProcessing} className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-black text-lg disabled:opacity-50 transition-all">
                                {isProcessing ? "Analyzing with AI..." : "Run AI Analysis"}
                            </button>
                            <button onClick={() => {setAudioBlob(null); setUploadedFile(null); setRecordingDuration(0);}} className="text-slate-400 text-xs font-bold hover:text-red-500 uppercase tracking-widest mt-4">Discard</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={startRecording} className="p-10 bg-indigo-600 text-white rounded-[2.5rem] text-left hover:bg-indigo-700 transition-all">
                                <h3 className="text-2xl font-black">Record</h3>
                                <p className="text-indigo-200 text-xs uppercase tracking-widest">Live Capture</p>
                            </button>
                            <div onClick={() => fileInputRef.current.click()} className="p-10 bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] text-left cursor-pointer hover:border-indigo-400 transition-all">
                                <h3 className="text-2xl font-black text-slate-800">Upload</h3>
                                <p className="text-slate-400 text-xs uppercase tracking-widest">Audio Files</p>
                                <input type="file" ref={fileInputRef} onChange={e => setUploadedFile(e.target.files[0])} accept="audio/*" className="hidden" />
                            </div>
                        </div>
                    )}
                    {error && <div className="mt-4 p-3 bg-red-50 text-red-500 rounded-xl text-xs font-bold border border-red-100">{error}</div>}
                </div>
            ) : (
                <div className="max-w-5xl mx-auto space-y-8 pb-32">
                    <div className="flex items-center justify-between">
                        <button onClick={() => setView('dashboard')} className="p-2 hover:bg-white rounded-lg text-slate-300 transition-colors"><Undo2 size={20}/></button>
                        <h2 className="text-2xl font-black text-slate-800">Meeting Intelligence</h2>
                        <button onClick={() => setIsEditing(!isEditing)} className="px-6 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all">
                          {isEditing ? "Save Session" : "Edit Details"}
                        </button>
                    </div>
                    <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-slate-100">
                        <h1 className="text-4xl font-black mb-6 text-slate-900 tracking-tight">{currentMeeting?.title}</h1>
                        <section className="mb-12">
                            <h4 className="text-[10px] font-black uppercase text-indigo-500 mb-4 tracking-widest">Summary</h4>
                            <p className="text-lg text-slate-700 leading-relaxed">{resolveSpeaker(currentMeeting?.summary)}</p>
                        </section>
                        <section>
                            <h4 className="text-[10px] font-black uppercase text-indigo-500 mb-4 tracking-widest">Full Transcript</h4>
                            <div className="bg-slate-50 rounded-2xl p-8 text-xs font-mono text-slate-600 whitespace-pre-wrap leading-loose border border-slate-100">
                                {resolveSpeaker(currentMeeting?.transcript)}
                            </div>
                        </section>
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;
