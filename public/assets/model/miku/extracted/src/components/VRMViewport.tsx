import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';

interface VRMViewportProps {
  vrm: VRM | null;
  onReady: (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void;
}

export const VRMViewport: React.FC<VRMViewportProps> = ({ vrm, onReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const vrmRefInternal = useRef<VRM | null>(vrm);

  useEffect(() => {
    vrmRefInternal.current = vrm;
  }, [vrm]);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const updateSize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width === 0 || height === 0) return;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
      console.log(`VRMViewport: Size updated to ${width}x${height}`);
    };

    const camera = new THREE.PerspectiveCamera(30.0, 1.0, 0.1, 20.0);
    camera.position.set(0.0, 1.3, 3.5);
    camera.lookAt(0.0, 1.0, 0.0);
    cameraRef.current = camera;
    
    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(containerRef.current);

    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(light);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Grid floor
    const gridHelper = new THREE.GridHelper(10, 10, 0x00ffff, 0x333333);
    scene.add(gridHelper);

    console.log("VRMViewport: Initializing scene...");
    onReady(scene, camera, renderer);

    const clock = new THREE.Clock();
    let animationFrameId: number;
    const animate = () => {
      const delta = clock.getDelta();
      if (vrmRefInternal.current) {
        vrmRefInternal.current.update(delta);
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      console.log("VRMViewport: Disposing...");
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      // Remove existing VRMs safely
      const toRemove: THREE.Object3D[] = [];
      sceneRef.current.children.forEach(child => {
        if (child.userData.isVRM) {
          toRemove.push(child);
        }
      });
      toRemove.forEach(child => {
        sceneRef.current?.remove(child);
      });

      if (vrm) {
        console.log("VRMViewport: Adding VRM to scene.");
        vrm.scene.userData.isVRM = true;
        sceneRef.current.add(vrm.scene);
      }
    }
  }, [vrm]);

  return <div ref={containerRef} className="w-full h-full bg-[#0a0a0f]" />;
};
