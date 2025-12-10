import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Activity, Bluetooth, Brain, Play, Square, Save, RotateCcw, Fingerprint, Wifi, WifiOff, User, CheckCircle2, Circle, FileDown, Info, AlertCircle, Key } from 'lucide-react';
import { jsPDF } from "jspdf";

// Definición de tipos para Web Bluetooth API y AI Studio
declare global {
  interface BluetoothRemoteGATTServer {
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    connected: boolean;
    device: BluetoothDevice;
    getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
  }

  interface BluetoothRemoteGATTService {
    uuid: string;
    getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    uuid: string;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(type: string, listener: (event: any) => void): void;
    readValue(): Promise<DataView>;
    value: DataView;
  }

  interface BluetoothDevice {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: string, listener: (event: any) => void): void;
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

// UUIDs Comunes para módulos Serial Bluetooth (HM-10, AT-09, Nordic, etc.)
const BLE_SERVICES = [
  0xFFE0, // HM-10 Default
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 Full UUID
  0x1801, // Generic Attribute
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
];

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
  const [connectedDeviceName, setConnectedDeviceName] = useState<string>('');
  const [hasApiKey, setHasApiKey] = useState(false);
  
  // Nuevo Estado
  const [patientName, setPatientName] = useState('');
  const [visibleFingers, setVisibleFingers] = useState<Record<string, boolean>>({
    pulgar: true, indice: true, medio: true, anular: true, menique: true
  });
  
  // Referencias para Bluetooth
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);
  const bufferRef = useRef<string>(""); // Para acumular fragmentos de datos Bluetooth

  // Verificar si hay API Key seleccionada al cargar
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        // Fallback para entornos locales o dev manual
        setHasApiKey(!!process.env.API_KEY);
      }
    };
    checkKey();
  }, []);

  // Función para abrir el selector de API Key
  const handleConnectGemini = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
        // Asumimos éxito si no lanza error (Race condition mitigation)
        setHasApiKey(true);
      } catch (error) {
        console.error("Error seleccionando key:", error);
      }
    }
  };

  // Manejo de datos entrantes desde Bluetooth
  const handleCharacteristicValueChanged = (event: any) => {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const chunk = decoder.decode(value);
    
    // Acumular buffer (los datos pueden llegar fragmentados)
    bufferRef.current += chunk;

    // Buscamos saltos de línea que indiquen fin de paquete (o intentamos parsear si es CSV directo)
    if (bufferRef.current.includes('\n') || bufferRef.current.split(',').length >= 5) {
      const lines = bufferRef.current.split(/\r?\n/);
      
      // Procesamos la última línea completa o el buffer entero si no hay newlines pero parece completo
      let dataString = lines.length > 1 ? lines[lines.length - 2] : bufferRef.current;
      
      // Limpiamos el buffer si procesamos líneas, o lo reseteamos si se vuelve muy grande (error)
      if (lines.length > 1) {
        bufferRef.current = lines[lines.length - 1]; 
      } else if (bufferRef.current.length > 50) {
        bufferRef.current = ""; // Reset de seguridad
      }

      const values = dataString.split(',').map(v => parseInt(v.trim()));

      if (values.length >= 5 && !values.some(isNaN)) {
        const now = new Date();
        const timeString = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        
        const newData = {
          timestamp: timeString,
          pulgar: values[0] || 0,
          indice: values[1] || 0,
          medio: values[2] || 0,
          anular: values[3] || 0,
          menique: values[4] || 0,
        };

        setCurrentData(newData);
        if (sessionActive) {
            setHistory(prev => {
              const newHistory = [...prev, newData];
              if (newHistory.length > 60) return newHistory.slice(newHistory.length - 60);
              return newHistory;
            });
        }
      }
    }
  };

  // Función para conectar Bluetooth Real
  const connectBluetooth = async () => {
    setDeviceError('');
    setBtStatus('Escaneando...');

    if (!navigator.bluetooth) {
      setDeviceError('Tu navegador no soporta Bluetooth Web. Usa Chrome en PC/Android o Bluefy en iOS.');
      return;
    }

    try {
      // Solicitar dispositivo
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_SERVICES
      });

      setBtStatus('Conectando al servidor GATT...');
      deviceRef.current = device;
      setConnectedDeviceName(device.name || 'Dispositivo desconocido');
      
      const server = await device.gatt?.connect();
      if (!server) throw new Error("No se pudo conectar al servidor GATT");
      serverRef.current = server;

      setBtStatus('Buscando servicio Serial...');
      
      // Intentar encontrar el servicio serial
      let service: BluetoothRemoteGATTService | null = null;
      
      // Estrategia: Buscar servicio primario conocido
      try {
        service = await server.getPrimaryService(0xFFE0); // HM-10 estándar
      } catch (e) {
        // Si falla, buscar otros UUIDs o listar todos (estrategia de fallback)
        console.warn("Servicio 0xFFE0 no encontrado, probando alternativos...");
        try {
            service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
        } catch (e2) {
             setDeviceError('No se encontró el servicio Serial (FFE0). Asegúrate que es un módulo BLE compatible (HM-10, AT-09).');
             server.disconnect();
             setBtStatus('');
             return;
        }
      }

      if (service) {
        setBtStatus('Configurando notificaciones...');
        // Intentar obtener la característica de notificación (usualmente FFE1)
        const characteristic = await service.getCharacteristic(0xFFE1) 
           .catch(() => service?.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb'));

        if (characteristic) {
          await characteristic.startNotifications();
          characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
          
          setIsConnected(true);
          setSessionActive(true); // Auto-iniciar captura al conectar
          setBtStatus('');
        } else {
          throw new Error("No se encontró característica de lectura (FFE1)");
        }
      }

    } catch (error: any) {
      console.error(error);
      setBtStatus('');
      setIsConnected(false);
      if (error.name === 'NotFoundError') {
        setDeviceError('Usuario canceló la selección.');
      } else if (error.name === 'SecurityError') {
        setDeviceError('Permiso denegado. Requiere interacción del usuario o HTTPS.');
      } else {
        setDeviceError(`Error: ${error.message}. Intenta reconectar.`);
      }
    }
  };

  // Función para modo Demo (Simulación)
  const toggleSimulation = () => {
    if (isSimulating) {
      setIsSimulating(false);
      setIsConnected(false);
      setSessionActive(false);
      setConnectedDeviceName('');
    } else {
      setIsSimulating(true);
      setIsConnected(true);
      setSessionActive(true);
      setConnectedDeviceName('Modo Simulación');
    }
  };

  // Efecto para generar datos simulados
  useEffect(() => {
    let interval: any;

    if (isSimulating && sessionActive) {
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
          if (newHistory.length > 60) return newHistory.slice(newHistory.length - 60);
          return newHistory;
        });

      }, 500); 
    }

    return () => clearInterval(interval);
  }, [isSimulating, sessionActive, currentData]);

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
    // Si no hay key en el entorno, intentamos pedirla (si no se pidió antes)
    if (!process.env.API_KEY && !hasApiKey) {
        setAiReport("Error: Debes conectar tu cuenta de Google Gemini primero.");
        return;
    }

    // Instanciar el cliente justo antes de llamar para obtener la key actualizada
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

    if (history.length === 0) return;
    setIsGeneratingReport(true);
    setAiReport('');

    try {
      const stats = {
        muestras: history.length,
        promedio_indice: Math.round(history.reduce((a, b) => a + b.indice, 0) / history.length),
        max_indice: Math.max(...history.map(h => h.indice)),
        promedio_medio: Math.round(history.reduce((a, b) => a + b.medio, 0) / history.length),
        max_medio: Math.max(...history.map(h => h.medio)),
      };

      const prompt = `
        Eres un asistente experto en fisioterapia utilizando el modelo Gemini 2.5 Flash.
        Analiza los datos de telemetría de un guante de rehabilitación.
        
        PACIENTE: ${patientName || 'No registrado'}
        DATOS DE SESIÓN:
        - Muestras totales: ${stats.muestras}
        - Flexión Índice (Grados): Promedio ${stats.promedio_indice}°, Máximo ${stats.max_indice}°
        - Flexión Medio (Grados): Promedio ${stats.promedio_medio}°, Máximo ${stats.max_medio}°
        
        CONTEXTO: 
        0° = Mano abierta (Extensión). 
        180° = Puño cerrado (Flexión completa).
        
        TAREA:
        Genera un reporte clínico breve (máximo 150 palabras) en español.
        Estructura:
        1. **Evaluación de Progreso**: ¿Alcanzó rangos funcionales?
        2. **Observaciones**: Detectar fatiga o inconsistencias si las hay (basado en promedios).
        3. **Plan**: Recomendación simple.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      setAiReport(response.text || "Gemini no devolvió texto.");
    } catch (error: any) {
      console.error("Gemini Error:", error);
      let errorMsg = "Error conectando con Gemini.";
      if (error.message.includes('403')) errorMsg = "Error de permisos (API Key inválida o cuota excedida).";
      if (error.message.includes('Failed to fetch')) errorMsg = "Error de conexión a internet.";
      
      // Si el error es por falta de key (400/403), sugerir reconectar
      if (errorMsg.includes("API Key") && window.aistudio) {
          setHasApiKey(false); // Resetear estado para mostrar botón
          errorMsg += " Por favor, vuelve a vincular tu cuenta.";
      }
      
      setAiReport(errorMsg);
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
    doc.setFillColor(30, 41, 59); // Slate 900
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("PhysioSense AI", 20, 20);
    doc.setFontSize(12);
    doc.setTextColor(200, 200, 200);
    doc.text("Reporte de Rehabilitación Asistida", 20, 30);
    
    // Info Paciente
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text(`Paciente:`, 20, 55);
    doc.setFont("helvetica", "bold");
    doc.text(`${patientName || 'No especificado'}`, 50, 55);
    
    doc.setFont("helvetica", "normal");
    doc.text(`Fecha:`, 20, 62);
    doc.text(`${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 50, 62);
    
    doc.text(`Dispositivo:`, 120, 62);
    doc.text(`${connectedDeviceName || 'Simulación'}`, 150, 62);

    // Stats
    doc.setDrawColor(200);
    doc.line(20, 70, pageWidth - 20, 70);
    
    doc.setFontSize(14);
    doc.setTextColor(33, 150, 243);
    doc.text("Resumen de Datos", 20, 85);
    doc.setFontSize(10);
    doc.setTextColor(60);
    
    if (history.length > 0) {
      const maxIndice = Math.max(...history.map(h => h.indice));
      const maxMedio = Math.max(...history.map(h => h.medio));
      doc.text(`• Duración Sesión: ${history.length} puntos de datos`, 25, 95);
      doc.text(`• Rango Máx. Índice: ${maxIndice}°`, 25, 102);
      doc.text(`• Rango Máx. Medio: ${maxMedio}°`, 25, 109);
    } else {
        doc.text("No hay datos registrados en esta sesión.", 25, 95);
    }

    doc.line(20, 120, pageWidth - 20, 120);

    // AI Report
    doc.setFontSize(14);
    doc.setTextColor(147, 51, 234); // Purple
    doc.text("Análisis Gemini AI", 20, 135);
    
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.setFont("times", "roman");
    
    // Limpieza de markdown simple para el PDF
    const cleanReport = aiReport.replace(/\*\*/g, '').replace(/\*/g, '-');
    const splitText = doc.splitTextToSize(cleanReport, pageWidth - 40);
    doc.text(splitText, 20, 145);
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Generado automáticamente por PhysioSense AI y Google Gemini.", 20, pageWidth - 20); // Bottom is actually height but approximating
    
    doc.save(`PhysioSense_${patientName.replace(/\s/g, '_') || 'Report'}.pdf`);
  };

  const toggleFinger = (key: string) => {
    setVisibleFingers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Pantalla de Conexión Minimalista
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-10 space-y-8 text-center transition-all duration-500 ease-in-out border border-slate-100 relative overflow-hidden">
          
          <div className="space-y-2 relative z-10">
            <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-emerald-100">
              <Activity className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-light tracking-tight text-slate-900">PhysioSense AI</h1>
            <p className="text-slate-500 font-light">Rehabilitación inteligente asistida por <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600">Gemini</span></p>
          </div>
          
          <div className="bg-blue-50/50 p-5 rounded-2xl text-left border border-blue-100 relative">
             <div className="flex items-start">
               <Info className="w-5 h-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
               <div>
                  <h3 className="text-sm font-semibold text-blue-800 mb-1">Instrucciones de Bluetooth</h3>
                  <p className="text-xs text-blue-700 leading-relaxed mb-2">
                    1. Enciende tu guante sensor.<br/>
                    2. Presiona "Conectar" abajo.<br/>
                    3. Busca dispositivos con nombres como:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {['HM-10', 'HC-08', 'BT05', 'AT-09', 'MLT-BT05'].map(name => (
                        <span key={name} className="px-2 py-0.5 bg-white rounded-md text-[10px] font-mono text-blue-600 border border-blue-200 shadow-sm">{name}</span>
                    ))}
                  </div>
               </div>
             </div>
          </div>

          <div className="space-y-4 pt-2 relative z-10">
            <button 
              onClick={connectBluetooth}
              disabled={!!btStatus}
              className={`w-full group relative flex items-center justify-center py-4 px-6 border border-transparent text-sm font-medium rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5
                ${btStatus ? 'bg-slate-500 cursor-wait' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              {btStatus ? (
                  <div className="flex items-center">
                      <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                      {btStatus}
                  </div>
              ) : (
                  <>
                    <Bluetooth className="w-5 h-5 mr-3" />
                    Conectar Guante
                  </>
              )}
            </button>
            
            <button 
              onClick={toggleSimulation}
              className="w-full flex items-center justify-center py-4 px-6 border border-slate-200 text-sm font-medium rounded-2xl text-slate-600 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              <Play className="w-5 h-5 mr-3 text-slate-400" />
              Modo Demo (Sin Sensores)
            </button>
          </div>

          {deviceError && (
            <div className="p-4 bg-red-50 text-red-600 rounded-xl text-xs border border-red-100 flex items-start text-left animate-in fade-in slide-in-from-bottom-2">
              <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>{deviceError}</span>
            </div>
          )}
          
          <div className="absolute bottom-4 left-0 w-full text-center">
             <p className="text-[10px] text-slate-300 font-light">PhysioSense v1.2</p>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard Principal
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-10 font-sans">
      {/* Header Simplificado */}
      <header className="bg-white/80 backdrop-blur-sm sticky top-0 z-50 border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-100 p-2 rounded-xl">
              <Activity className="text-emerald-600 w-5 h-5" />
            </div>
            <div>
                <span className="block text-lg font-medium text-slate-800 tracking-tight leading-tight">PhysioSense AI</span>
                <span className="block text-[10px] text-slate-500 font-medium">
                    {connectedDeviceName ? `Conectado a: ${connectedDeviceName}` : 'Desconectado'}
                </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button 
                onClick={() => {
                    if (serverRef.current) serverRef.current.disconnect();
                    setIsConnected(false);
                }}
                className="text-xs text-red-500 hover:text-red-600 font-medium px-4 py-2 rounded-full hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
             >
               Desconectar
             </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        
        {/* Sección de Estado y Control */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <div className="md:col-span-2 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-light text-slate-900">Estado de Sesión</h2>
                <div className="flex items-center mt-2 space-x-2">
                    <span className={`flex w-2.5 h-2.5 rounded-full ${sessionActive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
                    <p className="text-slate-500 text-sm">
                    {sessionActive ? 'Recibiendo datos...' : 'En espera'}
                    </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setSessionActive(!sessionActive)}
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-sm ${sessionActive ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'}`}
                >
                  {sessionActive ? <Square className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                </button>
                <button 
                  onClick={handleClear}
                  className="w-14 h-14 rounded-2xl bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 flex items-center justify-center transition-all"
                  title="Reiniciar Sesión"
                >
                  <RotateCcw className="w-6 h-6" />
                </button>
              </div>
           </div>

           <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center items-center relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Fingerprint className="w-24 h-24" />
              </div>
              <span className="text-5xl font-bold text-slate-800 tracking-tighter">{history.length}</span>
              <span className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-2">Puntos de Datos</span>
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
            <h3 className="text-lg font-medium text-slate-800">Telemetría en Tiempo Real</h3>
            
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
                    isAnimationActive={false}
                   />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sección de Análisis AI */}
        <div className="relative overflow-hidden bg-white rounded-3xl shadow-lg border border-indigo-50">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
          <div className="p-8">
            <div className="flex flex-col md:flex-row gap-8">
              {/* Columna Izquierda: Input y Botón */}
              <div className="md:w-1/3 space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-slate-800 flex items-center mb-2">
                    <Brain className="w-6 h-6 mr-2 text-indigo-600" />
                    Asistente Gemini
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    La IA analiza los patrones de movimiento y genera una evaluación clínica profesional.
                  </p>
                </div>

                <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                  
                  {hasApiKey ? (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nombre del Paciente</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                          <input 
                            type="text" 
                            value={patientName}
                            onChange={(e) => setPatientName(e.target.value)}
                            placeholder="Ej: Juan Pérez"
                            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
                          />
                        </div>
                      </div>
                      
                      <button 
                        onClick={generateAIReport}
                        disabled={isGeneratingReport || history.length < 5}
                        className={`w-full flex items-center justify-center space-x-2 py-3.5 rounded-xl font-medium transition-all shadow-md
                          ${(isGeneratingReport || history.length < 5) 
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 hover:-translate-y-0.5'}`}
                      >
                        {isGeneratingReport ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                            <span>Procesando...</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            <span>Generar Informe con Gemini</span>
                          </>
                        )}
                      </button>
                      {history.length < 5 && !isSimulating && (
                          <p className="text-xs text-center text-amber-600 bg-amber-50 p-2 rounded-lg">Se necesitan más datos para generar reporte.</p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                       <p className="text-sm text-slate-600 mb-4">Para generar reportes clínicos, necesitas conectar tu cuenta de Google.</p>
                       <button 
                         onClick={handleConnectGemini}
                         className="w-full flex items-center justify-center py-3 rounded-xl bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 hover:shadow-sm transition-all text-sm"
                       >
                         <Key className="w-4 h-4 mr-2 text-indigo-500" />
                         Vincular Cuenta Gemini
                       </button>
                       <p className="text-[10px] text-slate-400 mt-2">Se abrirá una ventana segura de Google AI Studio.</p>
                    </div>
                  )}

                </div>
              </div>

              {/* Columna Derecha: Resultado */}
              <div className="md:w-2/3 flex flex-col h-full">
                <div className="flex justify-between items-center mb-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Reporte Clínico</label>
                  {aiReport && !aiReport.includes("Error") && (
                    <button 
                      onClick={downloadPDF}
                      className="text-xs flex items-center bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl transition-all shadow-sm font-medium"
                    >
                      <FileDown className="w-4 h-4 mr-2 text-red-500" />
                      Descargar PDF
                    </button>
                  )}
                </div>
                {aiReport ? (
                  <div className={`p-6 rounded-2xl border flex-grow h-full max-h-96 overflow-y-auto custom-scrollbar shadow-inner ${aiReport.includes("Error") ? 'bg-red-50 border-red-100 text-red-700' : 'bg-white border-slate-200'}`}>
                    <div className={`prose prose-sm max-w-none ${aiReport.includes("Error") ? '' : 'prose-indigo text-slate-700'}`}>
                      <div className="whitespace-pre-wrap leading-relaxed">{aiReport}</div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[250px] flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
                    <Brain className="w-12 h-12 mb-3 opacity-20 text-indigo-500" />
                    <p className="text-sm font-medium">El análisis aparecerá aquí</p>
                    <p className="text-xs opacity-70 mt-1">Requiere datos de sensores y vinculación de cuenta</p>
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
      <div className="relative w-24 h-24 mb-3 flex items-center justify-center">
        {/* Background Circle */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className="text-slate-50"
          />
          {/* Progress Circle */}
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`${color} transition-all duration-500 ease-out`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tracking-tight ${color}`}>{value}°</span>
        </div>
      </div>
      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);