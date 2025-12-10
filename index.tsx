import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Activity, Bluetooth, Brain, Play, Square, Save, RotateCcw, Fingerprint, Wifi, WifiOff, User, CheckCircle2, Circle, FileDown, Info } from 'lucide-react';
import { jsPDF } from "jspdf";

// Definición de tipos para Web Bluetooth API
declare global {
  interface BluetoothRemoteGATTServer {
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    connected: boolean;
    device: BluetoothDevice;
    getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(type: string, listener: (event: any) => void): void;
    value: DataView;
  }

  interface BluetoothDevice {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
  }

  interface Navigator {
    bluetooth: {
      requestDevice(options?: {
        filters?: any[];
        optionalServices?: (string | number)[];
        acceptAllDevices?: boolean;
      }): Promise<BluetoothDevice>;
    };
  }
}

// Definición de tipos
type FingerData = {
  timestamp: string;
  pulgar: number;
  indice: number;
  medio: number;
  anular: number;
  menique: number;
};

// Configuración de dedos para UI
const FINGER_CONFIG = [
  { key: 'pulgar', label: 'Pulgar', color: '#9333ea', colorClass: 'text-purple-600', bgClass: 'bg-purple-100', strokeClass: 'stroke-purple-600' },
  { key: 'indice', label: 'Índice', color: '#2563eb', colorClass: 'text-blue-600', bgClass: 'bg-blue-100', strokeClass: 'stroke-blue-600' },
  { key: 'medio', label: 'Medio', color: '#10b981', colorClass: 'text-emerald-600', bgClass: 'bg-emerald-100', strokeClass: 'stroke-emerald-600' },
  { key: 'anular', label: 'Anular', color: '#d97706', colorClass: 'text-amber-600', bgClass: 'bg-amber-100', strokeClass: 'stroke-amber-600' },
  { key: 'menique', label: 'Meñique', color: '#e11d48', colorClass: 'text-rose-600', bgClass: 'bg-rose-100', strokeClass: 'stroke-rose-600' },
] as const;

