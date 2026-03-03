/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  AlertCircle, 
  Bell, 
  ChevronRight, 
  Database,
  Heart, 
  Info, 
  LineChart, 
  LogOut,
  Pause,
  Play,
  ShieldAlert, 
  Stethoscope, 
  Thermometer, 
  User, 
  Zap 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Patient, Vitals, PredictionResponse, RiskLevel, AlertStatus } from './types';
import { getHypoxiaPredictions } from './services/geminiService';
import { supabase } from './lib/supabase';
import { syncPatients, saveVitals, savePrediction } from './services/supabaseService';
import Auth from './components/Auth';
import { Session } from '@supabase/supabase-js';

const INITIAL_PATIENTS: Patient[] = Array.from({ length: 7 }, (_, i) => ({
  Patient_ID: `Baby_${i + 1}`,
  Name: `Baby ${i + 1}`,
  Unit: 'NICU Unit A-4',
  CurrentTemperature: 36.8,
  Weight: 1200 + Math.floor(Math.random() * 2000), // Initial weight between 1.2kg and 3.2kg
  vitals: [],
  isSimulating: true
}));

const REFRESH_INTERVAL = 5000; // 5 seconds for simulation updates
const AI_ANALYSIS_INTERVAL = 60000; // 60 seconds for AI analysis

