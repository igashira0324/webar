import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export class VRMService {
  private loader: GLTFLoader;

  constructor() {
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  async loadVRM(url: string) {
    try {
      console.log(`VRMService: Loading from ${url}...`);
      
      // Check if URL is accessible first to get better error messages
      if (url.startsWith('http')) {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          if (!response.ok) {
            console.warn(`VRMService: HEAD request failed for ${url} with status ${response.status}`);
          }
        } catch (e) {
          console.warn(`VRMService: HEAD request failed for ${url} (CORS or network issue)`);
        }
      }

      const gltf = await this.loader.loadAsync(url);
      
      // VRMLoaderPlugin puts VRM 0.x in userData.vrm and VRM 1.0 in userData.vrm1
      const vrm = gltf.userData.vrm || gltf.userData.vrm1;
      
      if (!vrm) {
        throw new Error('VRM data not found in GLTF. Make sure the file is a valid VRM.');
      }

      console.log(`VRMService: Successfully loaded VRM. Version: ${vrm.meta?.metaVersion || vrm.meta?.version || 'unknown'}`);
      
      // VRM 0.x の場合のみ回転を適用
      const isVRM0 = vrm.meta?.metaVersion === '0' || (vrm.meta?.version && vrm.meta.version.startsWith('0'));
      if (isVRM0) {
        console.log('VRMService: Applying VRM0 rotation.');
        VRMUtils.rotateVRM0(vrm);
      }
      
      return vrm;
    } catch (error) {
      console.error('VRMService: Failed to load VRM:', error);
      throw error;
    }
  }
}

export const vrmService = new VRMService();