// Componente principal
const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [currentData, setCurrentData] = useState<FingerData>({ timestamp: '', pulgar: 0, indice: 0, medio: 0, anular: 0, menique: 0 });
  const [history, setHistory] = useState<FingerData[]>([]);
  const [aiReport, setAiReport] = useState<string>('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [deviceError, setDeviceError] = useState<string>('');
  const [btStatus, setBtStatus] = useState<string>('');
  
  // Nuevo Estado
  const [patientName, setPatientName] = useState('');
  const [visibleFingers, setVisibleFingers] = useState<Record<string, boolean>>({
    pulgar: true, indice: true, medio: true, anular: true, menique: true
  });
  
  // Referencias para Bluetooth
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);

  // Inicializar GenAI
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

  // Función para conectar Bluetooth Real
  const connectBluetooth = async () => {
    setDeviceError('');
    setBtStatus('Iniciando búsqueda...');

    if (!navigator.bluetooth) {
      setDeviceError('Tu navegador no soporta Bluetooth Web. Por favor usa Chrome, Edge o Bluefy (iOS).');
      return;
    }

    try {
      // Intentamos conectar aceptando todos los dispositivos para máxima compatibilidad
      // Normalmente los módulos HC-05/HM-10 usan el servicio 0xFFE0
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb', 0xFFE0] 
      });

      setBtStatus('Dispositivo seleccionado. Conectando...');
      deviceRef.current = device;
      
      const server = await device.gatt?.connect();
      serverRef.current = server || null;

      if (server) {
        setIsConnected(true);
        setBtStatus('');
        // Aquí iría la lógica para suscribirse a notificaciones (característica 0xFFE1 usualmente)
        // Por ahora simulamos el flujo de datos para que la UI funcione
        simulateDataStream(); 
      }
    } catch (error: any) {
      console.error(error);
      setBtStatus('');
      if (error.name === 'NotFoundError') {
        setDeviceError('Cancelaste la búsqueda o no seleccionaste ningún dispositivo.');
      } else if (error.name === 'SecurityError') {
        setDeviceError('Permiso denegado. Asegúrate de estar en un sitio HTTPS o localhost.');
      } else {
        setDeviceError('Error de conexión: ' + error.message + '. Intenta reiniciar el dispositivo Bluetooth.');
      }
    }
  };

  // Función para modo Demo (Simulación)
  const toggleSimulation = () => {
    if (isSimulating) {
      setIsSimulating(false);
      setIsConnected(false);
      setSessionActive(false);
    } else {
      setIsSimulating(true);
      setIsConnected(true);
      setSessionActive(true);
    }
  };

  // Efecto para generar datos
  useEffect(() => {
    let interval: any;

    if (isConnected && sessionActive) {
      interval = setInterval(() => {
        const now = new Date();
        const timeString = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        
        const newData = {
          timestamp: timeString,
          pulgar: Math.floor(Math.random() * 40) + (currentData.pulgar > 150 ? 0 : 20),
          indice: Math.max(0, Math.min(180, currentData.indice + (Math.random() > 0.5 ? 10 : -10))),
          medio: Math.max(0, Math.min(180, currentData.medio + (Math.random() > 0.5 ? 15 : -5))),
          anular: Math.max(0, Math.min(180, currentData.anular + (Math.random() > 0.5 ? 5 : -5))),
          menique: Math.max(0, Math.min(180, currentData.menique + (Math.random() > 0.5 ? 8 : -8))),
        };

        setCurrentData(newData);
        setHistory(prev => {
          const newHistory = [...prev, newData];
          if (newHistory.length > 50) return newHistory.slice(newHistory.length - 50);
          return newHistory;
        });

      }, 500); 
    }

    return () => clearInterval(interval);
  }, [isConnected, sessionActive, currentData]);

  const simulateDataStream = () => {
    setSessionActive(true);
  };

  const handleStopSession = () => {
    setSessionActive(false);
  };

  const handleClear = () => {
    setHistory([]);
    setAiReport('');
    setCurrentData({ timestamp: '', pulgar: 0, indice: 0, medio: 0, anular: 0, menique: 0 });
  };

  // Generar reporte con Gemini
  const generateAIReport = async () => {
    if (history.length === 0) return;
    setIsGeneratingReport(true);

    try {
      const stats = {
        muestras: history.length,
        promedio_indice: Math.round(history.reduce((a, b) => a + b.indice, 0) / history.length),
        max_indice: Math.max(...history.map(h => h.indice)),
        promedio_medio: Math.round(history.reduce((a, b) => a + b.medio, 0) / history.length),
        max_medio: Math.max(...history.map(h => h.medio)),
      };

      const prompt = `
        Actúa como un fisioterapeuta experto impulsado por Gemini AI. Analiza los siguientes datos de una sesión de rehabilitación de mano.
        
        Paciente: ${patientName || 'No registrado'}
        
        Datos de la sesión:
        - Duración (muestras): ${stats.muestras} (aprox ${stats.muestras * 0.5} segundos)
        - Dedo Índice: Promedio ${stats.promedio_indice}°, Máximo ${stats.max_indice}°
        - Dedo Medio: Promedio ${stats.promedio_medio}°, Máximo ${stats.max_medio}°
        
        (Nota: 0° es extensión completa/mano abierta, 180° es flexión completa/puño cerrado).
        
        Por favor provee:
        1. Evaluación breve del rango de movilidad (ROM) para ${patientName || 'el paciente'}.
        2. Si se logró flexión completa o existe rigidez.
        3. Recomendación clínica para la próxima sesión.
        
        Responde en español, formato texto simple pero estructurado (sin negritas markdown excesivas), tono profesional y empático.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      setAiReport(response.text || "No se pudo generar el reporte.");
    } catch (error) {
      console.error(error);
      setAiReport("Error al conectar con Gemini AI para el análisis.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Descargar PDF
  const downloadPDF = () => {
    if (!aiReport) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFontSize(20);
    doc.setTextColor(33, 150, 243); // Blue
    doc.text("PhysioSense AI - Reporte Clínico", 20, 20);
    
    // Info
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Paciente: ${patientName || 'No registrado'}`, 20, 35);
    doc.text(`Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 20, 42);
    doc.text(`Asistente IA: Google Gemini`, 20, 49);

    // Stats Summary (Simple)
    doc.setDrawColor(200);
    doc.line(20, 55, pageWidth - 20, 55);
    
    doc.setFontSize(14);
    doc.text("Resumen de Sesión", 20, 65);
    doc.setFontSize(10);
    
    if (history.length > 0) {
      const maxIndice = Math.max(...history.map(h => h.indice));
      const maxMedio = Math.max(...history.map(h => h.medio));
      doc.text(`Máxima Flexión Índice: ${maxIndice}°`, 20, 75);
      doc.text(`Máxima Flexión Medio: ${maxMedio}°`, 20, 82);
      doc.text(`Duración: ${history.length} muestras`, 100, 75);
    }

    doc.line(20, 90, pageWidth - 20, 90);

    // AI Report Content
    doc.setFontSize(14);
    doc.text("Evaluación Terapéutica (Gemini)", 20, 105);
    
    doc.setFontSize(11);
    const splitText = doc.splitTextToSize(aiReport.replace(/\*/g, ''), pageWidth - 40);
    doc.text(splitText, 20, 115);
    
    doc.save(`Reporte_PhysioSense_${patientName || 'Paciente'}.pdf`);
  };

  const toggleFinger = (key: string) => {
    setVisibleFingers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Pantalla de Conexión Minimalista
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-10 space-y-8 text-center transition-all duration-500 ease-in-out border border-slate-100">
          <div className="space-y-2">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6 transform transition-transform hover:scale-105">
              <Activity className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-light tracking-tight text-slate-900">PhysioSense AI</h1>
            <p className="text-slate-500 font-light">Monitor de Rehabilitación con <span className="font-semibold text-indigo-500">Gemini</span></p>
          </div>
          
          <div className="bg-blue-50 p-4 rounded-xl text-left">
            <div className="flex items-start">
              <Info className="w-5 h-5 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
              <p className="text-xs text-blue-700">
                Para conectar tu guante, asegúrate que el Bluetooth esté encendido. Al pulsar "Conectar", busca dispositivos como <strong>HM-10</strong>, <strong>HC-05</strong>, <strong>BT05</strong> o similar.
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <button 
              onClick={connectBluetooth}
              disabled={!!btStatus}
              className={`w-full group relative flex items-center justify-center py-4 px-6 border border-transparent text-sm font-medium rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 transition-all shadow-lg hover:shadow-xl ${btStatus ? 'bg-slate-500 cursor-wait' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              <Bluetooth className="w-5 h-5 mr-3" />
              {btStatus || 'Conectar Guante'}
            </button>
            
            <button 
              onClick={toggleSimulation}
              className="w-full flex items-center justify-center py-4 px-6 border border-slate-200 text-sm font-medium rounded-2xl text-slate-600 bg-white hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-200 transition-all"
            >
              <Play className="w-5 h-5 mr-3" />
              Iniciar Demo (Sin Hardware)
            </button>
          </div>

          {deviceError && (
            <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs border border-red-100">
              {deviceError}
            </div>
          )}
          
          <p className="text-xs text-slate-400 font-light pt-4">
            Powered by Google Gemini
          </p>
        </div>
      </div>
    );
  }

  // Dashboard Principal
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-10 font-sans">
      {/* Header Simplificado */}
      <header className="bg-white/80 backdrop-blur-sm sticky top-0 z-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-100 p-2 rounded-lg">
              <Activity className="text-emerald-600 w-5 h-5" />
            </div>
            <span className="text-lg font-medium text-slate-800 tracking-tight">PhysioSense AI</span>
          </div>
          <button 
             onClick={() => setIsConnected(false)}
             className="text-xs text-red-500 hover:text-red-600 font-medium px-3 py-1 rounded-full hover:bg-red-50 transition-colors"
          >
            Desconectar
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        
        {/* Sección de Estado y Control */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <div className="md:col-span-2 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-light text-slate-900">Sesión Activa</h2>
                <p className="text-slate-500 text-sm mt-1">
                  {sessionActive ? 'Capturando datos en tiempo real...' : 'Captura pausada'}
                </p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setSessionActive(!sessionActive)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${sessionActive ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'}`}
                >
                  {sessionActive ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                </button>
                <button 
                  onClick={handleClear}
                  className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center transition-all"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>
           </div>

           <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center items-center">
              <span className="text-4xl font-bold text-slate-800">{history.length}</span>
              <span className="text-sm text-slate-400 font-medium uppercase tracking-wide mt-1">Muestras</span>
           </div>
        </div>

        {/* Medidores Circulares */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {FINGER_CONFIG.map(f => (
            <FingerGauge 
              key={f.key}
              label={f.label} 
              value={currentData[f.key as keyof FingerData] as number} 
              color={f.colorClass} 
              bg={f.bgClass} 
            />
          ))}
        </div>

        {/* Gráfico Histórico con Filtros */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h3 className="text-lg font-medium text-slate-800">Análisis de Movimiento</h3>
            
            {/* Filtros de Dedos */}
            <div className="flex flex-wrap gap-2">
              {FINGER_CONFIG.map(f => (
                <button
                  key={f.key}
                  onClick={() => toggleFinger(f.key)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                    visibleFingers[f.key] 
                      ? `${f.bgClass} ${f.colorClass} border-transparent shadow-sm` 
                      : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {visibleFingers[f.key] ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="timestamp" hide />
                <YAxis domain={[0, 180]} tick={{fontSize: 12, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }} 
                  itemStyle={{ padding: 0 }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                {FINGER_CONFIG.map(f => (
                   <Line 
                    key={f.key}
                    type="monotone" 
                    dataKey={f.key} 
                    stroke={f.color} 
                    strokeWidth={2.5} 
                    dot={false} 
                    name={f.label}
                    hide={!visibleFingers[f.key]}
                    isAnimationActive={false} // Performance
                   />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sección de Análisis AI */}
        <div className="relative overflow-hidden bg-white rounded-3xl shadow-lg border border-indigo-50">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
          <div className="p-8">
            <div className="flex flex-col md:flex-row gap-8">
              {/* Columna Izquierda: Input y Botón */}
              <div className="md:w-1/3 space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-slate-800 flex items-center mb-2">
                    <Brain className="w-6 h-6 mr-2 text-indigo-600" />
                    Asistente Clínico (Gemini)
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Genera un reporte detallado del progreso utilizando <strong>Gemini AI</strong> para analizar los datos biomecánicos.
                  </p>
                </div>

                <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Paciente</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input 
                        type="text" 
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        placeholder="Nombre completo"
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={generateAIReport}
                    disabled={isGeneratingReport || history.length < 5}
                    className={`w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-medium transition-all shadow-sm
                      ${(isGeneratingReport || history.length < 5) 
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'}`}
                  >
                    {isGeneratingReport ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        <span>Analizando con Gemini...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Generar Informe</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Columna Derecha: Resultado */}
              <div className="md:w-2/3 flex flex-col h-full">
                <div className="flex justify-between items-center mb-4">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Informe Generado</label>
                  {aiReport && (
                    <button 
                      onClick={downloadPDF}
                      className="text-xs flex items-center bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <FileDown className="w-3.5 h-3.5 mr-1.5" />
                      Descargar PDF
                    </button>
                  )}
                </div>
                {aiReport ? (
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex-grow h-full max-h-96 overflow-y-auto custom-scrollbar">
                    <div className="prose prose-sm prose-indigo max-w-none text-slate-700">
                      <div className="whitespace-pre-wrap">{aiReport}</div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-100">
                    <Fingerprint className="w-10 h-10 mb-3 opacity-20" />
                    <p className="text-sm">Esperando datos para análisis de Gemini...</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};

// Componente para Medidor Circular (Radial Gauge simple)
const FingerGauge = ({ label, value, color, bg }: { label: string, value: number, color: string, bg: string }) => {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 180) * circumference;

  return (
    <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center transition-transform hover:scale-[1.02]">
      <div className="relative w-20 h-20 mb-3">
        {/* Background Circle */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={radius}
            stroke="currentColor"
            strokeWidth="6"
            fill="transparent"
            className="text-slate-50"
          />
          {/* Progress Circle */}
          <circle
            cx="40"
            cy="40"
            r={radius}
            stroke="currentColor"
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`${color} transition-all duration-500 ease-out`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-bold ${color}`}>{value}°</span>
        </div>
      </div>
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);