export default function App() {
  const [patients, setPatients] = useState<Patient[]>(INITIAL_PATIENTS);
  const [session, setSession] = useState<Session | null>(null);
  const [predictions, setPredictions] = useState<Record<string, PredictionResponse>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [quotaError, setQuotaError] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<'connected' | 'error' | 'pending'>('pending');
  const [lastAnalysisTime, setLastAnalysisTime] = useState<Date | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>("Baby_1");
  const [activeCriticalAlerts, setActiveCriticalAlerts] = useState<string[]>([]);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [userName, setUserName] = useState("Dr. Sarah Chen");
  const [manualVitals, setManualVitals] = useState({
    SpO2: '',
    Heart_Rate: '',
    PI: '',
    Systolic: '',
    Diastolic: '',
    Weight: '',
    Temperature: '',
    Respiratory_Rate: '',
    FiO2: ''
  });
  const [isEditingPatientName, setIsEditingPatientName] = useState(false);
  const [editingPatientDetails, setEditingPatientDetails] = useState<{
    unit: string;
    temp: string;
    weight: string;
  } | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const patientsRef = useRef(patients);

  // Sync ref with state
  useEffect(() => {
    patientsRef.current = patients;
  }, [patients]);

  // Initial Supabase Sync & Auth Listener
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const initSupabase = async () => {
      try {
        // Check current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        setSession(currentSession);

        // Listen for auth changes
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          setSession(session);
        });
        subscription = data.subscription;

        const { error } = await supabase.from('patients').select('count');
        if (error) throw error;
        setSupabaseStatus('connected');
        await syncPatients(INITIAL_PATIENTS);
      } catch (err) {
        console.error('Supabase connection failed:', err);
        setSupabaseStatus('error');
      }
    };
    
    initSupabase();

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  // Initialize AudioContext on first user interaction or when needed
  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  };

  const playAlertSound = () => {
    initAudio();
    if (!audioContextRef.current) return;
    
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5); // A4

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  };

  // Simulation logic
  useEffect(() => {
    const interval = setInterval(() => {
      setPatients(prev => prev.map(p => {
        if (p.isSimulating === false) return p;

        const lastVitals = p.vitals[p.vitals.length - 1];
        
        // Base values for simulation
        let baseSpO2 = 94;
        let basePI = 1.2;
        let baseHR = 140;
        let baseSys = 70;
        let baseDia = 45;

        // Introduce some variability or "events" for certain babies to make it interesting
        if (p.Patient_ID === 'Baby_3') { // Simulating a high risk trend
          baseSpO2 = 88 + Math.random() * 4;
          basePI = 0.3 + Math.random() * 0.2;
          baseHR = 170 + Math.random() * 10;
        } else if (p.Patient_ID === 'Baby_7') { // Simulating a moderate risk
          baseSpO2 = 91 + Math.random() * 2;
          basePI = 0.6 + Math.random() * 0.3;
        }

        const newVitals: Vitals = {
          SpO2: Math.min(100, Math.max(70, (lastVitals?.SpO2 || baseSpO2) + (Math.random() - 0.5) * 2)),
          PI: Math.max(0.1, (lastVitals?.PI || basePI) + (Math.random() - 0.5) * 0.2),
          Heart_Rate: Math.min(220, Math.max(80, (lastVitals?.Heart_Rate || baseHR) + (Math.random() - 0.5) * 5)),
          BP: {
            systolic: Math.round((lastVitals?.BP.systolic || baseSys) + (Math.random() - 0.5) * 4),
            diastolic: Math.round((lastVitals?.BP.diastolic || baseDia) + (Math.random() - 0.5) * 3),
          },
          Weight: p.Weight,
          Timestamp: new Date().toLocaleTimeString(),
        };

        // Async save to Supabase
        if (supabaseStatus === 'connected') {
          saveVitals(p.Patient_ID, newVitals);
        }

        return {
          ...p,
          vitals: [...p.vitals.slice(-19), newVitals] // Keep last 20 readings
        };
      }));
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const runAnalysis = async (currentPatients: Patient[]) => {
    if (isAnalyzing) return;
    const activePatients = currentPatients.filter(p => p.isSimulating !== false);
    if (activePatients.length > 0 && activePatients.some(p => p.vitals.length > 0)) {
      setIsAnalyzing(true);
      try {
        const results = await getHypoxiaPredictions(activePatients);
        
        if (results.length === 0 && currentPatients.length > 0) {
          // This might be a silent failure or rate limit that exhausted retries
          // We check if it's likely a quota issue if it keeps happening
        } else {
          setQuotaError(false);
        }

        const newPredictions: Record<string, PredictionResponse> = {};
        
        results.forEach(res => {
          newPredictions[res.Patient_ID] = res;
          
          // Save prediction to Supabase
          if (supabaseStatus === 'connected') {
            savePrediction(res);
          }
          
          // Trigger alert if critical and not already in active alerts
          // ONLY if the patient is currently simulating
          const patient = currentPatients.find(p => p.Patient_ID === res.Patient_ID);
          if (res.Alert_Status === "CRITICAL - NOTIFY STAFF" && patient?.isSimulating !== false) {
            setActiveCriticalAlerts(prev => {
              if (!prev.includes(res.Patient_ID)) {
                playAlertSound();
                return [...prev, res.Patient_ID];
              }
              return prev;
            });
          }
        });
        
        setPredictions(prev => ({ ...prev, ...newPredictions }));
        setLastAnalysisTime(new Date());
      } catch (err: any) {
        console.error("Analysis failed", err);
        if (err?.message?.includes("429") || JSON.stringify(err).includes("429")) {
          setQuotaError(true);
        }
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  // AI Analysis logic
  useEffect(() => {
    const trigger = () => runAnalysis(patientsRef.current);
    trigger();
    const interval = setInterval(trigger, AI_ANALYSIS_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const toggleSimulation = (patientId: string) => {
    setPatients(prev => prev.map(p => {
      if (p.Patient_ID === patientId) {
        const nextSimulating = !p.isSimulating;
        // If we are pausing, dismiss any active critical alerts for this patient
        if (!nextSimulating) {
          dismissAlert(patientId);
        }
        return { ...p, isSimulating: nextSimulating };
      }
      return p;
    }));
  };

  const handleManualEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) return;

    const newVitals: Vitals = {
      SpO2: parseFloat(manualVitals.SpO2),
      Heart_Rate: parseFloat(manualVitals.Heart_Rate),
      PI: parseFloat(manualVitals.PI),
      BP: {
        systolic: parseInt(manualVitals.Systolic),
        diastolic: parseInt(manualVitals.Diastolic)
      },
      Temperature: manualVitals.Temperature ? parseFloat(manualVitals.Temperature) : undefined,
      Respiratory_Rate: manualVitals.Respiratory_Rate ? parseFloat(manualVitals.Respiratory_Rate) : undefined,
      FiO2: manualVitals.FiO2 ? parseFloat(manualVitals.FiO2) : undefined,
      Weight: manualVitals.Weight ? parseFloat(manualVitals.Weight) : undefined,
      Timestamp: new Date().toLocaleTimeString()
    };

    const updatedPatients = patients.map(p => {
      if (p.Patient_ID === selectedPatientId) {
        return {
          ...p,
          Weight: newVitals.Weight || p.Weight,
          vitals: [...p.vitals.slice(-19), newVitals]
        };
      }
      return p;
    });

    setPatients(updatedPatients);
    
    // Sync to Supabase
    if (supabaseStatus === 'connected') {
      saveVitals(selectedPatientId, newVitals);
    }
    setShowManualEntry(false);
    setManualVitals({
      SpO2: '',
      Heart_Rate: '',
      PI: '',
      Systolic: '',
      Diastolic: '',
      Weight: '',
      Temperature: '',
      Respiratory_Rate: '',
      FiO2: ''
    });

    // Trigger AI analysis immediately for manual entry
    await runAnalysis(updatedPatients);
  };

  const handleUpdatePatientName = (newName: string) => {
    if (!selectedPatientId) return;
    setPatients(prev => prev.map(p => 
      p.Patient_ID === selectedPatientId ? { ...p, Name: newName } : p
    ));
    setIsEditingPatientName(false);
  };

  const handleUpdatePatientDetails = () => {
    if (!selectedPatientId || !editingPatientDetails) return;
    
    const updatedPatients = patients.map(p => {
      if (p.Patient_ID === selectedPatientId) {
        return {
          ...p,
          Unit: editingPatientDetails.unit,
          CurrentTemperature: parseFloat(editingPatientDetails.temp) || p.CurrentTemperature,
          Weight: parseFloat(editingPatientDetails.weight) || p.Weight
        };
      }
      return p;
    });

    setPatients(updatedPatients);
    
    // Sync to Supabase
    if (supabaseStatus === 'connected') {
      syncPatients(updatedPatients.filter(p => p.Patient_ID === selectedPatientId));
    }

    setEditingPatientDetails(null);
  };

  const dismissAlert = (patientId: string) => {
    setActiveCriticalAlerts(prev => prev.filter(id => id !== patientId));
  };

  const getRiskColor = (risk?: RiskLevel) => {
    switch (risk) {
      case "High Risk/Imminent Hypoxia": return "text-red-500 bg-red-50 border-red-200";
      case "Moderate Risk": return "text-amber-500 bg-amber-50 border-amber-200";
      case "Low Risk": return "text-emerald-500 bg-emerald-50 border-emerald-200";
      default: return "text-slate-400 bg-slate-50 border-slate-200";
    }
  };

  const getAlertIcon = (status?: AlertStatus) => {
    if (status === "CRITICAL - NOTIFY STAFF") return <ShieldAlert className="w-5 h-5 text-red-600 animate-pulse" />;
    if (status === "Monitor") return <Bell className="w-5 h-5 text-amber-500" />;
    return <Activity className="w-5 h-5 text-slate-400" />;
  };

  const selectedPatient = patients.find(p => p.Patient_ID === selectedPatientId);
  const selectedPrediction = selectedPatientId ? predictions[selectedPatientId] : null;

  if (!session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 font-sans selection:bg-indigo-100" onClick={initAudio}>
      {/* Critical Alert Overlay */}
      <AnimatePresence>
        {activeCriticalAlerts.length > 0 && (
          <div className="fixed inset-0 z-50 pointer-events-none flex flex-col items-center justify-start p-6 gap-4">
            {activeCriticalAlerts.map((patientId) => (
              <motion.div
                key={patientId}
                initial={{ opacity: 0, scale: 0.9, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                className="pointer-events-auto bg-red-600 text-white p-6 rounded-3xl shadow-2xl shadow-red-500/40 border-4 border-white flex items-center gap-6 max-w-xl w-full"
              >
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center animate-pulse">
                  <ShieldAlert className="w-10 h-10 text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-black uppercase tracking-widest opacity-80 mb-1">Critical Hypoxia Alert</div>
                  <h4 className="text-2xl font-black mb-1">{patientId}</h4>
                  <p className="text-sm font-medium opacity-90 leading-tight">
                    {predictions[patientId]?.Reasoning || "Imminent hypoxia detected. Immediate intervention required."}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => {
                      setSelectedPatientId(patientId);
                      dismissAlert(patientId);
                    }}
                    className="bg-white text-red-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-red-50 transition-colors"
                  >
                    View & Dismiss
                  </button>
                  <button 
                    onClick={() => dismissAlert(patientId)}
                    className="text-white/60 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                  >
                    Ignore
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <Stethoscope className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">NICU</h1>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">Neonatal Digital Twin Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-100">
            <Database className={`w-4 h-4 ${
              supabaseStatus === 'connected' ? 'text-emerald-500' : 
              supabaseStatus === 'error' ? 'text-red-500' : 'text-amber-500 animate-pulse'
            }`} />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Supabase: {supabaseStatus}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2">
              {quotaError ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  <span className="text-xs font-bold text-red-600 uppercase tracking-tighter flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Quota Exceeded
                  </span>
                </>
              ) : (
                <>
                  <div className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'}`} />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-tighter">
                    {isAnalyzing ? 'AI Analyzing Trends...' : 'System Live'}
                  </span>
                </>
              )}
            </div>
            {lastAnalysisTime && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">
                  {quotaError ? 'Retrying with backoff...' : `Last AI Sync: ${lastAnalysisTime.toLocaleTimeString()}`}
                </span>
                {quotaError && (
                  <button 
                    onClick={() => runAnalysis(patientsRef.current)}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 underline uppercase tracking-widest"
                  >
                    Retry Now
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <button className="p-2 hover:bg-slate-100 rounded-full transition-colors relative">
            <Bell className="w-5 h-5 text-slate-600" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
          </button>
          <div className="flex items-center gap-3 pl-2 group cursor-pointer" onClick={() => setIsEditingProfile(true)}>
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
              <User className="w-4 h-4 text-slate-500 group-hover:text-indigo-600" />
            </div>
            {isEditingProfile ? (
              <input 
                autoFocus
                value={userName}
                onChange={e => setUserName(e.target.value)}
                onBlur={() => setIsEditingProfile(false)}
                onKeyDown={e => e.key === 'Enter' && setIsEditingProfile(false)}
                className="text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none"
              />
            ) : (
              <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">{session?.user?.email?.split('@')[0] || userName}</span>
            )}
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <button 
            onClick={async () => {
              try {
                await supabase.auth.signOut();
              } catch (err) {
                console.error('Error signing out:', err);
              } finally {
                setSession(null); // Always clear local session state
              }
            }}
            className="p-2 hover:bg-red-50 rounded-full transition-colors text-slate-400 hover:text-red-600"
            title="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="p-6 max-w-[1600px] mx-auto grid grid-cols-12 gap-6">
        
        {/* Left Sidebar: Patient List */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Active Neonates</h2>
            <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">7 TOTAL</span>
          </div>
          <div className="space-y-2">
            {patients.map((patient) => {
              const pred = predictions[patient.Patient_ID];
              const latest = patient.vitals[patient.vitals.length - 1];
              const isSelected = selectedPatientId === patient.Patient_ID;

              return (
                <motion.button
                  key={patient.Patient_ID}
                  onClick={() => setSelectedPatientId(patient.Patient_ID)}
                  whileHover={{ x: 4 }}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
                    isSelected 
                      ? 'bg-white border-indigo-200 shadow-md ring-1 ring-indigo-100' 
                      : 'bg-white/50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      !patient.isSimulating ? 'bg-slate-100 text-slate-400' :
                      pred?.Prediction === "High Risk/Imminent Hypoxia" ? 'bg-red-100 text-red-600' : 
                      pred?.Prediction === "Moderate Risk" ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'
                    }`}>
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">{patient.Name || patient.Patient_ID}</div>
                      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        ID: {patient.Patient_ID} | SpO2: {latest?.SpO2.toFixed(1) || '--'}%
                        {!patient.isSimulating && <span className="text-amber-500 font-bold ml-1">(PAUSED)</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {!patient.isSimulating ? <Pause className="w-4 h-4 text-slate-300" /> : getAlertIcon(pred?.Alert_Status)}
                    <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${!patient.isSimulating ? 'text-slate-400 bg-slate-50 border-slate-200' : getRiskColor(pred?.Prediction)}`}>
                      {patient.isSimulating ? (pred?.Prediction ? pred.Prediction.split(' ')[0] : 'Pending') : 'Paused'}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Main Content: Detailed View */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          <AnimatePresence mode="wait">
            {selectedPatient && (
              <motion.div
                key={selectedPatient.Patient_ID}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {/* Patient Hero Card */}
                <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-8 flex flex-col items-end gap-3">
                     <div className={`px-4 py-2 rounded-2xl border flex items-center gap-2 ${!selectedPatient.isSimulating ? 'text-slate-400 bg-slate-50 border-slate-200' : getRiskColor(selectedPrediction?.Prediction)}`}>
                        {!selectedPatient.isSimulating ? <Pause className="w-5 h-5 text-slate-400" /> : getAlertIcon(selectedPrediction?.Alert_Status)}
                        <span className="font-bold text-sm uppercase tracking-wide">
                          {!selectedPatient.isSimulating ? "Simulation Paused" : (selectedPrediction?.Prediction || "Analyzing Baseline...")}
                        </span>
                     </div>
                     <div className="flex items-center gap-2">
                       <button 
                        onClick={() => toggleSimulation(selectedPatient.Patient_ID)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors border ${
                          selectedPatient.isSimulating 
                            ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200' 
                            : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                        }`}
                        title={selectedPatient.isSimulating ? "Pause Simulation" : "Resume Simulation"}
                       >
                         {selectedPatient.isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                         {selectedPatient.isSimulating ? 'Pause Sim' : 'Resume Sim'}
                       </button>
                       {selectedPatientId && activeCriticalAlerts.includes(selectedPatientId) && (
                         <button 
                          onClick={() => dismissAlert(selectedPatientId)}
                          className="flex items-center gap-2 bg-red-50 text-red-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-100 transition-colors border border-red-100"
                         >
                           <AlertCircle className="w-4 h-4" />
                           Dismiss Critical Alert
                         </button>
                       )}
                       <button 
                        onClick={() => setShowManualEntry(!showManualEntry)}
                        className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-colors"
                       >
                         <Activity className="w-4 h-4" />
                         {showManualEntry ? 'Cancel Entry' : 'Nurse Manual Entry'}
                       </button>
                     </div>
                  </div>

                  <div className="flex items-start gap-6">
                    <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center">
                      <User className="w-10 h-10 text-slate-400" />
                    </div>
                    <div className="flex-1">
                      {isEditingPatientName ? (
                        <div className="flex items-center gap-2 mb-1">
                          <input 
                            autoFocus
                            defaultValue={selectedPatient.Name || selectedPatient.Patient_ID}
                            onBlur={(e) => handleUpdatePatientName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleUpdatePatientName(e.currentTarget.value)}
                            className="text-3xl font-black text-slate-900 bg-slate-50 border-b-2 border-indigo-500 outline-none px-1"
                          />
                          <span className="text-[10px] font-bold text-indigo-500 uppercase">Press Enter to Save</span>
                        </div>
                      ) : (
                        <h2 
                          className="text-3xl font-black text-slate-900 mb-1 cursor-pointer hover:text-indigo-600 transition-colors flex items-center gap-2"
                          onClick={() => setIsEditingPatientName(true)}
                          title="Click to rename"
                        >
                          {selectedPatient.Name || selectedPatient.Patient_ID}
                          <Info className="w-4 h-4 opacity-20" />
                        </h2>
                      )}
                      <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
                        <span className="text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-500 uppercase tracking-widest">ID: {selectedPatient.Patient_ID}</span>
                        <span className="flex items-center gap-1 cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => setEditingPatientDetails({ unit: selectedPatient.Unit || 'NICU Unit A-4', temp: selectedPatient.CurrentTemperature?.toString() || '36.8', weight: selectedPatient.Weight?.toString() || '' })}>
                          <Activity className="w-4 h-4" /> {selectedPatient.Unit || 'NICU Unit A-4'}
                        </span>
                        <span className="flex items-center gap-1 cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => setEditingPatientDetails({ unit: selectedPatient.Unit || 'NICU Unit A-4', temp: selectedPatient.CurrentTemperature?.toString() || '36.8', weight: selectedPatient.Weight?.toString() || '' })}>
                          <Thermometer className="w-4 h-4" /> {selectedPatient.CurrentTemperature || '36.8'}°C
                        </span>
                        <span className="flex items-center gap-1 font-bold text-indigo-600 cursor-pointer hover:text-indigo-700 transition-colors" onClick={() => setEditingPatientDetails({ unit: selectedPatient.Unit || 'NICU Unit A-4', temp: selectedPatient.CurrentTemperature?.toString() || '36.8', weight: selectedPatient.Weight?.toString() || '' })}>
                          <Zap className="w-4 h-4" /> Weight: {selectedPatient.Weight}g
                        </span>
                      </div>
                      
                      {editingPatientDetails && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }} 
                          animate={{ opacity: 1, height: 'auto' }} 
                          className="mt-4 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex items-center gap-4 overflow-hidden"
                        >
                          <div className="flex-1 grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-indigo-400 uppercase ml-1">Unit</label>
                              <input 
                                placeholder="Unit"
                                value={editingPatientDetails.unit}
                                onChange={e => setEditingPatientDetails({...editingPatientDetails, unit: e.target.value})}
                                className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-indigo-400 uppercase ml-1">Temp (°C)</label>
                              <input 
                                placeholder="Temp"
                                value={editingPatientDetails.temp}
                                onChange={e => setEditingPatientDetails({...editingPatientDetails, temp: e.target.value})}
                                className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-indigo-400 uppercase ml-1">Weight (g)</label>
                              <input 
                                placeholder="Weight"
                                value={editingPatientDetails.weight}
                                onChange={e => setEditingPatientDetails({...editingPatientDetails, weight: e.target.value})}
                                className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 pt-4">
                            <button onClick={handleUpdatePatientDetails} className="bg-indigo-600 text-white px-6 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200">Save</button>
                            <button onClick={() => setEditingPatientDetails(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold">Cancel</button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>

                  {/* Manual Entry Form */}
                  <AnimatePresence>
                    {showManualEntry && (
                      <motion.form 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        onSubmit={handleManualEntrySubmit}
                        className="mt-8 p-6 bg-slate-50 rounded-3xl border border-indigo-100 grid grid-cols-2 md:grid-cols-3 gap-4 overflow-hidden"
                      >
                        <div className="col-span-full mb-2">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Nurse Manual Vitals Entry</h4>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">SpO2 (%)</label>
                          <input 
                            type="number" step="0.1" required
                            value={manualVitals.SpO2}
                            onChange={e => setManualVitals({...manualVitals, SpO2: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 94.5"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Heart Rate (BPM)</label>
                          <input 
                            type="number" required
                            value={manualVitals.Heart_Rate}
                            onChange={e => setManualVitals({...manualVitals, Heart_Rate: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 145"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">PI (%)</label>
                          <input 
                            type="number" step="0.01" required
                            value={manualVitals.PI}
                            onChange={e => setManualVitals({...manualVitals, PI: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 1.25"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">BP Systolic</label>
                          <input 
                            type="number" required
                            value={manualVitals.Systolic}
                            onChange={e => setManualVitals({...manualVitals, Systolic: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 75"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">BP Diastolic</label>
                          <input 
                            type="number" required
                            value={manualVitals.Diastolic}
                            onChange={e => setManualVitals({...manualVitals, Diastolic: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 50"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Weight (g)</label>
                          <input 
                            type="number"
                            value={manualVitals.Weight}
                            onChange={e => setManualVitals({...manualVitals, Weight: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder={selectedPatient.Weight?.toString()}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Temp (°C)</label>
                          <input 
                            type="number" step="0.1"
                            value={manualVitals.Temperature}
                            onChange={e => setManualVitals({...manualVitals, Temperature: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 36.8"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Resp Rate</label>
                          <input 
                            type="number"
                            value={manualVitals.Respiratory_Rate}
                            onChange={e => setManualVitals({...manualVitals, Respiratory_Rate: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 45"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">FiO2 (%)</label>
                          <input 
                            type="number"
                            value={manualVitals.FiO2}
                            onChange={e => setManualVitals({...manualVitals, FiO2: e.target.value})}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. 21"
                          />
                        </div>
                        <div className="col-span-full mt-2">
                          <button 
                            type="submit"
                            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                          >
                            <Zap className="w-4 h-4" /> Submit Vitals & Run AI Prediction
                          </button>
                        </div>
                      </motion.form>
                    )}
                  </AnimatePresence>

                  {/* Vitals Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 relative">
                    {!selectedPatient.isSimulating && (
                      <div className="absolute -inset-2 z-10 bg-[#F8F9FA]/40 backdrop-blur-[1px] rounded-3xl border border-slate-200/50 flex items-center justify-center">
                        <div className="bg-white/90 px-4 py-1 rounded-full border border-slate-200 shadow-sm flex items-center gap-2">
                          <Pause className="w-3 h-3 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vitals Frozen</span>
                        </div>
                      </div>
                    )}
                    {[
                      { label: 'SpO2', value: selectedPatient.vitals[selectedPatient.vitals.length - 1]?.SpO2.toFixed(1), unit: '%', icon: <Activity className="text-indigo-500" />, color: 'text-indigo-600' },
                      { label: 'Heart Rate', value: Math.round(selectedPatient.vitals[selectedPatient.vitals.length - 1]?.Heart_Rate || 0), unit: 'BPM', icon: <Heart className="text-rose-500" />, color: 'text-rose-600' },
                      { label: 'Perfusion Index', value: selectedPatient.vitals[selectedPatient.vitals.length - 1]?.PI.toFixed(2), unit: '%', icon: <Zap className="text-amber-500" />, color: 'text-amber-600' },
                      { label: 'Blood Pressure', value: `${selectedPatient.vitals[selectedPatient.vitals.length - 1]?.BP.systolic}/${selectedPatient.vitals[selectedPatient.vitals.length - 1]?.BP.diastolic}`, unit: 'mmHg', icon: <Activity className="text-emerald-500" />, color: 'text-emerald-600' },
                      { label: 'Temperature', value: selectedPatient.vitals[selectedPatient.vitals.length - 1]?.Temperature?.toFixed(1), unit: '°C', icon: <Thermometer className="text-orange-500" />, color: 'text-orange-600' },
                      { label: 'Resp Rate', value: selectedPatient.vitals[selectedPatient.vitals.length - 1]?.Respiratory_Rate, unit: '/min', icon: <Activity className="text-blue-500" />, color: 'text-blue-600' },
                      { label: 'FiO2', value: selectedPatient.vitals[selectedPatient.vitals.length - 1]?.FiO2, unit: '%', icon: <Zap className="text-cyan-500" />, color: 'text-cyan-600' },
                      { label: 'Weight', value: selectedPatient.vitals[selectedPatient.vitals.length - 1]?.Weight || selectedPatient.Weight, unit: 'g', icon: <Zap className="text-purple-500" />, color: 'text-purple-600' },
                    ].map((stat, i) => (
                      <div key={i} className={`bg-slate-50 rounded-2xl p-4 border border-slate-100 transition-opacity ${!selectedPatient.isSimulating ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {stat.icon}
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-2xl font-black ${!selectedPatient.isSimulating ? 'text-slate-400' : stat.color}`}>{stat.value || '--'}</span>
                          <span className="text-xs font-bold text-slate-400">{stat.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Prediction & Reasoning */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Zap className="w-4 h-4 text-indigo-500" /> AI Risk Analysis
                      </h3>
                      {selectedPrediction && (
                        <div className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
                          Confidence: {selectedPrediction.Confidence_Score}%
                        </div>
                      )}
                    </div>
                    
                    {!selectedPatient.isSimulating ? (
                      <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-3 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                        <Pause className="w-10 h-10 text-slate-300" />
                        <div className="text-center">
                          <span className="text-sm font-bold block text-slate-500 uppercase">Analysis Paused</span>
                          <span className="text-[10px] font-medium">Resume simulation to restart real-time monitoring</span>
                        </div>
                      </div>
                    ) : selectedPrediction ? (
                      <div className="space-y-4">
                        <div className={`p-4 rounded-2xl border-2 ${getRiskColor(selectedPrediction.Prediction)}`}>
                          <div className="text-xs font-bold uppercase mb-1 opacity-70">Current Prediction</div>
                          <div className="text-xl font-black">{selectedPrediction.Prediction}</div>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                          <div className="text-xs font-bold text-slate-400 uppercase mb-2">Clinical Reasoning</div>
                          <p className="text-sm text-slate-700 leading-relaxed italic">
                            "{selectedPrediction.Reasoning}"
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-3">
                        <Activity className="w-8 h-8 animate-pulse" />
                        <span className="text-sm font-medium">Gathering baseline data for AI analysis...</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-2">
                      <LineChart className="w-4 h-4 text-indigo-500" /> SpO2 Trend (Last 20)
                    </h3>
                    <div className="h-40 flex items-end gap-1 px-2 relative">
                      {!selectedPatient.isSimulating && (
                        <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
                          <div className="flex flex-col items-center gap-1">
                            <Pause className="w-6 h-6 text-slate-400" />
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Trend Recording Paused</span>
                          </div>
                        </div>
                      )}
                      {selectedPatient.vitals.map((v, i) => {
                        const height = ((v.SpO2 - 70) / 30) * 100;
                        return (
                          <div 
                            key={i} 
                            className={`flex-1 rounded-t-sm transition-all duration-500 ${
                              v.SpO2 < 85 ? 'bg-red-400' : v.SpO2 < 90 ? 'bg-amber-400' : 'bg-indigo-400'
                            }`}
                            style={{ height: `${Math.max(5, height)}%` }}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      <span>-10m</span>
                      <span>Now</span>
                    </div>
                  </div>
                </div>

                {/* Alert History / Log */}
                <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-400" /> System Activity Log
                    </h3>
                    <div className="text-[10px] font-mono text-slate-500">REAL-TIME STREAM ACTIVE</div>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {selectedPatient.vitals.slice().reverse().map((v, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] font-mono border-b border-white/5 py-2 last:border-0">
                        <span className="text-slate-500">[{v.Timestamp}]</span>
                        <span className="text-slate-300">Vitals Updated: SpO2 {v.SpO2.toFixed(1)}% | HR {Math.round(v.Heart_Rate)} | PI {v.PI.toFixed(2)}</span>
                        <span className="text-emerald-400">OK</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 10px;
        }
      `}} />
    </div>
  );
}
