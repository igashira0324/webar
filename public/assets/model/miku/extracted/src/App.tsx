import React, { useEffect, useRef, useState, useCallback } from 'react';
import { vrmService } from './services/vrmService';
import { poseService } from './services/poseService';
import { audioEngine } from './services/audioEngine';
import { VRMViewport } from './components/VRMViewport';
import { LyricsDisplay } from './components/LyricsDisplay';
import { DEMO_LYRICS, DEMO_POSES, PoseTarget, SONG_DURATION } from './constants';
import { VRM } from '@pixiv/three-vrm';
import * as Kalidokit from 'kalidokit';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Camera, Play, RotateCcw, Trophy } from 'lucide-react';
import { cn } from './lib/utils';

type GameState = 'START' | 'PLAYING' | 'RESULT';

export default function App() {
  const [gameState, setGameState] = useState<GameState>('START');
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [isVrmLoading, setIsVrmLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [results, setResults] = useState({ perfect: 0, great: 0, good: 0, miss: 0 });
  const [judgment, setJudgment] = useState<string | null>(null);
  const [nextPose, setNextPose] = useState<PoseTarget | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const [isPoseReady, setIsPoseReady] = useState(false);

  const gameStateRef = useRef<GameState>('START');
  const vrmRef = useRef<VRM | null>(null);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const resultsRef = useRef({ perfect: 0, great: 0, good: 0, miss: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const animationFrameIdRef = useRef<number | null>(null);
  const lastPoseTimeRef = useRef(-1);

  const [debugStatus, setDebugStatus] = useState("");
  const [showForceStart, setShowForceStart] = useState(false);

  useEffect(() => {
    let timer: number;
    if (gameState === 'PLAYING' && (!isCameraReady || !isSceneReady || !isPoseReady)) {
      timer = window.setTimeout(() => {
        setShowForceStart(true);
      }, 5000);
    } else {
      setShowForceStart(false);
    }
    return () => clearTimeout(timer);
  }, [gameState, isCameraReady, isSceneReady, isPoseReady]);

  const loadDefaultVRM = useCallback(async () => {
    setIsVrmLoading(true);
    setDebugStatus(prev => prev + "\nVRM: Loading...");
    try {
      // More robust list of VRM URLs
      const urls = [
        // AliciaSolid (Official Spec) - Try GitHub Pages first
        'https://vrm-c.github.io/vrm-specification/samples/AliciaSolid/VRM0/AliciaSolid.vrm',
        'https://vrm-c.github.io/vrm-specification/samples/Seed-kun/VRM0/Seed-kun.vrm',
        
        // JSDelivr CDN (often more stable)
        'https://cdn.jsdelivr.net/gh/vrm-c/vrm-specification@master/samples/AliciaSolid/VRM0/AliciaSolid.vrm',
        'https://cdn.jsdelivr.net/gh/vrm-c/vrm-specification@master/samples/Seed-kun/VRM0/Seed-kun.vrm',
        
        // Three-VRM Girl (Pixiv)
        'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/vrm/three-vrm-girl.vrm',
        'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/three-vrm-girl.vrm',
        
        // Raw GitHub (Fallback)
        'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/AliciaSolid/VRM0/AliciaSolid.vrm',
        'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-kun/VRM0/Seed-kun.vrm',
        'https://raw.githubusercontent.com/pixiv/three-vrm/master/packages/three-vrm/examples/models/vrm/three-vrm-girl.vrm',
        'https://raw.githubusercontent.com/pixiv/three-vrm/master/packages/three-vrm/examples/models/three-vrm-girl.vrm'
      ];
      
      let loadedVrm = null;
      for (const url of urls) {
        try {
          console.log(`App: Trying to load VRM from ${url}`);
          loadedVrm = await vrmService.loadVRM(url);
          if (loadedVrm) {
            console.log(`App: Successfully loaded VRM from ${url}`);
            break;
          }
        } catch (err) {
          console.warn(`App: Failed to load from ${url}, trying next...`);
        }
      }
      
      if (loadedVrm) {
        setVrm(loadedVrm);
        console.log("App: Default VRM loaded successfully.");
        setDebugStatus(prev => prev + "\nVRM: READY");
      } else {
        throw new Error("All VRM fallback URLs failed.");
      }
    } catch (err) {
      console.error("App: Failed to load default VRM", err);
      setDebugStatus(prev => prev + `\nVRM: FAILED (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      setIsVrmLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDefaultVRM();

    setDebugStatus("Initializing PoseLandmarker...");
    poseService.init().then(() => {
      console.log("App: PoseLandmarker ready.");
      setIsPoseReady(true);
      setDebugStatus(prev => prev + "\nPoseLandmarker: READY");
    }).catch(err => {
      console.error("App: PoseLandmarker init failed", err);
      setDebugStatus(prev => prev + "\nPoseLandmarker: FAILED");
    });
  }, []);

  useEffect(() => {
    setDebugStatus(prev => {
      const lines = prev.split('\n').filter(l => !l.startsWith('State:'));
      return [...lines, `State: ${gameState}`, `Camera: ${isCameraReady ? 'READY' : 'WAITING'}`, `Scene: ${isSceneReady ? 'READY' : 'WAITING'}`, `Pose: ${isPoseReady ? 'READY' : 'WAITING'}`].join('\n');
    });
  }, [gameState, isCameraReady, isSceneReady, isPoseReady]);

  useEffect(() => {
    gameStateRef.current = gameState;
    vrmRef.current = vrm;
    scoreRef.current = score;
    comboRef.current = combo;
    resultsRef.current = results;
  }, [gameState, vrm, score, combo, results]);

  // Sync canvas size with video
  useEffect(() => {
    if (isCameraReady && videoRef.current && canvasRef.current) {
      const syncSize = () => {
        if (videoRef.current && canvasRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
          console.log(`App: Canvas size synced to ${canvasRef.current.width}x${canvasRef.current.height}`);
        }
      };
      
      if (videoRef.current.readyState >= 2) {
        syncSize();
      } else {
        const video = videoRef.current;
        video.addEventListener('loadedmetadata', syncSize);
        return () => video.removeEventListener('loadedmetadata', syncSize);
      }
    }
  }, [isCameraReady]);

  // Camera initialization
  useEffect(() => {
    let stream: MediaStream | null = null;
    let isMounted = true;
    
    const initCamera = async () => {
      console.log("App: initCamera starting...");
      
      if (!videoRef.current) {
        console.log("App: videoRef.current is null, retrying in 200ms...");
        if (isMounted) setTimeout(initCamera, 200);
        return;
      }

      try {
        console.log("App: Requesting getUserMedia...");
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 }, 
            height: { ideal: 480 },
            facingMode: "user"
          } 
        });
        
        if (videoRef.current && isMounted) {
          videoRef.current.srcObject = stream;
          videoRef.current.load(); // Explicitly load
          
          const playVideo = async () => {
            try {
              if (videoRef.current && isMounted) {
                await videoRef.current.play();
                console.log("App: Video playing successfully.");
                setIsCameraReady(true);
                setDebugStatus(prev => prev + "\nCamera: OK");
              }
            } catch (e) {
              console.error("App: Video play failed", e);
              setDebugStatus(prev => prev + `\nCamera Play Error: ${e}`);
            }
          };

          if (videoRef.current.readyState >= 2) {
            playVideo();
          } else {
            videoRef.current.onloadedmetadata = () => {
              console.log("App: Video metadata loaded.");
              playVideo();
            };
          }
        }
      } catch (err) {
        console.error("App: Camera init failed", err);
        setDebugStatus(prev => prev + `\nCamera Error: ${err}`);
        // If it's a permission error, we should tell the user
        if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          alert("カメラの使用が許可されていません。ブラウザの設定を確認してください。");
        }
      }
    };
    
    initCamera();

    return () => {
      isMounted = false;
      if (stream) {
        console.log("App: Stopping camera stream.");
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Run once on mount

  // Game Loop Management
  useEffect(() => {
    if (gameState === 'PLAYING' && isCameraReady && isSceneReady && isPoseReady) {
      console.log("App: All ready (Camera, Scene, Pose). Starting game loop...");
      
      const startGameLoop = async () => {
        try {
          console.log("App: Initializing audio playback...");
          await audioEngine.playDemo();
          console.log("App: Audio playback started.");
        } catch (err) {
          console.error("App: Audio playback failed", err);
        }
        
        const loop = () => {
          if (gameStateRef.current !== 'PLAYING') {
            console.log("App: Game loop stopped (state changed).");
            return;
          }
          
          const delta = clockRef.current.getDelta();
          const time = audioEngine.getCurrentTime();
          setCurrentTime(time);

          // Update VRM
          if (vrmRef.current) {
            vrmRef.current.update(delta);
          }

          // Pose detection
          let currentDetectionResults: any = null;
          if (videoRef.current && canvasRef.current && isCameraReady) {
            currentDetectionResults = poseService.detect(videoRef.current, performance.now());
            if (currentDetectionResults && currentDetectionResults.landmarks && currentDetectionResults.landmarks[0] && currentDetectionResults.worldLandmarks && currentDetectionResults.worldLandmarks[0]) {
              const landmarks = currentDetectionResults.landmarks[0];
              const worldLandmarks = currentDetectionResults.worldLandmarks[0];
              const kalidoPose = Kalidokit.Pose.solve(worldLandmarks, landmarks, { runtime: 'mediapipe', video: videoRef.current }) as any;
              
                if (kalidoPose && vrmRef.current) {
                  // Apply rotations to VRM bones with mirroring (swap Left and Right)
                  rigRotation('Hips', kalidoPose.Hips.rotation, 0.2);
                  rigRotation('Spine', kalidoPose.Spine, 0.2);
                  if (kalidoPose.Chest) rigRotation('Chest', kalidoPose.Chest, 0.2);
                  if (kalidoPose.Neck) rigRotation('Neck', kalidoPose.Neck, 0.2);
                  if (kalidoPose.Head) rigRotation('Head', kalidoPose.Head, 0.2);
                  
                  // Mirroring: User's Left -> VRM's Right (from user's perspective it looks like a mirror)
                  rigRotation('RightUpperArm', kalidoPose.LeftUpperArm, 0.2);
                  rigRotation('RightLowerArm', kalidoPose.LeftLowerArm, 0.2);
                  rigRotation('LeftUpperArm', kalidoPose.RightUpperArm, 0.2);
                  rigRotation('LeftLowerArm', kalidoPose.RightLowerArm, 0.2);
                  
                  rigRotation('RightUpperLeg', kalidoPose.LeftUpperLeg, 0.2);
                  rigRotation('RightLowerLeg', kalidoPose.LeftLowerLeg, 0.2);
                  rigRotation('LeftUpperLeg', kalidoPose.RightUpperLeg, 0.2);
                  rigRotation('LeftLowerLeg', kalidoPose.RightLowerLeg, 0.2);
                }
              drawSkeleton(landmarks);
            }
          }

          // Rhythm game logic
          const currentPose = DEMO_POSES.find(p => time >= p.time - 0.5 && time <= p.time + 0.5);
          const upcomingPose = DEMO_POSES.find(p => p.time > time);
          setNextPose(upcomingPose || null);

          if (currentPose && lastPoseTimeRef.current !== currentPose.time) {
            // Real pose judgment
            let matchScore = 0;
            if (currentDetectionResults && currentDetectionResults.worldLandmarks && currentDetectionResults.worldLandmarks[0]) {
              const lm = currentDetectionResults.worldLandmarks[0];
              
              // Calculate arm angles (simplified)
              // Vector from shoulder to elbow
              const getAngle = (p1: any, p2: any) => {
                const dy = p2.y - p1.y;
                const dx = p2.x - p1.x;
                return Math.atan2(dy, dx) * (180 / Math.PI);
              };

              // MediaPipe Pose Indices:
              // 11: L Shoulder, 13: L Elbow, 15: L Wrist
              // 12: R Shoulder, 14: R Elbow, 16: R Wrist
              const lArmAngle = -getAngle(lm[11], lm[13]);
              const rArmAngle = -getAngle(lm[12], lm[14]);
              
              const lDiff = Math.abs(lArmAngle - currentPose.pose.leftArm);
              const rDiff = Math.abs(rArmAngle - currentPose.pose.rightArm);
              
              matchScore = 100 - (lDiff + rDiff) / 2;
              matchScore = Math.max(0, Math.min(100, matchScore));
            } else {
              // No pose detected at the moment of judgment
              matchScore = 0;
            }
            
            handleJudgment(matchScore);
            lastPoseTimeRef.current = currentPose.time;
          }

          if (time > SONG_DURATION) {
            console.log("App: Song ended.");
            setGameState('RESULT');
            audioEngine.stop();
            return;
          }

          animationFrameIdRef.current = requestAnimationFrame(loop);
        };

        animationFrameIdRef.current = requestAnimationFrame(loop);
      };

      startGameLoop();
      
      return () => {
        if (animationFrameIdRef.current) {
          cancelAnimationFrame(animationFrameIdRef.current);
        }
      };
    }
  }, [gameState, isCameraReady, isSceneReady, isPoseReady]);

  const handleFileUpload = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith('.vrm')) {
      console.error('App: Invalid file type. Please select a .vrm file.');
      setDebugStatus(prev => prev + "\nUpload: Invalid file type");
      return;
    }
    
    setIsVrmLoading(true);
    setDebugStatus(prev => prev + `\nUploading: ${file.name}`);
    try {
      const url = URL.createObjectURL(file);
      const loadedVrm = await vrmService.loadVRM(url);
      setVrm(loadedVrm);
      console.log("App: User VRM loaded successfully.");
      setDebugStatus(prev => prev + "\nUpload: SUCCESS");
    } catch (err) {
      console.error("App: User VRM load failed", err);
      setDebugStatus(prev => prev + `\nUpload: FAILED (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      setIsVrmLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const startGame = async () => {
    try {
      console.log("App: Starting game sequence...");
      audioEngine.init();
      setIsCameraReady(false);
      lastPoseTimeRef.current = -1;
      clockRef.current = new THREE.Clock();
      setGameState('PLAYING');
    } catch (err) {
      console.error("App: Start failed", err);
    }
  };

  const rigRotation = (name: string, rotation: any, lerp = 0.1) => {
    if (!vrmRef.current) return;
    const bone = vrmRef.current.humanoid.getNormalizedBoneNode(name as any);
    if (!bone) return;
    
    const euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    bone.quaternion.slerp(quaternion, lerp);
  };

  const drawSkeleton = (landmarks: any) => {
    if (!canvasRef.current || !videoRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;

    // Simplified skeleton drawing
    landmarks.forEach((lm: any) => {
      ctx.beginPath();
      ctx.arc(lm.x * canvasRef.current!.width, lm.y * canvasRef.current!.height, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff00ff';
      ctx.fill();
    });
  };

  const handleJudgment = (matchScore: number) => {
    let res = 'MISS';
    let points = 0;
    if (matchScore > 90) { res = 'PERFECT'; points = 1000; }
    else if (matchScore > 70) { res = 'GREAT'; points = 500; }
    else if (matchScore > 50) { res = 'GOOD'; points = 200; }

    setJudgment(res);
    setTimeout(() => setJudgment(null), 1000);

    if (res !== 'MISS') {
      setScore(s => s + points + comboRef.current * 10);
      setCombo(c => {
        const newCombo = c + 1;
        setMaxCombo(m => Math.max(m, newCombo));
        return newCombo;
      });
      setResults(r => ({ ...r, [res.toLowerCase()]: r[res.toLowerCase() as keyof typeof r] + 1 }));
    } else {
      setCombo(0);
      setResults(r => ({ ...r, miss: r.miss + 1 }));
    }
  };

  const getRank = () => {
    if (score > 10000) return 'S';
    if (score > 7000) return 'A';
    if (score > 4000) return 'B';
    return 'C';
  };

  return (
    <div className="h-screen w-full bg-[#050508] text-white font-sans flex flex-col overflow-hidden select-none">
      {/* Header */}
      <header className="h-16 px-8 flex items-center justify-between border-b border-white/5 bg-black/40 backdrop-blur-md z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-fuchsia-500 rounded-lg flex items-center justify-center">
            <Play className="w-4 h-4 text-white fill-current" />
          </div>
          <h1 className="text-xl font-black tracking-tighter italic">AI DANCE CHALLENGE</h1>
        </div>

        {gameState === 'PLAYING' && (
          <div className="flex items-center gap-12">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Score</span>
              <span className="text-2xl font-black tabular-nums">{score.toLocaleString()}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-fuchsia-400 uppercase tracking-widest">Combo</span>
              <span className="text-2xl font-black tabular-nums">{combo}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Status</div>
            <div className="text-xs font-mono text-green-400">ONLINE</div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Camera elements - always mounted for reliable ref access */}
        <div className={cn(
          "fixed bottom-6 right-6 w-64 aspect-video z-[60] rounded-xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-sm transition-opacity duration-500",
          (gameState === 'START' || gameState === 'PLAYING') && isCameraReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}>
          <video 
            ref={videoRef} 
            className="w-full h-full object-cover mirror"
            playsInline
            autoPlay
            muted
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full mirror" />
          <div className="absolute top-2 left-2 flex items-center gap-2 px-2 py-1 bg-black/60 rounded-full backdrop-blur-md border border-white/10">
            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[8px] font-black text-white uppercase tracking-widest">Live Camera</span>
          </div>
        </div>

        {/* Persistent VRM Viewport */}
        <div className={cn(
          "absolute inset-0 transition-all duration-1000",
          gameState === 'START' ? 'opacity-30 scale-110 blur-sm' : 'opacity-100 scale-100 blur-0'
        )}>
          <VRMViewport 
            vrm={vrm} 
            onReady={(s, c, r) => {
              console.log("App: VRMViewport ready.");
              sceneRef.current = s;
              cameraRef.current = c;
              rendererRef.current = r;
              setIsSceneReady(true);
            }} 
          />
        </div>

        {/* Debug Status Overlay */}
        {(gameState === 'PLAYING' || debugStatus.includes('FAILED')) && (!isCameraReady || !isSceneReady || !isPoseReady || debugStatus.includes('FAILED')) && (
          <div className="absolute inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center gap-6 p-6">
            <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center space-y-4 max-w-md">
              <h2 className="text-xl font-bold text-white">システム準備中...</h2>
              <div className="text-xs font-mono text-white/40 whitespace-pre-wrap bg-white/5 p-4 rounded-lg border border-white/10 text-left overflow-auto max-h-48">
                {debugStatus}
              </div>
              
              <div className="flex flex-col gap-2">
                {showForceStart && (
                  <div className="space-y-4">
                    <p className="text-xs text-yellow-500/60">
                      初期化に時間がかかっています。ブラウザのカメラ許可を確認してください。
                    </p>
                    <button 
                      onClick={() => {
                        console.log("App: Force starting game...");
                        setIsCameraReady(true);
                        setIsPoseReady(true);
                        setIsSceneReady(true);
                      }}
                      className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold transition-colors"
                    >
                      強制的に開始する
                    </button>
                  </div>
                )}
                
                {gameState === 'START' && debugStatus.includes('FAILED') && (
                  <button 
                    onClick={() => window.location.reload()}
                    className="px-6 py-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-full text-xs font-bold transition-colors border border-red-500/20"
                  >
                    ページをリロードする
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {gameState === 'START' && (
            <motion.div 
              key="start"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 z-40 flex items-center justify-center p-8"
            >
              <div className="max-w-xl w-full bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-10 shadow-2xl">
                <div className="text-center mb-10">
                  <h2 className="text-5xl font-black mb-4 bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent italic">
                    READY TO DANCE?
                  </h2>
                  <p className="text-white/60 font-medium">VRMアバターをアップロードして、あなたの動きで踊らせよう。</p>
                </div>

                <div className="space-y-6">
                  {!vrm ? (
                    <label 
                      onDrop={onDrop}
                      onDragOver={onDragOver}
                      className="group relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-white/10 rounded-2xl hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all cursor-pointer overflow-hidden"
                    >
                      <input type="file" accept=".vrm" onChange={onFileChange} className="hidden" />
                      <div className="flex flex-col items-center gap-4 group-hover:scale-110 transition-transform">
                        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-cyan-500 group-hover:text-black transition-colors">
                          {isVrmLoading ? <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-8 h-8" />}
                        </div>
                        <div className="text-center">
                          <span className="block text-lg font-bold">
                            {isVrmLoading ? '読み込み中...' : 'VRMファイルをドロップ'}
                          </span>
                          <span className="text-sm text-white/40">
                            またはクリックして選択
                          </span>
                          
                          <div className="mt-2">
                            <a 
                              href="https://github.com/vrm-c/vrm-specification/raw/master/samples/AliciaSolid/VRM0/AliciaSolid.vrm" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[10px] text-cyan-400 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              サンプルVRMをダウンロード
                            </a>
                          </div>

                          {!vrm && !isVrmLoading && (
                            <div className="mt-6 flex flex-col gap-3 w-full max-w-xs mx-auto">
                              <button 
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  loadDefaultVRM();
                                }}
                                className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-400 rounded-full text-xs font-bold transition-colors border border-cyan-500/20"
                              >
                                デフォルトを再試行
                              </button>
                              
                              <div className="relative">
                                <input 
                                  type="text" 
                                  placeholder="VRMのURLを入力..." 
                                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-full text-xs text-white focus:outline-none focus:border-cyan-500/50"
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                      const url = (e.target as HTMLInputElement).value;
                                      if (url) {
                                        setIsVrmLoading(true);
                                        setDebugStatus(prev => prev + `\nLoading URL: ${url}`);
                                        try {
                                          const loadedVrm = await vrmService.loadVRM(url);
                                          setVrm(loadedVrm);
                                          setDebugStatus(prev => prev + "\nURL Load: SUCCESS");
                                        } catch (err) {
                                          console.error("App: URL load failed", err);
                                          setDebugStatus(prev => prev + `\nURL Load: FAILED (${err instanceof Error ? err.message : String(err)})`);
                                        } finally {
                                          setIsVrmLoading(false);
                                        }
                                      }
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </label>
                  ) : (
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-cyan-500 rounded-xl flex items-center justify-center text-black">
                          {isVrmLoading ? <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trophy className="w-6 h-6" />}
                        </div>
                        <div>
                          <div className="font-bold text-lg">{isVrmLoading ? '読み込み中...' : 'アバター準備完了'}</div>
                          <div className="text-sm text-white/40">{isVrmLoading ? 'しばらくお待ちください' : '準備が整いました'}</div>
                        </div>
                      </div>
                      {!isVrmLoading && (
                        <button 
                          onClick={() => setVrm(null)}
                          className="text-xs font-bold text-white/40 hover:text-white transition-colors"
                        >
                          変更する
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    disabled={!vrm || isVrmLoading}
                    onClick={startGame}
                    className={cn(
                      "w-full py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 transition-all",
                      vrm && !isVrmLoading 
                        ? "bg-white text-black hover:bg-cyan-400 hover:scale-[1.02] active:scale-95 shadow-[0_0_30px_rgba(255,255,255,0.2)]" 
                        : "bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                  >
                    <Camera className="w-6 h-6" />
                    ゲームスタート
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === 'PLAYING' && (
            <motion.div 
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col"
            >
              {/* Game UI Overlay */}
              <div className="flex-1 relative">
                {/* Lyrics Area */}
                <div className="absolute inset-x-0 bottom-32 flex justify-center pointer-events-none">
                  <LyricsDisplay currentTime={currentTime} lyrics={DEMO_LYRICS} />
                </div>

                {/* Judgment Display */}
                <AnimatePresence>
                  {judgment && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1.2, opacity: 1 }}
                      exit={{ scale: 1.5, opacity: 0 }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      <span className={cn(
                        "text-8xl font-black italic tracking-tighter drop-shadow-[0_0_30px_rgba(0,0,0,0.5)]",
                        judgment === 'PERFECT' ? 'text-yellow-400' :
                        judgment === 'GREAT' ? 'text-fuchsia-400' :
                        judgment === 'GOOD' ? 'text-cyan-400' : 'text-white/40'
                      )}>
                        {judgment}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Next Pose Preview */}
                <AnimatePresence mode="wait">
                  {nextPose && (
                    <motion.div 
                      key={nextPose.name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="absolute top-24 left-6 p-6 bg-black/60 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl w-64"
                    >
                      <div className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <div className="w-1 h-1 bg-cyan-500 rounded-full animate-pulse" />
                        Next Pose
                      </div>
                      <div className="aspect-square bg-white/5 rounded-2xl flex flex-col items-center justify-center border border-white/5 mb-4 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="text-6xl mb-2 drop-shadow-2xl">🕺</div>
                        <div className="text-xl font-black text-white tracking-tight">{nextPose.name}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-wider">
                          <span>Timing</span>
                          <span className="text-cyan-500">{(nextPose.time - currentTime).toFixed(1)}s</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <motion.div 
                            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                            initial={{ width: "100%" }}
                            animate={{ width: "0%" }}
                            transition={{ duration: Math.max(0, nextPose.time - currentTime), ease: "linear" }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {gameState === 'RESULT' && (
          <motion.div 
            key="result"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="h-screen flex flex-col items-center justify-center p-8 bg-[#0a0a0f]"
          >
            <div className="w-full max-w-4xl bg-white/5 border border-white/10 rounded-3xl p-12 backdrop-blur-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-yellow-500" />
              
              <div className="flex justify-between items-start mb-12">
                <div>
                  <h2 className="text-6xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500 mb-2">RESULT</h2>
                  <p className="text-cyan-400 font-bold tracking-widest">AI DANCE CHALLENGE COMPLETED</p>
                </div>
                <div className="text-right">
                  <span className="text-8xl font-black text-yellow-400 drop-shadow-[0_0_20px_rgba(255,255,0,0.5)]">{getRank()}</span>
                  <p className="text-xs font-bold text-gray-400 uppercase">Rank</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12 mb-12">
                <div className="space-y-6">
                  <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <span className="text-gray-400 font-bold">TOTAL SCORE</span>
                    <span className="text-4xl font-black font-mono">{score.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-end border-b border-white/10 pb-2">
                    <span className="text-gray-400 font-bold">MAX COMBO</span>
                    <span className="text-4xl font-black font-mono text-fuchsia-500">{maxCombo}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <ResultStat label="PERFECT" value={results.perfect} color="text-yellow-400" />
                  <ResultStat label="GREAT" value={results.great} color="text-cyan-400" />
                  <ResultStat label="GOOD" value={results.good} color="text-green-400" />
                  <ResultStat label="MISS" value={results.miss} color="text-red-500" />
                </div>
              </div>

              <div className="flex gap-6">
                <button 
                  onClick={() => {
                    setScore(0); setCombo(0); setMaxCombo(0);
                    setResults({ perfect: 0, great: 0, good: 0, miss: 0 });
                    setIsCameraReady(false);
                    lastPoseTimeRef.current = -1;
                    clockRef.current = new THREE.Clock();
                    audioEngine.init();
                    setGameState('PLAYING');
                  }}
                  className="flex-1 py-4 bg-white text-black rounded-xl font-black flex items-center justify-center gap-2 hover:bg-cyan-400 transition-colors"
                >
                  <RotateCcw className="w-5 h-5" />
                  もう一度プレイ
                </button>
                <button 
                  onClick={() => setGameState('START')}
                  className="flex-1 py-4 bg-white/10 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-white/20 transition-colors"
                >
                  <RotateCcw className="w-5 h-5" />
                  別のVRMで遊ぶ
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      </main>

      <style>{`
        .mirror {
          transform: scaleX(-1);
        }
        @keyframes glow {
          from { text-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff; }
          to { text-shadow: 0 0 20px #00ffff, 0 0 30px #00ffff; }
        }
      `}</style>
    </div>
  );
}

const ResultStat = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="bg-white/5 rounded-xl p-4 flex flex-col items-center">
    <span className={cn("text-2xl font-black", color)}>{value}</span>
    <span className="text-[10px] font-bold text-gray-500 tracking-widest">{label}</span>
  </div>
);

const StickFigure = ({ pose }: { pose: PoseTarget['pose'] }) => {
  // Simplified stick figure drawing with SVG
  const leftArmRad = (pose.leftArm * Math.PI) / 180;
  const rightArmRad = (pose.rightArm * Math.PI) / 180;
  
  return (
    <svg width="100" height="150" viewBox="0 0 100 150" className="text-cyan-400">
      {/* Head */}
      <circle cx="50" cy="30" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
      {/* Body */}
      <line x1="50" y1="40" x2="50" y2="90" stroke="currentColor" strokeWidth="3" />
      {/* Arms */}
      <line 
        x1="50" y1="50" 
        x2={50 - Math.sin(leftArmRad) * 30} 
        y2={50 + Math.cos(leftArmRad) * 30} 
        stroke="currentColor" strokeWidth="3" 
      />
      <line 
        x1="50" y1="50" 
        x2={50 + Math.sin(rightArmRad) * 30} 
        y2={50 + Math.cos(rightArmRad) * 30} 
        stroke="currentColor" strokeWidth="3" 
      />
      {/* Legs */}
      <line x1="50" y1="90" x2="35" y2="130" stroke="currentColor" strokeWidth="3" />
      <line x1="50" y1="90" x2="65" y2="130" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
};
