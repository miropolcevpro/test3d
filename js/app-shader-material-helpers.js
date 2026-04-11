import * as THREE from 'three';
import { prepMapTex } from './app-texture-material-helpers.js';

const TILE_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewPos;
  varying vec4 vClipPos;

  uniform vec2 uTileSize;
  uniform vec2 uUvScale;
  uniform int uLayoutMode;

  mat2 rot(float a){
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  void main(){
    vec3 pos = position;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = mv.xyz;
    vClipPos = projectionMatrix * mv;

    vNormalW = normalize((modelMatrix * vec4(normal,0.0)).xyz);

    vec2 uv = vec2(pos.x / uTileSize.x, pos.z / uTileSize.y) * uUvScale;

    if (uLayoutMode == 1) {
      uv = rot(0.78539816339) * uv; // 45°
    } else if (uLayoutMode == 2) {
      float row = floor(uv.y);
      uv.x += 0.5 * mod(row, 2.0);
    }

    vUv = uv;
    gl_Position = vClipPos;
  }
`;

const TILE_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewPos;
  varying vec4 vClipPos;

  uniform sampler2D uTex;
  uniform sampler2D uTex2;
  uniform int uHasTex2;
  uniform float uTexMix;
  uniform sampler2D uNormalTex;
  uniform sampler2D uRoughTex;
  uniform sampler2D uAoTex;
  uniform sampler2D uHeightTex;

  uniform int uHasNormal;
  uniform int uHasRough;
  uniform int uHasAo;
  uniform int uHasHeight;
  uniform float uNormalScale;
  uniform float uBumpScale;

  uniform float uAlbedoGain;
  uniform float uRoughnessMult;
  uniform float uSpecStrength;
  uniform vec3 uColorBalance;
  uniform vec3 uLightDir;
  uniform vec3 uFillLightDir;
  uniform float uFillStrength;
  uniform float uAmbient;
  uniform float uExposureMult;
  uniform float uAlpha;

  uniform vec3 uEnvSkyColor;
  uniform vec3 uEnvGroundColor;
  uniform float uEnvDiffuseStrength;
  uniform float uEnvSpecIntensity;

  uniform int uUseOcclusion;
  uniform sampler2D uDepthTex;
  uniform int uDepthValid;
  uniform float uOcclusionEps;

  vec2 safeFract(vec2 v){ return v - floor(v); }

  vec3 tangentSpaceToWorld(vec3 nTS, vec3 nW){
    vec3 T = normalize(vec3(1.0, 0.0, 0.0));
    vec3 B = normalize(vec3(0.0, 0.0, 1.0));
    vec3 N = normalize(nW);
    return normalize(T * nTS.x + B * nTS.y + N * nTS.z);
  }

  void main(){
    if (uUseOcclusion == 1 && uDepthValid == 1) {
      vec3 ndc = (vClipPos.xyz / vClipPos.w);
      vec2 suv = ndc.xy * 0.5 + 0.5;
      if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
        float sceneDepth = texture2D(uDepthTex, suv).r;
        float fragDist = length(vViewPos);
        if (sceneDepth > 0.0 && sceneDepth < (fragDist - uOcclusionEps)) {
          discard;
        }
      }
    }

    vec2 uv = safeFract(vUv);

    vec3 a0 = texture2D(uTex, uv).rgb;
    if (uHasTex2 == 1) {
      vec3 a1 = texture2D(uTex2, uv).rgb;
      a0 = mix(a0, a1, clamp(uTexMix, 0.0, 1.0));
    }
    vec3 albedo = a0;

    albedo *= uAlbedoGain;
    albedo *= uColorBalance;
    float ao = 1.0;
    if (uHasAo == 1) {
      ao = texture2D(uAoTex, uv).r;
      ao = mix(1.0, ao, 0.8);
    }

    vec3 Nw = normalize(vNormalW);

    vec3 nTS = vec3(0.0, 0.0, 1.0);
    if (uHasNormal == 1) {
      vec3 nm = texture2D(uNormalTex, uv).xyz * 2.0 - 1.0;
      nm.xy *= max(0.0, uNormalScale);
      nTS = normalize(nm);
    }

    if (uHasHeight == 1 && uBumpScale > 0.0) {
      float h0 = texture2D(uHeightTex, uv).r;
      float hx = texture2D(uHeightTex, uv + vec2(0.002, 0.0)).r;
      float hy = texture2D(uHeightTex, uv + vec2(0.0, 0.002)).r;
      vec2 grad = vec2(hx - h0, hy - h0);
      vec3 bumpTS = normalize(vec3(-grad.x * uBumpScale, -grad.y * uBumpScale, 1.0));
      nTS = normalize(vec3(nTS.xy + bumpTS.xy, nTS.z));
    }

    Nw = tangentSpaceToWorld(nTS, Nw);

    float rough = 0.85;
    if (uHasRough == 1) {
      rough = texture2D(uRoughTex, uv).r;
    }
    rough *= max(0.0, uRoughnessMult);
    rough = clamp(rough, 0.04, 1.0);

    vec3 L = normalize(uLightDir);
    vec3 V = normalize(-vViewPos);
    vec3 H = normalize(L + V);

    float diff = max(dot(Nw, L), 0.0);

    float shininess = mix(120.0, 8.0, rough);
    float spec = pow(max(dot(Nw, H), 0.0), shininess) * (1.0 - rough);
    spec *= 0.12;

    spec *= max(0.0, uSpecStrength);
    vec3 R = reflect(-V, Nw);
    float rt = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 envCol = mix(uEnvGroundColor, uEnvSkyColor, smoothstep(0.0, 1.0, rt));
    vec3 envDiff = envCol * uEnvDiffuseStrength;
    float fres = pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    vec3 envSpec = envCol * (0.04 + 0.96 * fres) * (1.0 - rough) * uEnvSpecIntensity;
    envSpec *= max(0.0, uSpecStrength);
    envSpec *= ao;

    float fill = max(dot(Nw, normalize(uFillLightDir)), 0.0) * uFillStrength;
    float light = uAmbient + (1.0 - uAmbient) * (diff + fill);
    light = clamp(light, 0.0, 1.35);
    vec3 color = (albedo * light * ao) + vec3(spec) + (albedo * envDiff * ao) + envSpec;

    gl_FragColor = vec4(color * uExposureMult, 0.98 * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function makeTileMaterial(arg = {}) {
  if (arg && arg.isTexture) arg = { albedoTex: arg };
  const {
    albedoTex,
    normalTex = null,
    roughnessTex = null,
    aoTex = null,
    heightTex = null,
    normalScale = 0.0,
    bumpScale = 0.0,
  } = arg || {};

  prepMapTex(albedoTex, true);
  prepMapTex(normalTex, false);
  prepMapTex(roughnessTex, false);
  prepMapTex(aoTex, false);
  prepMapTex(heightTex, false);

  const mat = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uTex: { value: albedoTex },
      uTex2: { value: null },
      uHasTex2: { value: 0 },
      uTexMix: { value: 0.0 },
      uNormalTex: { value: normalTex },
      uRoughTex: { value: roughnessTex },
      uAoTex: { value: aoTex },
      uHeightTex: { value: heightTex },
      uHasNormal: { value: normalTex ? 1 : 0 },
      uHasRough: { value: roughnessTex ? 1 : 0 },
      uHasAo: { value: aoTex ? 1 : 0 },
      uHasHeight: { value: heightTex ? 1 : 0 },
      uNormalScale: { value: normalScale || 0.0 },
      uBumpScale: { value: bumpScale || 0.0 },
      uAlbedoGain: { value: 1.0 },
      uRoughnessMult: { value: 1.0 },
      uSpecStrength: { value: 1.0 },
      uColorBalance: { value: new THREE.Vector3(0.96, 1.0, 1.02) },
      uExposureMult: { value: 1.0 },
      uAlpha: { value: 1.0 },
      uTileSize: { value: new THREE.Vector2(0.2, 0.2) },
      uUvScale: { value: new THREE.Vector2(1, 1) },
      uLayoutMode: { value: 0 },
      uLightDir: { value: new THREE.Vector3(1, 2, 1).normalize() },
      uFillLightDir: { value: new THREE.Vector3(-1, 1.2, 0.6).normalize() },
      uFillStrength: { value: 0.26 },
      uAmbient: { value: 0.25 },
      uEnvSkyColor: { value: new THREE.Color(0x9ecbff) },
      uEnvGroundColor: { value: new THREE.Color(0x2f2f2f) },
      uEnvDiffuseStrength: { value: 0.03 },
      uEnvSpecIntensity: { value: 0.20 },
      uUseOcclusion: { value: 0 },
      uDepthTex: { value: null },
      uDepthValid: { value: 0 },
      uOcclusionEps: { value: 0.02 },
    },
    vertexShader: TILE_VERTEX_SHADER,
    fragmentShader: TILE_FRAGMENT_SHADER,
  });
  mat.toneMapped = true;
  return mat;
}

export { TILE_VERTEX_SHADER, TILE_FRAGMENT_SHADER };
